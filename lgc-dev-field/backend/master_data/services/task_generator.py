"""Geração de GeneratedTask a partir de um ScopeItem já resolvido —
independente de HTTP/DRF (mesmo espírito de task_rule_resolver.py e
scope_item_normalizer.py):

ScopeItem -> TaskTemplate (resolvido) -> TaskTemplateSteps -> GeneratedTask

NUNCA gera tarefas para um ScopeItem que não esteja
rule_resolution_status=RESOLVED com um resolved_template — a ordem correta
é sempre "Resolver Template" primeiro, "Gerar Tarefas" depois (processo
auditável, sem resolução implícita escondida dentro da geração). Este
módulo NUNCA cria/atualiza ScopeItem, TaskTemplate ou TaskTemplateStep —
só lê e cria GeneratedTask.

EXPANSÃO POR PATH: um TaskTemplateStep com repeatable=true gera UMA única
GeneratedTask (expansion_key="DEFAULT", path=None) a menos que o ScopeItem
tenha expansion_mode="PATH" E possua ao menos um ScopeItemPath ativo —
nesse caso, gera uma GeneratedTask POR Path ativo (expansion_key=
path.code, path=<Path>), com a MESMA quantidade em cada uma (não divide
automaticamente — ver spec). Um step não repeatable NUNCA expande,
independente de expansion_mode."""

from decimal import ROUND_UP, Decimal

from django.db import transaction

_FIVE = Decimal("5")


def _round_up_to_5(value):
    """Arredonda metragem para cima no múltiplo de 5 mais próximo.
    Ex: 32 → 35, 35 → 35, 41 → 45."""
    if value is None:
        return value
    return (Decimal(value) / _FIVE).to_integral_value(rounding=ROUND_UP) * _FIVE


class TaskGenerationError(Exception):
    """ScopeItem não está pronto para gerar tarefas (rule_resolution_status
    != RESOLVED, ou sem resolved_template) — resolva o template primeiro."""


# Origens de quantidade reconhecidas nesta primeira versão (ver
# TaskTemplateStep.QUANTITY_SOURCE_SUGGESTIONS). Uma origem fora destas
# listas NÃO é um erro: só resulta em quantity=None e um warning no
# retorno da geração (ver _resolve_quantity).
_QUANTITY_FROM_SCOPE_ITEM_QUANTITY = ("SCOPE_ITEM", "CABLE_COUNT", "LINK_COUNT", "CONNECTION_COUNT")
_QUANTITY_FROM_SCOPE_ITEM_LENGTH = ("METERAGE",)
_QUANTITY_FIXED_ONE = ("PROJECT",)
_QUANTITY_NULL = ("MANUAL", "NONE", "")


def _resolve_quantity(scope_item, quantity_source, warnings):
    if quantity_source in _QUANTITY_FROM_SCOPE_ITEM_QUANTITY:
        return Decimal(scope_item.quantity)
    if quantity_source in _QUANTITY_FROM_SCOPE_ITEM_LENGTH:
        return _round_up_to_5(scope_item.length_m)
    if quantity_source in _QUANTITY_FIXED_ONE:
        return Decimal(1)
    if quantity_source in _QUANTITY_NULL:
        return None
    warnings.append(f'Origem de quantidade não reconhecida ("{quantity_source}") — quantidade ficou em branco.')
    return None


def _resolve_unit(step, scope_item):
    return step.unit_override or step.activity.default_unit or scope_item.unit or ""


def _scope_item_identity(scope_item):
    """Tipo de cabo (spec, ou família quando não há spec) + metragem —
    concatenado ao nome da GeneratedTask/ProjectTask para não perder
    rastreabilidade quando várias tarefas do mesmo tipo de atividade (ex:
    "Lançar cabeamento") existem lado a lado no mesmo projeto, uma por
    ScopeItem (ex: "Lançar cabeamento Fibra MPO 35m", metragem já
    arredondada para o múltiplo de 5, igual à quantidade). Cai para um recorte
    de `raw_text` só quando nem tipo nem metragem estão disponíveis (ex:
    item ainda sem cable_family/cable_spec resolvido)."""
    parts = []
    if scope_item.cable_spec_id:
        parts.append(scope_item.cable_spec.name)
    elif scope_item.cable_family_id:
        parts.append(scope_item.cable_family.name)
    if scope_item.length_m:
        parts.append(f"{_round_up_to_5(scope_item.length_m):.0f}m")
    if parts:
        return " ".join(str(part) for part in parts)
    text = scope_item.raw_text.strip()
    return f"{text[:57]}..." if len(text) > 60 else text


def _resolve_expansions(step, scope_item, active_paths, warnings):
    """Retorna a lista de (path_or_none, expansion_key) para este step —
    uma entrada só (None, "DEFAULT") quando o step não expande; uma
    entrada por Path ativo quando expande."""
    if not step.repeatable or scope_item.expansion_mode != "PATH":
        return [(None, "DEFAULT")]
    if not active_paths:
        warnings.append(
            f'Etapa "{step.effective_name}" é repetível e o item está com expansion_mode=PATH, mas não tem '
            "nenhuma Rota/Path ativa associada — gerando uma única tarefa (DEFAULT)."
        )
        return [(None, "DEFAULT")]
    return [(scope_item_path.path, scope_item_path.path.code) for scope_item_path in active_paths]


def generate_tasks_for_scope_item(scope_item, user=None):
    """Gera (ou reaproveita, se já existir) GeneratedTasks a partir dos
    TaskTemplateSteps ATIVOS do template resolvido do ScopeItem, em ordem
    de step_order. Um step repeatable=true com
    scope_item.expansion_mode="PATH" e ao menos um ScopeItemPath ativo
    gera UMA tarefa POR Path (mesma quantidade em cada, não dividida);
    qualquer outro caso gera uma única tarefa (expansion_key="DEFAULT").
    Idempotente: chamar de novo não duplica — reforçado tanto pela
    UniqueConstraint (scope_item, task_template_step, expansion_key)
    quanto por get_or_create() aqui.

    Levanta TaskGenerationError se o ScopeItem não estiver
    rule_resolution_status=RESOLVED ou não tiver resolved_template.

    `user`: usado como created_by/updated_by das tarefas recém-criadas
    (None é aceito — ex.: chamada fora do contexto de uma request HTTP).

    Retorna um dict com instâncias de model (não dicts JSON-safe, para que
    a camada de API reaproveite diretamente GeneratedTaskCrudSerializer):
    {"scope_item": ScopeItem, "created_tasks": [...], "existing_tasks":
    [...], "warnings": [...]}."""

    if scope_item.rule_resolution_status != "RESOLVED" or not scope_item.resolved_template_id:
        raise TaskGenerationError(
            "O item de escopo precisa estar resolvido (rule_resolution_status=RESOLVED, com um "
            'template resolvido) antes de gerar tarefas — use "Resolver Template" primeiro.'
        )

    from master_data.models import GeneratedTask, ScopeItemPath, TaskTemplateStep

    steps = (
        TaskTemplateStep.objects.filter(task_template_id=scope_item.resolved_template_id, active=True)
        .select_related("activity")
        .order_by("step_order")
    )

    active_paths = []
    if scope_item.expansion_mode == "PATH":
        active_paths = list(
            ScopeItemPath.objects.filter(scope_item=scope_item, active=True)
            .select_related("path")
            .order_by("sequence", "path__code")
        )

    created_tasks = []
    existing_tasks = []
    warnings = []

    with transaction.atomic():
        for step in steps:
            quantity = _resolve_quantity(scope_item, step.quantity_source or "", warnings)
            unit = _resolve_unit(step, scope_item)
            identity = _scope_item_identity(scope_item)
            for path, expansion_key in _resolve_expansions(step, scope_item, active_paths, warnings):
                name = f"{step.effective_name} {identity}"
                if path is not None:
                    name = f"{name} — {path.name}"
                task, was_created = GeneratedTask.objects.get_or_create(
                    scope_item=scope_item,
                    task_template_step=step,
                    expansion_key=expansion_key,
                    defaults={
                        "task_template": scope_item.resolved_template,
                        "activity": step.activity,
                        "path": path,
                        "step_order": step.step_order,
                        "name": name,
                        "quantity": quantity,
                        "unit": unit,
                        "required": step.required,
                        "repeatable": step.repeatable,
                        "generation_source": "TEMPLATE",
                        "status": "PENDING",
                        "created_by": user,
                        "updated_by": user,
                    },
                )
                if was_created:
                    created_tasks.append(task)
                else:
                    existing_tasks.append(task)

    return {
        "scope_item": scope_item,
        "created_tasks": created_tasks,
        "existing_tasks": existing_tasks,
        "warnings": warnings,
    }

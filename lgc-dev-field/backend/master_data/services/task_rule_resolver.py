"""Motor de match entre características de escopo e TaskTemplateRule —
independente de HTTP/DRF de propósito, para que a mesma lógica possa ser
reaproveitada por consumidores futuros que não são a API REST: o parser de
SOW, a geração automática de ScopeItems/Tasks, e uma eventual integração
de IA. Hoje o único consumidor é o endpoint de simulação (Cadastros
Mestres > Operação > Simulador de Regras,
`TaskTemplateRuleViewSet.simulate`), mas a função central
(`resolve_task_template`) não sabe nada sobre requests/responses — recebe
instâncias de model (ou None) e devolve dicts já prontos para virar JSON.

Este módulo NUNCA cria, atualiza ou apaga nenhum registro — é somente
leitura, um simulador/validador do motor de regras."""

from master_data.models import TaskTemplate, TaskTemplateStep


class TaskRuleResolutionError(Exception):
    """Entrada inconsistente (ex: CableSpec de uma família diferente da
    CableFamily informada). NÃO é levantado quando simplesmente nenhuma
    regra é compatível — isso é um resultado válido do motor (ver
    `resolve_task_template`), não um erro de entrada."""


def _check_fk_criterion(name, rule_related, input_obj):
    """Compara um critério de FK (cable_family/cable_spec/network/
    workstream) da regra contra o valor informado. `rule_related` é a
    instância relacionada da regra (ou None, se a regra não restringe esse
    critério)."""
    if rule_related is None:
        return {"criterion": name, "result": "IGNORED", "detail": f"Regra não restringe {name}."}
    if input_obj is None:
        return {
            "criterion": name,
            "result": "MISMATCH",
            "detail": f"Regra exige {name} = {rule_related.code}, mas não foi informado.",
        }
    if rule_related.pk == input_obj.pk:
        return {"criterion": name, "result": "MATCH", "detail": f"{rule_related.code} = {input_obj.code}"}
    return {
        "criterion": name,
        "result": "MISMATCH",
        "detail": f"Regra exige {name} = {rule_related.code}, informado {input_obj.code}.",
    }


def _check_medium_criterion(rule_medium, input_medium):
    if not rule_medium:
        return {"criterion": "medium", "result": "IGNORED", "detail": "Regra não restringe medium."}
    if not input_medium:
        return {
            "criterion": "medium",
            "result": "MISMATCH",
            "detail": f"Regra exige medium = {rule_medium}, mas não foi informado.",
        }
    if rule_medium.strip().casefold() == input_medium.strip().casefold():
        return {"criterion": "medium", "result": "MATCH", "detail": f"{rule_medium} = {input_medium}"}
    return {
        "criterion": "medium",
        "result": "MISMATCH",
        "detail": f"Regra exige medium = {rule_medium}, informado {input_medium}.",
    }


def _check_preterminated_criterion(rule_value, input_value):
    if rule_value is None:
        return {"criterion": "preterminated", "result": "IGNORED", "detail": "Regra não restringe preterminated."}
    if input_value is None:
        return {
            "criterion": "preterminated",
            "result": "MISMATCH",
            "detail": f"Regra exige preterminated = {rule_value}, mas não foi informado.",
        }
    if rule_value == input_value:
        return {"criterion": "preterminated", "result": "MATCH", "detail": f"{rule_value} = {input_value}"}
    return {
        "criterion": "preterminated",
        "result": "MISMATCH",
        "detail": f"Regra exige preterminated = {rule_value}, informado {input_value}.",
    }


def _serialize_rule(rule):
    return {
        "id": rule.pk,
        "code": rule.code,
        "name": rule.name,
        "priority": rule.priority,
        "specificity_score": rule.specificity_score,
        "task_template_id": rule.task_template_id,
        "task_template_code": rule.task_template.code,
        "task_template_name": rule.task_template.name,
    }


def resolve_task_template(
    *,
    cable_family=None,
    cable_spec=None,
    network=None,
    workstream=None,
    medium="",
    preterminated=None,
):
    """Resolve, dentre as TaskTemplateRule ATIVAS, quais são compatíveis com
    os critérios informados, e em qual ordem (menor priority, depois maior
    specificity_score, depois code crescente como desempate). Uma regra só
    é compatível quando NENHUM dos seus critérios preenchidos entra em
    MISMATCH contra a entrada — um critério da regra deixado em branco/nulo
    é IGNORED (não restringe), e um critério da regra preenchido cuja
    entrada correspondente não foi informada também é MISMATCH (a entrada
    precisa confirmar explicitamente o que a regra exige, nunca "herdar"
    silenciosamente).

    Parâmetros `cable_family`/`cable_spec`/`network`/`workstream`: instância
    de model ou None. `medium`: string (pode ser ""). `preterminated`:
    True/False/None (tri-state).

    Campos derivados (não alteram nenhum dado persistido, só esta
    resolução): se `cable_spec` for informado sem `cable_family`, a família
    é derivada de `cable_spec.cable_family`; se `medium` não for informado
    e a família (informada ou derivada) tiver `medium` preenchido, o medium
    é derivado dela. Ambos aparecem em `derived_fields` no retorno.

    Levanta TaskRuleResolutionError apenas quando `cable_spec` e
    `cable_family` são informados e são inconsistentes entre si (spec de
    uma família diferente) — nunca por "nenhuma regra compatível", que é um
    resultado normal (retorna `matches=[]`).

    Retorna um dict JSON-serializável: {"matches": [...], "derived_fields":
    {...}, "warnings": [...]} — sem instâncias de model, para que o
    resultado possa ser devolvido diretamente por uma API ou usado por
    qualquer consumidor futuro sem depender de Django/DRF."""

    from master_data.models import TaskTemplateRule

    if cable_spec is not None and cable_family is not None and cable_spec.cable_family_id != cable_family.pk:
        raise TaskRuleResolutionError(
            f'A especificação "{cable_spec.code}" pertence à família "{cable_spec.cable_family.code}", '
            f'diferente da família informada ("{cable_family.code}").'
        )

    derived_fields = {}

    if cable_spec is not None and cable_family is None:
        cable_family = cable_spec.cable_family
        derived_fields["cable_family"] = {"value": cable_family.code, "source": "cable_spec"}

    if not medium and cable_family is not None and cable_family.medium:
        medium = cable_family.medium
        derived_fields["medium"] = {"value": medium, "source": "cable_family"}

    candidates = TaskTemplateRule.objects.filter(active=True).select_related(
        "task_template", "cable_family", "cable_spec", "network", "workstream"
    )

    matches = []
    for rule in candidates:
        checks = [
            _check_fk_criterion("cable_family", rule.cable_family, cable_family),
            _check_fk_criterion("cable_spec", rule.cable_spec, cable_spec),
            _check_fk_criterion("network", rule.network, network),
            _check_fk_criterion("workstream", rule.workstream, workstream),
            _check_medium_criterion(rule.medium, medium),
            _check_preterminated_criterion(rule.preterminated, preterminated),
        ]
        if all(check["result"] != "MISMATCH" for check in checks):
            matches.append({"rule": _serialize_rule(rule), "checks": checks})

    matches.sort(key=lambda m: (m["rule"]["priority"], -m["rule"]["specificity_score"], m["rule"]["code"]))

    return {"matches": matches, "derived_fields": derived_fields, "warnings": []}


def simulate_task_template(**criteria):
    """Envelope de conveniência sobre `resolve_task_template`, usado pelo
    Simulador de Regras (e por qualquer outro caller síncrono que queira o
    resultado completo pronto para virar JSON de uma vez): resolve os
    matches E já inclui as etapas ordenadas do template vencedor. Não
    persiste nada — puramente leitura/simulação."""

    result = resolve_task_template(**criteria)
    matches = result["matches"]
    warnings = list(result["warnings"])

    selected_rule = None
    selected_template = None
    steps = []
    if matches:
        selected_rule = matches[0]["rule"]
        if selected_rule["priority"] >= 500:
            warnings.append(
                f'Regra de fallback genérica utilizada ("{selected_rule["code"]}") — prioridade mínima, '
                "baixa especificidade. Considere cadastrar uma regra mais específica."
            )
        template = TaskTemplate.objects.get(pk=selected_rule["task_template_id"])
        selected_template = {
            "id": template.pk,
            "code": template.code,
            "name": template.name,
            "category": template.category,
            "medium": template.medium,
        }
        steps_qs = (
            TaskTemplateStep.objects.filter(task_template=template, active=True)
            .select_related("activity")
            .order_by("step_order")
        )
        steps = [
            {
                "step_order": step.step_order,
                "activity_code": step.activity.code,
                "activity_name": step.activity.name,
                "effective_name": step.effective_name,
                "required": step.required,
                "repeatable": step.repeatable,
                "quantity_source": step.quantity_source,
                "unit_override": step.unit_override,
            }
            for step in steps_qs
        ]

    return {
        "selected_rule": selected_rule,
        "selected_template": selected_template,
        "steps": steps,
        "matches": matches,
        "derived_fields": result["derived_fields"],
        "warnings": warnings,
    }


def apply_resolution_to_scope_item(scope_item):
    """Executa `simulate_task_template` para os critérios de um ScopeItem
    (Planejamento > Itens de Escopo) e grava o resultado em
    `scope_item.resolved_rule`/`resolved_template`/`rule_resolution_status`
    — SEM salvar (quem chama decide quando persistir) e SEM criar nenhuma
    Task. Reaproveita EXATAMENTE o mesmo motor de match do Simulador de
    Regras (`simulate_task_template` acima) — nenhuma lógica de match é
    duplicada aqui, só a tradução do resultado para os campos de resolução
    do ScopeItem.

    `rule_resolution_status` vira "RESOLVED" quando há uma regra vencedora,
    "NO_MATCH" quando nenhuma regra ativa é compatível, e "CONFLICT" quando
    os próprios critérios do ScopeItem são inconsistentes entre si
    (cable_spec de uma família diferente de cable_family — o mesmo caso
    que TaskRuleResolutionError já cobre no Simulador). Retorna o mesmo
    envelope de `simulate_task_template`, mais a chave
    `rule_resolution_status` (e `conflict_detail` só no caso de conflito)."""

    from master_data.models import TaskTemplate, TaskTemplateRule

    try:
        result = simulate_task_template(
            cable_family=scope_item.cable_family,
            cable_spec=scope_item.cable_spec,
            network=scope_item.network,
            workstream=scope_item.workstream,
            medium=scope_item.medium,
            preterminated=scope_item.preterminated,
        )
    except TaskRuleResolutionError as exc:
        scope_item.resolved_rule = None
        scope_item.resolved_template = None
        scope_item.rule_resolution_status = "CONFLICT"
        return {
            "selected_rule": None,
            "selected_template": None,
            "steps": [],
            "matches": [],
            "derived_fields": {},
            "warnings": [],
            "rule_resolution_status": "CONFLICT",
            "conflict_detail": str(exc),
        }

    if result["selected_rule"] is None:
        scope_item.resolved_rule = None
        scope_item.resolved_template = None
        scope_item.rule_resolution_status = "NO_MATCH"
    else:
        scope_item.resolved_rule = TaskTemplateRule.objects.get(pk=result["selected_rule"]["id"])
        scope_item.resolved_template = TaskTemplate.objects.get(pk=result["selected_template"]["id"])
        scope_item.rule_resolution_status = "RESOLVED"

    result["rule_resolution_status"] = scope_item.rule_resolution_status
    return result

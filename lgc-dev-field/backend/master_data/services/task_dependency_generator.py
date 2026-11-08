"""Geração automática de GeneratedTaskDependency a partir da ordem dos
TaskTemplateSteps já materializados em GeneratedTask — independente de
HTTP/DRF (mesmo espírito de task_generator.py). Chamado depois de gerar as
GeneratedTasks de um ScopeItem (master_data.services.task_generator),
nunca antes.

Conecta APENAS steps ADJACENTES do template (step_order consecutivo entre
os steps que de fato geraram tarefa) — nunca todos-com-todos. Quando um
step foi expandido por Path (repeatable=true + expansion_mode=PATH), a
conexão com o step vizinho respeita a expansion_key: dois lados expandidos
conectam só pela MESMA expansion_key (Path A -> Path A, Path B -> Path B;
nunca Path A -> Path B); quando só um lado tem mais de uma tarefa, esse
lado conecta com TODAS as tarefas do outro lado (que, tendo uma tarefa
só, é o mesmo de conectar 1-para-1 ou 1-para-N)."""

from django.db import transaction


def would_create_cycle(predecessor_task_id, successor_task_id, exclude_pk=None):
    """True se adicionar a aresta predecessor_task_id -> successor_task_id
    fechar um ciclo no grafo de GeneratedTaskDependency — ou seja, se
    predecessor_task_id já é alcançável A PARTIR DE successor_task_id
    seguindo as dependências existentes. `exclude_pk` ignora uma
    dependência específica na busca (útil ao validar a EDIÇÃO de uma
    dependência já existente, sem contar ela mesma como parte do grafo)."""
    from master_data.models import GeneratedTaskDependency

    if predecessor_task_id == successor_task_id:
        return True

    visited = set()
    stack = [successor_task_id]
    while stack:
        current = stack.pop()
        if current == predecessor_task_id:
            return True
        if current in visited:
            continue
        visited.add(current)
        qs = GeneratedTaskDependency.objects.filter(predecessor_task_id=current)
        if exclude_pk:
            qs = qs.exclude(pk=exclude_pk)
        stack.extend(qs.values_list("successor_task_id", flat=True))
    return False


def _pair_predecessors_and_successors(predecessors, successors):
    """Decide quais pares (predecessor, successor) conectar entre um step
    do template e o próximo, cobrindo os 4 casos do spec:

    1. nenhum lado expandido (1 tarefa de cada) -> 1 par.
    2. só o successor tem mais de uma tarefa (expandido por Path) -> o
       único predecessor conecta com CADA tarefa do successor.
    3. ambos têm mais de uma tarefa -> conecta só pela MESMA
       expansion_key (nunca Path A -> Path B).
    4. só o predecessor tem mais de uma tarefa -> CADA tarefa do
       predecessor conecta com o único successor.
    """
    if len(predecessors) == 1:
        predecessor = predecessors[0]
        return [(predecessor, s) for s in successors]
    if len(successors) == 1:
        successor = successors[0]
        return [(p, successor) for p in predecessors]
    by_key = {s.expansion_key: s for s in successors}
    pairs = []
    for p in predecessors:
        match = by_key.get(p.expansion_key)
        if match is not None:
            pairs.append((p, match))
    return pairs


def generate_dependencies_for_scope_item(scope_item):
    """Cria (ou reaproveita, se já existirem) as GeneratedTaskDependency
    entre as GeneratedTasks ativas já existentes de um ScopeItem,
    conectando steps ADJACENTES do template (por step_order), respeitando
    expansion_key quando aplicável. Idempotente — reforçado tanto pela
    UniqueConstraint (predecessor_task, successor_task, dependency_type)
    quanto por get_or_create() aqui. Sempre dependency_type="FS" (única
    gerada automaticamente nesta etapa).

    Retorna {"created": [...], "existing": [...]} com instâncias de
    GeneratedTaskDependency."""

    from master_data.models import GeneratedTask, GeneratedTaskDependency

    tasks = list(
        GeneratedTask.objects.filter(scope_item=scope_item, active=True).order_by("step_order", "expansion_key")
    )
    if len(tasks) < 2:
        return {"created": [], "existing": []}

    by_step_order = {}
    for task in tasks:
        by_step_order.setdefault(task.step_order, []).append(task)
    ordered_steps = sorted(by_step_order.keys())

    created = []
    existing = []

    with transaction.atomic():
        for i in range(len(ordered_steps) - 1):
            predecessors = by_step_order[ordered_steps[i]]
            successors = by_step_order[ordered_steps[i + 1]]
            for predecessor, successor in _pair_predecessors_and_successors(predecessors, successors):
                dependency, was_created = GeneratedTaskDependency.objects.get_or_create(
                    predecessor_task=predecessor,
                    successor_task=successor,
                    dependency_type="FS",
                    defaults={"active": True},
                )
                if was_created:
                    created.append(dependency)
                else:
                    existing.append(dependency)

    return {"created": created, "existing": existing}

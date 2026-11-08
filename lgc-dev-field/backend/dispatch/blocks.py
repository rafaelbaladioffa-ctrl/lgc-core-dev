"""Apontamento por bloco, feito pelo próprio técnico.

No datacenter o técnico não tem acesso ao celular durante o trabalho: ele aponta nos
intervalos (entrada, café, almoço, saída). Em vez de iniciar e concluir cada tarefa na hora,
informa o período do bloco e as tarefas que fez; o sistema reparte o tempo do bloco entre elas,
em sequência e sem sobrepor — então as horas somam o tempo real do bloco, sem duplicar
quando várias tarefas foram feitas juntas. As horas são uma ALOCAÇÃO (estimativa dentro do
bloco), por isso o despacho fica marcado como `time_allocated`.
"""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .adjustments import (
    AdjustmentError,
    _apply_status_window,
    _refresh_presence,
    _validate_window,
    assignment_worked_intervals,
)
from .models import TechnicianDailyPresence, TechnicianStatusEvent, WorkBlock

P = TechnicianDailyPresence
MAX_TASKS_PER_BLOCK = 60
# Status em que o técnico está fora da execução: ao voltar deles começa o próximo bloco.
AWAY_STATUSES = {
    P.STATUS_LUNCH, P.STATUS_PERSONAL, P.STATUS_MEAL, P.STATUS_MEETING, P.STATUS_TRAVELING,
    P.STATUS_SUPPORT, P.STATUS_SITE_BLOCKED, P.STATUS_AWAITING_RELEASE, P.STATUS_OFF_DUTY,
}
MIN_BLOCK_SECONDS = 60


class BlockError(AdjustmentError):
    """Regra do bloco violada; a mensagem é mostrada ao técnico."""


def _work_units(task):
    """Esforço da tarefa na unidade da atividade: labels (cabos × labels por cabo) em "Aplicar labels";
    metros (cabos × comprimento) quando o item tem comprimento; senão a quantidade planejada."""
    from api.reports import LABEL_ACTIVITY_CODE, _activity_quantity, labels_per_cable

    generated = task.generated_task
    if generated is None:
        return 0.0
    quantity = _activity_quantity(task, generated) or 0.0
    if generated.activity.code == LABEL_ACTIVITY_CODE:
        return quantity * labels_per_cable(generated.scope_item.cable_family)
    length_m = generated.scope_item.length_m
    if length_m and float(length_m) > 0:
        return quantity * float(length_m)
    return quantity


METER_ACTIVITY_CODES = ("CAB-RUN", "CAB-CUT", "CAB-DRESS", "CAB-MEASURE")  # tempo medido por metro de cabo
UNIT_LABELS = {
    "CABLE": "cabos", "LINK": "links", "CONNECTOR": "conectores", "CONNECTION": "conexões", "UNIT": "un", "METER": "m",
}


def work_units_label(task):
    """(quantidade produzida, rótulo da unidade) para medir tempo por unidade: labels em "Aplicar labels";
    metros (cabos × comprimento) nas atividades de cabo medidas em metro; nas demais, a quantidade na
    unidade da atividade (links, conexões, conectores...). Não é o peso da repartição do bloco."""
    from api.reports import LABEL_ACTIVITY_CODE, _activity_quantity, _activity_unit, labels_per_cable

    generated = task.generated_task
    if generated is None:
        return 0.0, ""
    quantity = _activity_quantity(task, generated) or 0.0
    code = generated.activity.code
    if code == LABEL_ACTIVITY_CODE:
        return quantity * labels_per_cable(generated.scope_item.cable_family), "labels"
    length_m = generated.scope_item.length_m
    if code in METER_ACTIVITY_CODES and length_m and float(length_m) > 0:
        return quantity * float(length_m), "m"
    unit = (_activity_unit(generated) or "").strip()
    return quantity, UNIT_LABELS.get(unit.upper(), unit.lower())


def _weight_basis(tasks):
    """Peso de cada tarefa na repartição do tempo: horas estimadas, se todas têm; senão o esforço
    na unidade da atividade (labels, metros), se todas têm; senão a quantidade planejada; senão igual."""
    estimated = [float(t.estimated_hours or 0) for t in tasks]
    if all(value > 0 for value in estimated):
        return estimated
    units = [_work_units(t) for t in tasks]
    if all(value > 0 for value in units):
        return units
    quantities = []
    for task in tasks:
        generated = task.generated_task
        value = task.quantity_planned
        if (value is None or float(value) <= 0) and generated is not None:
            value = generated.quantity
        quantities.append(float(value) if value is not None else 0.0)
    if all(value > 0 for value in quantities):
        return quantities
    return [1.0] * len(tasks)


def allocate_block(tasks, start, end):
    """[(início, fim)] sequenciais, um por tarefa, repartindo [start, end] pelos pesos."""
    weights = _weight_basis(tasks)
    total_weight = sum(weights)
    total_seconds = (end - start).total_seconds()
    intervals = []
    cursor = start
    for index, weight in enumerate(weights):
        if index == len(weights) - 1:
            task_end = end
        else:
            task_end = cursor + timedelta(seconds=round(total_seconds * weight / total_weight))
        intervals.append((cursor, task_end))
        cursor = task_end
    return intervals


def suggest_block_window(collaborator, now=None):
    """Início sugerido do bloco: o mais tarde entre o check-in do dia, a volta do último intervalo
    (café, almoço...) e o fim do último apontamento de hoje. O fim sugerido é agora."""
    from projects.models import ProjectTaskAssignment

    now = now or timezone.now()
    day = timezone.localtime(now).date()
    candidates = []
    presence = P.objects.filter(collaborator=collaborator, date=day, checked_in_at__isnull=False).first()
    if presence:
        candidates.append(presence.checked_in_at)
    previous_status = None
    for event in TechnicianStatusEvent.objects.filter(collaborator=collaborator, date=day, changed_at__lte=now).order_by("changed_at", "id"):
        if previous_status in AWAY_STATUSES and event.status not in AWAY_STATUSES:
            candidates.append(event.changed_at)  # voltou de um intervalo
        previous_status = event.status
    for assignment in ProjectTaskAssignment.objects.filter(collaborator=collaborator):
        for _start, end in assignment_worked_intervals(assignment, now):
            if timezone.localtime(end).date() == day:
                candidates.append(end)
    start = max(candidates) if candidates else now - timedelta(hours=1)
    return min(start, now), now


@transaction.atomic
def register_work_block(*, collaborator, entries, start, end):
    """Registra o bloco. `entries` = [{"task": ProjectTask, "complete": bool, "outcome": str, "quantity_done": str}].
    Devolve [{task_id, name, start, end, seconds, complete}]."""
    from projects.models import ProjectTask, ProjectTaskAssignment

    if not entries:
        raise BlockError("Selecione ao menos uma tarefa.")
    if len(entries) > MAX_TASKS_PER_BLOCK:
        raise BlockError(f"Um bloco aceita no máximo {MAX_TASKS_PER_BLOCK} tarefas.")
    try:
        _validate_window(start, end)
    except AdjustmentError as exc:
        raise BlockError(str(exc))
    if (end - start).total_seconds() < MIN_BLOCK_SECONDS:
        raise BlockError("O bloco precisa ter ao menos 1 minuto.")

    tasks = [entry["task"] for entry in entries]
    if len({t.pk for t in tasks}) != len(tasks):
        raise BlockError("Há tarefas repetidas no bloco.")
    # Um tipo de atividade por bloco: o técnico informa o horário de cada tipo, então o tempo por
    # tipo (e a taxa por hora) fica exato em vez de ser repartido por aproximação entre tipos.
    activities = {}
    for task in tasks:
        generated = task.generated_task
        activities[generated.activity_id if generated else None] = generated.activity.name if generated else "Sem atividade do catálogo"
    if len(activities) > 1:
        names = " e ".join(sorted(activities.values()))
        raise BlockError(f"O bloco mistura tipos de atividade ({names}). Registre um bloco para cada tipo, com o horário de cada um.")
    # Um grupo de material por bloco: o tempo por unidade só é comparável dentro do mesmo tipo de cabo.
    groups = {}
    for task in tasks:
        family = task.generated_task.scope_item.cable_family if task.generated_task else None
        groups[family.work_group if family and family.work_group else ""] = (
            family.get_work_group_display() if family and family.work_group else "Sem grupo"
        )
    if len(groups) > 1:
        names = " e ".join(sorted(groups.values()))
        raise BlockError(f"O bloco mistura grupos de material ({names}). Registre um bloco para cada grupo, com o horário de cada um.")
    assignments = {
        a.project_task_id: a
        for a in ProjectTaskAssignment.objects.select_for_update().filter(collaborator=collaborator, project_task__in=tasks)
    }
    for task in tasks:
        assignment = assignments.get(task.pk)
        if assignment is None:
            raise BlockError(f'A tarefa "{task.display_name}" não está despachada para você.')
        if assignment.status == ProjectTask.STATUS_COMPLETED:
            raise BlockError(f'A tarefa "{task.display_name}" já está concluída.')
        if assignment.status not in (ProjectTask.STATUS_NOT_STARTED, ProjectTask.STATUS_PAUSED):
            raise BlockError(f'Pause a tarefa "{task.display_name}" antes de registrar o bloco.')

    # Sem sobreposição com nenhum apontamento dele (nem das próprias tarefas do bloco).
    now = timezone.now()
    for other in ProjectTaskAssignment.objects.filter(collaborator=collaborator).select_related("project_task__task"):
        for other_start, other_end in assignment_worked_intervals(other, now):
            if other_start < end and other_end > start:
                raise BlockError(f'Esse horário já tem apontamento em "{other.project_task.display_name}".')

    first = tasks[0].generated_task
    block = WorkBlock.objects.create(
        collaborator=collaborator,
        date=timezone.localtime(start).date(),
        start=start,
        end=end,
        activity=first.activity if first else None,
        work_group=next(iter(groups)),
    )
    result = []
    intervals = allocate_block(tasks, start, end)
    for entry, (task_start, task_end) in zip(entries, intervals):
        task = entry["task"]
        assignment = assignments[task.pk]
        if assignment.assignment_start is None:
            assignment.assignment_start = task_start
        elif assignment.paused_at:
            assignment.pause_log = [*(assignment.pause_log or []), [assignment.paused_at.isoformat(), task_start.isoformat()]]
            assignment.paused_seconds = (assignment.paused_seconds or 0) + (task_start - assignment.paused_at).total_seconds()
        assignment.paused_at = None
        if entry.get("complete", True):
            assignment.assignment_end = task_end
            assignment.status = ProjectTask.STATUS_COMPLETED
            assignment.completion_outcome = entry.get("outcome") or ProjectTask.COMPLETION_OUTCOME_COMPLETED
            if entry.get("quantity_done"):
                assignment.quantity_done = entry["quantity_done"]
            intervals_done = assignment.working_intervals()
            assignment.actual_hours = round(sum((e - s).total_seconds() for s, e in intervals_done) / 3600, 2)
        else:
            assignment.status = ProjectTask.STATUS_PAUSED
            assignment.paused_at = task_end  # fica aberta: o próximo bloco continua daqui
        assignment.time_allocated = True
        assignment.work_block = block
        assignment.save()
        task.sync_from_assignments()
        result.append(
            {
                "task_id": task.pk,
                "name": task.display_name,
                "start": task_start,
                "end": task_end,
                "seconds": int((task_end - task_start).total_seconds()),
                "complete": bool(entry.get("complete", True)),
            }
        )

    # As horas produtivas saem da presença: o bloco inteiro vira "Em Execução".
    _, day = _apply_status_window(collaborator, start, end, P.STATUS_IN_PROGRESS, mark_adjusted=False)
    _refresh_presence(collaborator, day)
    return result

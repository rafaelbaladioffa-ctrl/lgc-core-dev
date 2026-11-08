"""Ajustes administrativos da timeline do técnico.

Diferente do ajuste de status do admin (que não registra horas), aqui o admin grava
exatamente o que o técnico gravaria — intervalos de trabalho nas tarefas e trocas de
status de presença — então as horas valem para todos os indicadores (utilização, HH,
produção, horas por status). Toda alteração exige motivo, é marcada como "ajustada"
(is_adjusted) e fica registrada em TimelineAdjustment com os valores antes e depois.
"""
from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import TechnicianDailyPresence, TechnicianStatusEvent, TimelineAdjustment

MAX_WINDOW_HOURS = 16
P = TechnicianDailyPresence
ADJUSTABLE_STATUSES = tuple(value for value, _label in P.STATUS_CHOICES if value != P.STATUS_NOT_STARTED)
# No editor da lista de status, "Sem registro" (not_started) apaga a barra do trecho.
EDITABLE_STATUSES = ADJUSTABLE_STATUSES + (P.STATUS_NOT_STARTED,)


class AdjustmentError(Exception):
    """Regra de negócio violada; a mensagem é mostrada ao administrador."""


def _validate_reason(reason):
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise AdjustmentError("Informe o motivo do ajuste.")
    return reason


def _validate_window(start, end):
    if end <= start:
        raise AdjustmentError("O fim precisa ser depois do início.")
    if timezone.localtime(start).date() != timezone.localtime(end).date():
        raise AdjustmentError("O trecho precisa começar e terminar no mesmo dia.")
    if end > timezone.now():
        raise AdjustmentError("Não é possível ajustar para o futuro.")
    if end - start > timedelta(hours=MAX_WINDOW_HOURS):
        raise AdjustmentError(f"O trecho não pode passar de {MAX_WINDOW_HOURS} horas.")


def _serialize_events(events):
    return [
        {"status": e.status, "changed_at": e.changed_at.isoformat(), "adjusted": e.is_adjusted} for e in events
    ]


def _day_events(collaborator, day):
    return list(TechnicianStatusEvent.objects.filter(collaborator=collaborator, date=day).order_by("changed_at", "id"))


def _apply_status_window(collaborator, start, end, status, restore_fn=None, mark_adjusted=True):
    """Define `status` no trecho [start, end) da linha do tempo do dia: apaga as trocas
    que caíam dentro, abre o trecho com o novo status e, no fim, volta ao status que
    valeria naquele instante. Devolve (antes, depois) já serializados."""
    day = timezone.localtime(start).date()
    events = _day_events(collaborator, day)
    before = _serialize_events(events)

    previous_status = None
    status_at_end = None
    for event in events:
        if event.changed_at < start:
            previous_status = event.status
        if event.changed_at <= end:
            status_at_end = event.status
    inside_ids = [e.id for e in events if start <= e.changed_at < end]
    if inside_ids:
        TechnicianStatusEvent.objects.filter(id__in=inside_ids).delete()

    if previous_status != status:
        TechnicianStatusEvent.objects.create(
            collaborator=collaborator, date=day, status=status, changed_at=start, is_adjusted=mark_adjusted
        )
    restore = status_at_end if status_at_end is not None else P.STATUS_AVAILABLE
    if restore_fn is not None:
        restore = restore_fn(status_at_end)
    if not any(e.changed_at == end for e in events) and restore != status:
        TechnicianStatusEvent.objects.create(
            collaborator=collaborator, date=day, status=restore, changed_at=end, is_adjusted=mark_adjusted
        )
    return before, day


def _refresh_presence(collaborator, day):
    """Alinha a presença do dia (status atual, check-in/out) com a linha do tempo ajustada."""
    events = _day_events(collaborator, day)
    if not events:
        return []
    first, last = events[0], events[-1]
    presence, _ = TechnicianDailyPresence.objects.get_or_create(collaborator=collaborator, date=day)
    presence.status = last.status
    presence.checked_in_at = min(filter(None, [presence.checked_in_at, first.changed_at]))
    presence.checked_out_at = last.changed_at if last.status == P.STATUS_OFF_DUTY else None
    presence.save(update_fields=("status", "checked_in_at", "checked_out_at", "updated_at"))
    return _serialize_events(events)


@transaction.atomic
def replace_status_events(*, user, collaborator, day, events, reason, deleted_at=()):
    """Edita a lista de status do dia: `events` é a lista COMPLETA desejada, [(status, instante)].
    Registros que continuam iguais (mesmo status e instante) são mantidos como estão; os
    alterados ou novos entram marcados como ajustados; os que sumiram da lista são excluídos.
    Serve para corrigir um status (trocar tipo ou horário), excluir um registro errado ou
    cadastrar um novo. `deleted_at` são os horários dos registros que o administrador EXCLUIU:
    em vez de o status anterior passar a valer por cima do trecho, o trecho fica sem registro
    (a barra some da timeline)."""
    reason = _validate_reason(reason)
    if not events:
        raise AdjustmentError("Mantenha ao menos um status no dia.")
    ordered = sorted(events, key=lambda item: item[1])
    now = timezone.now()
    previous_at = None
    for status, changed_at in ordered:
        if status not in EDITABLE_STATUSES:
            raise AdjustmentError("Status inválido.")
        if timezone.localtime(changed_at).date() != day:
            raise AdjustmentError("Todos os horários precisam ser do dia selecionado.")
        if changed_at > now:
            raise AdjustmentError("Não é possível registrar status no futuro.")
        if previous_at is not None and changed_at == previous_at:
            raise AdjustmentError("Dois status não podem ter o mesmo horário.")
        previous_at = changed_at

    current = _day_events(collaborator, day)
    before = _serialize_events(current)
    unused = {}
    for e in current:
        unused.setdefault((e.status, e.changed_at), []).append(e)
    for status, changed_at in ordered:
        bucket = unused.get((status, changed_at))
        if bucket:
            bucket.pop()  # registro idêntico já existe: mantém como está
            continue
        TechnicianStatusEvent.objects.create(
            collaborator=collaborator, date=day, status=status, changed_at=changed_at, is_adjusted=True
        )
    stale = [e for bucket in unused.values() for e in bucket]
    if stale:
        TechnicianStatusEvent.objects.filter(id__in=[e.id for e in stale]).delete()
    # Exclusão = apagar a barra: marca o trecho como "sem registro" a partir do horário excluído.
    stale_by_time = {e.changed_at: e for e in stale}
    for deleted in sorted(set(deleted_at)):
        original = stale_by_time.get(deleted)
        if original is None or original.status == P.STATUS_NOT_STARTED:
            continue
        previous = (
            TechnicianStatusEvent.objects.filter(collaborator=collaborator, date=day, changed_at__lt=deleted)
            .order_by("-changed_at", "-id")
            .first()
        )
        if previous is None or previous.status == P.STATUS_NOT_STARTED:
            continue  # nada desenhado antes (ou já em branco): a barra já some sozinha
        if TechnicianStatusEvent.objects.filter(collaborator=collaborator, date=day, changed_at=deleted).exists():
            continue
        TechnicianStatusEvent.objects.create(
            collaborator=collaborator, date=day, status=P.STATUS_NOT_STARTED, changed_at=deleted, is_adjusted=True
        )
    after = _refresh_presence(collaborator, day)
    return TimelineAdjustment.objects.create(
        user=user,
        collaborator=collaborator,
        date=day,
        kind=TimelineAdjustment.KIND_STATUS_WINDOW,
        reason=reason,
        before={"events": before},
        after={"events": after},
    )


@transaction.atomic
def adjust_status_window(*, user, collaborator, start, end, status, reason):
    """Corrige um trecho de status (ex.: técnico esqueceu de sair do almoço)."""
    reason = _validate_reason(reason)
    if status not in ADJUSTABLE_STATUSES:
        raise AdjustmentError("Status inválido.")
    _validate_window(start, end)
    before, day = _apply_status_window(collaborator, start, end, status)
    after = _refresh_presence(collaborator, day)
    return TimelineAdjustment.objects.create(
        user=user,
        collaborator=collaborator,
        date=day,
        kind=TimelineAdjustment.KIND_STATUS_WINDOW,
        reason=reason,
        before={"events": before},
        after={"events": after, "window": {"start": start.isoformat(), "end": end.isoformat(), "status": status}},
    )


def _snapshot_assignment(assignment):
    return {
        "status": assignment.status,
        "assignment_start": assignment.assignment_start.isoformat() if assignment.assignment_start else None,
        "assignment_end": assignment.assignment_end.isoformat() if assignment.assignment_end else None,
        "pause_log": assignment.pause_log,
        "paused_seconds": assignment.paused_seconds,
        "actual_hours": str(assignment.actual_hours) if assignment.actual_hours is not None else None,
        "completion_outcome": assignment.completion_outcome,
    }


@transaction.atomic
def register_execution(*, user, collaborator, task, start, end, pauses, reason, sync_presence=True):
    """Registra (ou corrige) a execução de `collaborator` em `task` como se o próprio
    técnico tivesse iniciado, pausado e concluído: horas reais válidas. Substitui o
    apontamento anterior dele nessa tarefa. Com `sync_presence`, os trechos trabalhados
    também viram "Em Execução" na linha do tempo de presença (que é de onde saem as
    horas produtivas)."""
    from projects.models import ProjectTask, ProjectTaskAssignment

    reason = _validate_reason(reason)
    _validate_window(start, end)
    ordered_pauses = sorted(pauses)
    cursor = start
    for pause_start, pause_end in ordered_pauses:
        if pause_end <= pause_start:
            raise AdjustmentError("Cada pausa precisa terminar depois de começar.")
        if pause_start < cursor or pause_end > end:
            raise AdjustmentError("As pausas precisam estar dentro da execução e não podem se sobrepor.")
        cursor = pause_end

    assignment, created = ProjectTaskAssignment.objects.get_or_create(
        project_task=task, collaborator=collaborator, defaults={"dispatched_by": user}
    )
    before = _snapshot_assignment(assignment)
    before["created"] = created

    assignment.assignment_start = start
    assignment.assignment_end = end
    assignment.paused_at = None
    assignment.pause_log = [[ps.isoformat(), pe.isoformat()] for ps, pe in ordered_pauses]
    assignment.paused_seconds = sum((pe - ps).total_seconds() for ps, pe in ordered_pauses)
    assignment.status = ProjectTask.STATUS_COMPLETED
    if not assignment.completion_outcome:
        assignment.completion_outcome = ProjectTask.COMPLETION_OUTCOME_COMPLETED
    intervals = assignment.working_intervals()
    assignment.actual_hours = round(sum((e - s).total_seconds() for s, e in intervals) / 3600, 2)
    assignment.is_adjusted = True
    assignment.save()
    task.sync_from_assignments()

    days = set()
    if sync_presence:
        for interval_start, interval_end in intervals:
            _, day = _apply_status_window(collaborator, interval_start, interval_end, P.STATUS_IN_PROGRESS)
            days.add(day)
    after_events = []
    for day in days:
        after_events += _refresh_presence(collaborator, day)

    after = _snapshot_assignment(assignment)
    after["presence_events"] = after_events
    return TimelineAdjustment.objects.create(
        user=user,
        collaborator=collaborator,
        date=timezone.localtime(start).date(),
        kind=TimelineAdjustment.KIND_EXECUTION,
        reason=reason,
        before={"assignment": before, "task_id": task.pk},
        after={"assignment": after, "task_id": task.pk},
    )


# --- Tarefa removida/excluída: apagar também o "Em Execução" que só existia por causa dela ----------


def assignment_worked_intervals(assignment, now):
    """[(início, fim)] em que o técnico trabalhou na tarefa, sem as pausas. Um trecho ainda
    em execução termina em `now`; pausa em aberto encerra o último trecho."""
    start = assignment.assignment_start
    if start is None:
        return []
    pauses = []
    for pair in assignment.pause_log or []:
        try:
            pauses.append((parse_datetime(pair[0]), parse_datetime(pair[1])))
        except (TypeError, IndexError, ValueError):
            continue
    pauses = sorted(p for p in pauses if p[0] and p[1])
    if assignment.paused_at:
        pauses.append((assignment.paused_at, None))
    intervals = []
    cursor = start
    for pause_start, pause_end in pauses:
        if pause_start > cursor:
            intervals.append((cursor, pause_start))
        if pause_end is None:
            return intervals
        cursor = max(cursor, pause_end)
    final_end = assignment.assignment_end
    if final_end is None and assignment.status == "in_progress":
        final_end = now
    if final_end is not None and final_end > cursor:
        intervals.append((cursor, final_end))
    return intervals


def _subtract(interval, cuts):
    pieces = [interval]
    for cut_start, cut_end in cuts:
        remaining = []
        for piece_start, piece_end in pieces:
            if cut_end <= piece_start or cut_start >= piece_end:
                remaining.append((piece_start, piece_end))
                continue
            if cut_start > piece_start:
                remaining.append((piece_start, cut_start))
            if cut_end < piece_end:
                remaining.append((cut_end, piece_end))
        pieces = remaining
    return pieces


def _split_by_day(start, end):
    while timezone.localtime(start).date() != timezone.localtime(end).date():
        next_midnight = timezone.make_aware(datetime.combine(timezone.localtime(start).date() + timedelta(days=1), time.min))
        yield start, next_midnight
        start = next_midnight
    yield start, end


def erase_presence_for_intervals(collaborator, removed, others):
    """Apaga da linha de presença o "Em Execução" dos trechos `removed` que nenhum dos
    trechos `others` (outras tarefas dele) cobre: a barra some, e as horas deixam de contar.
    No fim do trecho volta o status que valia — mas "Em Execução" sem tarefa rodando vira
    "Disponível"."""
    for interval in removed:
        for piece in _subtract(interval, others):
            for part_start, part_end in _split_by_day(*piece):
                if part_end <= part_start:
                    continue

                def restore(status_at_end, _end=part_end):
                    covered = any(o_start <= _end < o_end for o_start, o_end in others)
                    if status_at_end in (None, P.STATUS_IN_PROGRESS) and not covered:
                        return P.STATUS_AVAILABLE
                    return status_at_end

                _, day = _apply_status_window(
                    collaborator, part_start, part_end, P.STATUS_NOT_STARTED, restore_fn=restore, mark_adjusted=False
                )
                _refresh_presence(collaborator, day)


def erase_assignment_presence(assignment):
    """Chamado quando um despacho some (desalocar, devolver ao pool, excluir a tarefa)."""
    from core.models import Collaborator
    from projects.models import ProjectTaskAssignment

    collaborator = Collaborator.objects.filter(pk=assignment.collaborator_id).first()
    if collaborator is None:
        return
    now = timezone.now()
    removed = assignment_worked_intervals(assignment, now)
    if not removed:
        return
    others = []
    for other in ProjectTaskAssignment.objects.filter(collaborator_id=assignment.collaborator_id).exclude(pk=assignment.pk):
        others += assignment_worked_intervals(other, now)
    erase_presence_for_intervals(collaborator, removed, others)


@transaction.atomic
def remove_execution(*, user, collaborator, task, reason):
    """Exclui o apontamento do técnico numa tarefa: volta para pendente (continua despachada),
    zera início, fim, pausas e horas, e apaga a barra de execução da timeline."""
    from projects.models import ProjectTask, ProjectTaskAssignment

    from .services import release_stuck_execution

    reason = _validate_reason(reason)
    assignment = ProjectTaskAssignment.objects.filter(project_task=task, collaborator=collaborator).first()
    if assignment is None or assignment.assignment_start is None:
        raise AdjustmentError("Esse técnico não tem apontamento nessa tarefa.")
    before = _snapshot_assignment(assignment)
    now = timezone.now()
    removed = assignment_worked_intervals(assignment, now)
    others = []
    for other in ProjectTaskAssignment.objects.filter(collaborator=collaborator).exclude(pk=assignment.pk):
        others += assignment_worked_intervals(other, now)

    assignment.status = ProjectTask.STATUS_NOT_STARTED
    assignment.assignment_start = None
    assignment.assignment_end = None
    assignment.paused_at = None
    assignment.paused_seconds = 0
    assignment.pause_log = []
    assignment.actual_hours = None
    assignment.completion_outcome = ""
    assignment.quantity_done = ""
    assignment.is_adjusted = False
    assignment.save()
    task.sync_from_assignments()
    erase_presence_for_intervals(collaborator, removed, others)
    release_stuck_execution(collaborator.pk)
    return TimelineAdjustment.objects.create(
        user=user,
        collaborator=collaborator,
        date=timezone.localtime(removed[0][0]).date() if removed else timezone.localdate(),
        kind=TimelineAdjustment.KIND_EXECUTION,
        reason=reason,
        before={"assignment": before, "task_id": task.pk},
        after={"assignment": _snapshot_assignment(assignment), "task_id": task.pk, "removed": True},
    )

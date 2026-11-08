"""`GET /api/integration/labor-hours` — horas reais por técnico, projeto e dia, para o Financeiro (PT-10).

Contrato: `docs/plano-projeto-aprovado-ponta-a-ponta.md` §4.5 e `docs/integracao-centros-de-custo.md`
(seção "Field → Financeiro").

Fonte: a mesma que gera o HH do projeto (`ProjectTask.real_man_hours`, regra 1 do CLAUDE.md): o
`actual_hours` de cada despacho (`ProjectTaskAssignment`), que já desconta as pausas. Só existe hora de
técnico: tarefa sem técnico vinculado não gera HH (regra 8), e as horas históricas da planilha do supervisor
(`ProjectHourEntry`) não são lidas aqui (regra 9).

O dia é o de São Paulo. Um despacho que atravessa a meia-noite reparte as horas pelos dias, na proporção do
tempo de execução (intervalos de `working_intervals`) em cada um, com arredondamento a 2 casas que preserva
o total do despacho.
"""

import hashlib
import hmac
import logging
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_FLOOR

from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from projects.models import ProjectTask, ProjectTaskAssignment

logger = logging.getLogger(__name__)

MAX_PERIOD_DAYS = 62
CENT = Decimal("0.01")


class PeriodError(ValueError):
    pass


def parse_period(from_raw, to_raw):
    """`from`/`to` no formato AAAA-MM-DD (inclusive nos dois lados). Levanta `PeriodError` em pt-BR."""
    try:
        start = date.fromisoformat(from_raw or "")
        end = date.fromisoformat(to_raw or "")
    except ValueError:
        raise PeriodError("Informe `from` e `to` no formato AAAA-MM-DD.") from None
    if end < start:
        raise PeriodError("`to` não pode ser anterior a `from`.")
    if (end - start).days + 1 > MAX_PERIOD_DAYS:
        raise PeriodError(f"O período pode ter no máximo {MAX_PERIOD_DAYS} dias.")
    return start, end


def _split_by_day(intervals, total_hours: Decimal):
    """Reparte `total_hours` pelos dias (São Paulo) dos intervalos, proporcional ao tempo de cada dia.

    Maior resto: a soma dos dias é exatamente `total_hours` (já com 2 casas)."""
    seconds_by_day = defaultdict(float)
    for start, end in intervals:
        cursor = timezone.localtime(start)
        end_local = timezone.localtime(end)
        while cursor < end_local:
            next_midnight = timezone.make_aware(datetime.combine(cursor.date() + timedelta(days=1), time.min))
            piece_end = min(end_local, next_midnight)
            seconds_by_day[cursor.date()] += (piece_end - cursor).total_seconds()
            cursor = piece_end
    total_seconds = sum(seconds_by_day.values())
    if not seconds_by_day or total_seconds <= 0:
        return {}
    total_cents = int((total_hours / CENT).to_integral_value())
    exact = {day: total_cents * secs / total_seconds for day, secs in seconds_by_day.items()}
    floors = {day: int(value) for day, value in exact.items()}
    leftover = total_cents - sum(floors.values())
    for day in sorted(exact, key=lambda d: (exact[d] - floors[d], d), reverse=True)[:leftover]:
        floors[day] += 1
    return {day: Decimal(cents) * CENT for day, cents in floors.items() if cents}


def _assignment_rows(assignment, task_has_assignment_hours):
    """[(dia, horas Decimal)] de um despacho, ou [] quando ele não conta."""
    if assignment.actual_hours is not None:
        hours = Decimal(assignment.actual_hours).quantize(CENT)
        if hours <= 0:
            return []
        by_day = _split_by_day(assignment.working_intervals(), hours)
        if by_day:
            return list(by_day.items())
        # Sem intervalos (dado antigo): o dia do término do técnico, ou do início.
        anchor = assignment.assignment_end or assignment.assignment_start
        return [(timezone.localtime(anchor).date(), hours)] if anchor else []
    # Mesmo fallback do real_man_hours: tarefa com apontamento completo, mas sem horas por técnico
    # (dado histórico) — cada técnico vinculado recebe as horas de relógio da tarefa.
    task = assignment.project_task
    if task_has_assignment_hours or not task.has_real_time_tracking:
        return []
    hours = Decimal(str(task.worked_hours)).quantize(CENT)
    if hours <= 0:
        return []
    return [(timezone.localtime(task.actual_end).date(), hours)]


def compute_labor_hours(start: date, end: date):
    """(linhas, sem_vinculo): linhas `{axis_project_id, axis_collaborator_id, date, hours, adjusted}` dos
    projetos e técnicos já vinculados ao Axis, e o diagnóstico do que ficou de fora por falta de vínculo."""
    window_start = timezone.make_aware(datetime.combine(start, time.min))
    window_end = timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min))

    candidates = (
        ProjectTaskAssignment.objects.filter(assignment_start__isnull=False, assignment_start__lt=window_end)
        .filter(assignment_end__isnull=False, assignment_end__gte=window_start)
        .select_related("project_task__project", "collaborator")
    )
    # Fallback histórico: despacho sem actual_hours cuja tarefa tem apontamento completo.
    fallback_tasks = ProjectTask.objects.filter(
        actual_start__isnull=False, actual_end__gte=window_start, actual_start__lt=window_end
    ).values_list("pk", flat=True)
    candidates = candidates | ProjectTaskAssignment.objects.filter(
        project_task_id__in=list(fallback_tasks), actual_hours__isnull=True
    ).select_related("project_task__project", "collaborator")

    task_ids = {a.project_task_id for a in candidates}
    tasks_with_hours = set(
        ProjectTaskAssignment.objects.filter(project_task_id__in=task_ids, actual_hours__isnull=False)
        .values_list("project_task_id", flat=True)
    )

    totals = defaultdict(lambda: [Decimal("0"), False])
    unlinked = defaultdict(lambda: Decimal("0"))
    seen = set()
    for assignment in candidates:
        if assignment.pk in seen:
            continue
        seen.add(assignment.pk)
        project = assignment.project_task.project
        collaborator = assignment.collaborator
        for day, hours in _assignment_rows(assignment, assignment.project_task_id in tasks_with_hours):
            if day < start or day > end:
                continue
            if not project.axis_project_id or not collaborator.axis_collaborator_id:
                reason = "projeto_sem_vinculo" if not project.axis_project_id else "colaborador_sem_vinculo"
                unlinked[reason] += hours
                continue
            key = (str(project.axis_project_id), str(collaborator.axis_collaborator_id), day)
            totals[key][0] += hours
            totals[key][1] = totals[key][1] or assignment.is_adjusted

    rows = [
        {
            "axis_project_id": project_id,
            "axis_collaborator_id": collaborator_id,
            "date": day.isoformat(),
            "hours": format(hours.quantize(CENT), "f"),
            "adjusted": adjusted,
        }
        for (project_id, collaborator_id, day), (hours, adjusted) in sorted(
            totals.items(), key=lambda item: (item[0][2], item[0][0], item[0][1])
        )
        if hours > 0
    ]
    skipped = {reason: format(value.quantize(CENT), "f") for reason, value in unlinked.items()}
    return rows, skipped


def _api_key_is_valid(header: str | None) -> bool:
    expected = settings.FIELD_INTEGRATION_API_KEY
    return bool(header) and hmac.compare_digest(
        hashlib.sha256(expected.encode("utf-8")).digest(), hashlib.sha256(header.encode("utf-8")).digest()
    )


@require_GET
def labor_hours(request):
    if not settings.FIELD_INTEGRATION_API_KEY:
        return JsonResponse({"detail": "A integração com o Financeiro não está configurada."}, status=503)
    if not _api_key_is_valid(request.headers.get("X-Api-Key")):
        return JsonResponse({"detail": "API key inválida."}, status=401)
    try:
        start, end = parse_period(request.GET.get("from"), request.GET.get("to"))
    except PeriodError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    rows, skipped = compute_labor_hours(start, end)
    if skipped:
        # Diagnóstico: horas sem vínculo com o Axis não vão na lista (o Financeiro não as lançaria).
        logger.warning("labor-hours %s a %s: horas sem vínculo com o Axis: %s", start, end, skipped)
    return JsonResponse(rows, safe=False, headers={"X-Unlinked-Hours": ",".join(f"{k}={v}" for k, v in skipped.items())} if skipped else None)

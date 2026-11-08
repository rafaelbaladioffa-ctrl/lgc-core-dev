"""Relatório gerencial (GET /api/operations/reports/management/).

Visão comparativa do módulo Relatórios e Indicadores: tendência por
dia/semana/mês, ranking de técnicos, comparação entre sites e período atual
× período anterior (mesmo tamanho, imediatamente antes).

As definições de horas seguem exatamente as de api/reports.py (HH, horas
produtivas, jornada fixa de 8 h por dia com check-in, bloqueio externo,
ocioso interno, fallback RN-04). Os totais do período atual batem com os
de build_operations_reports — há teste cobrindo isso.
"""

from datetime import timedelta

from django.utils import timezone

from core.collaborator_scope import managed_collaborator_ids, supervisor_project_ids
from core.models import Collaborator
from dispatch.models import TechnicianDailyPresence
from projects.models import ProjectTask, ProjectTaskAssignment

from .reports import (
    EXTERNAL_BLOCK_STATUSES,
    INTERNAL_IDLE_STATUSES,
    MAX_PERIOD_DAYS,
    PRODUCTIVE_STATUSES,
    _local_date,
    _pct,
    _sum_statuses,
    build_operations_reports,
    collaborators_in_sites,
    parse_site_ids,
    presence_durations,
    utilization_band,
)

GROUPS = ("day", "week", "month")
WEEKDAY_LABELS = ("Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom")
MAX_ACTIVITIES = 8


def auto_group(days):
    if days <= 31:
        return "day"
    if days <= 120:
        return "week"
    return "month"


def _bucket_start(day, group):
    if group == "week":
        return day - timedelta(days=day.weekday())
    if group == "month":
        return day.replace(day=1)
    return day


def _next_bucket(start, group):
    if group == "week":
        return start + timedelta(days=7)
    if group == "month":
        return (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start + timedelta(days=1)


def _bucket_starts(date_from, date_to, group):
    starts = []
    cursor = _bucket_start(date_from, group)
    while cursor <= date_to:
        starts.append(cursor)
        cursor = _next_bucket(cursor, group)
    return starts


def _empty():
    return {
        "productive": 0.0,
        "block": 0.0,
        "idle": 0.0,
        "journey": 0.0,
        "man_hours": 0.0,
        "completed": 0,
    }


def _add(total, row):
    for key in total:
        total[key] += row[key]


def _summary(total, incomplete_days=0):
    utilization = _pct(total["productive"], total["journey"])
    return {
        "utilization_pct": utilization,
        "utilization_band": utilization_band(utilization),
        "productive_hours": round(total["productive"], 2),
        "journey_hours": round(total["journey"], 2),
        "man_hours": round(total["man_hours"], 2),
        "external_block_hours": round(total["block"], 2),
        "internal_idle_hours": round(total["idle"], 2),
        "completed_count": total["completed"],
        "incomplete_days": incomplete_days,
    }


def _collect(site_id, date_from, date_to, user, now):
    """Linhas (técnico, dia) com as horas de cada categoria + metadados dos técnicos."""
    project_ids = supervisor_project_ids(user)
    site_ids = parse_site_ids(site_id)
    # Conclusões por técnico (cada um conclui a própria parte), como em build_operations_reports.
    completed_qs = ProjectTaskAssignment.objects.filter(
        status=ProjectTask.STATUS_COMPLETED,
        assignment_end__date__gte=date_from,
        assignment_end__date__lte=date_to,
        project_task__exclude_from_reports=False,
    ).select_related("collaborator__person", "project_task")
    if project_ids is not None:
        completed_qs = completed_qs.filter(project_task__project_id__in=project_ids)
    if site_ids:
        completed_qs = completed_qs.filter(project_task__project__site_id__in=site_ids)

    collaborators = {}
    rows = {}
    assignment_hours = {}

    def row(collaborator_id, day):
        return rows.setdefault((collaborator_id, day), _empty())

    for assignment in completed_qs:
        collaborators[assignment.collaborator_id] = assignment.collaborator
        task = assignment.project_task
        day = _local_date(assignment.assignment_end)
        entry = row(assignment.collaborator_id, day)
        entry["completed"] += 1
        if assignment.actual_hours is not None:
            hours = float(assignment.actual_hours)
        elif assignment.assignment_start is None and task.has_real_time_tracking:
            hours = task.worked_hours
        else:
            continue  # sem apontamento: não gera HH
        entry["man_hours"] += hours
        if hours > 0:
            key = (assignment.collaborator_id, day)
            assignment_hours[key] = assignment_hours.get(key, 0.0) + hours

    allowed_ids = managed_collaborator_ids(user)
    if allowed_ids is not None:
        collaborators = {k: v for k, v in collaborators.items() if k in allowed_ids}
        rows = {k: v for k, v in rows.items() if k[0] in allowed_ids}
        assignment_hours = {k: v for k, v in assignment_hours.items() if k[0] in allowed_ids}

    presence_qs = TechnicianDailyPresence.objects.filter(
        date__gte=date_from, date__lte=date_to, checked_in_at__isnull=False
    )
    if site_ids:
        presence_qs = presence_qs.filter(collaborator_id__in=collaborators_in_sites(site_ids))
    if allowed_ids is not None:
        presence_qs = presence_qs.filter(collaborator_id__in=allowed_ids)
    checked_in = set(presence_qs.values_list("collaborator_id", "date"))

    missing_ids = {cid for cid, _ in checked_in} - set(collaborators)
    if missing_ids:
        for collaborator in (
            Collaborator.objects.filter(pk__in=missing_ids).select_related("person").prefetch_related("sites")
        ):
            collaborators[collaborator.id] = collaborator

    for cid, day in checked_in:
        row(cid, day)["journey"] = float(TechnicianDailyPresence.STANDARD_WORKDAY_HOURS)

    per_day, incomplete = presence_durations(list(collaborators), date_from, date_to, now)
    days_with_execution = set()
    for (cid, day), durations in per_day.items():
        in_progress = _sum_statuses(durations, PRODUCTIVE_STATUSES)
        if in_progress > 0:
            days_with_execution.add((cid, day))
        entry = row(cid, day)
        entry["productive"] += in_progress
        entry["block"] += _sum_statuses(durations, EXTERNAL_BLOCK_STATUSES)
        entry["idle"] += _sum_statuses(durations, INTERNAL_IDLE_STATUSES)
    for (cid, day), hours in assignment_hours.items():
        if (cid, day) not in days_with_execution:
            row(cid, day)["productive"] += min(hours, TechnicianDailyPresence.STANDARD_WORKDAY_HOURS)

    return {"rows": rows, "collaborators": collaborators, "incomplete": incomplete}


def _primary_site(collaborator):
    names = sorted(s.name for s in collaborator.sites.all())
    return names[0] if names else "Sem site"


def _aggregate(rows, key_fn):
    out = {}
    for (cid, day), entry in rows.items():
        _add(out.setdefault(key_fn(cid, day), _empty()), entry)
    return out


def _series(rows, starts, group, member=None):
    """Totais por bucket; `member` filtra técnicos (None = todos)."""
    by_bucket = {}
    for (cid, day), entry in rows.items():
        if member is not None and cid not in member:
            continue
        _add(by_bucket.setdefault(_bucket_start(day, group), _empty()), entry)
    return [
        {"start": start.isoformat(), **_summary(by_bucket.get(start, _empty()))} for start in starts
    ]


def build_management_report(*, site_id, date_from, date_to, group, user=None):
    now = timezone.now()
    days = (date_to - date_from).days + 1
    group = group if group in GROUPS else auto_group(days)

    prev_to = date_from - timedelta(days=1)
    prev_from = prev_to - timedelta(days=days - 1)

    current = _collect(site_id, date_from, date_to, user, now)
    previous = _collect(site_id, prev_from, prev_to, user, now)

    starts = _bucket_starts(date_from, date_to, group)
    prev_starts = _bucket_starts(prev_from, prev_to, group)

    def total_of(data):
        total = _empty()
        for entry in data["rows"].values():
            _add(total, entry)
        return total

    cur_total = total_of(current)
    prev_total = total_of(previous)
    technicians_active = len(current["collaborators"])

    # --- Técnicos ----------------------------------------------------------
    by_tech = _aggregate(current["rows"], lambda cid, day: cid)
    prev_by_tech = _aggregate(previous["rows"], lambda cid, day: cid)
    technicians = []
    for cid, total in by_tech.items():
        collaborator = current["collaborators"].get(cid)
        if collaborator is None:
            continue
        prev_util = _pct(prev_by_tech.get(cid, _empty())["productive"], prev_by_tech.get(cid, _empty())["journey"])
        summary = _summary(total, current["incomplete"].get(cid, 0))
        util_series = _series(current["rows"], starts, group, member={cid})
        technicians.append(
            {
                "id": cid,
                "name": collaborator.person.name,
                "site_name": _primary_site(collaborator),
                **summary,
                "previous_utilization_pct": prev_util,
                "utilization_delta": (
                    summary["utilization_pct"] - prev_util
                    if summary["utilization_pct"] is not None and prev_util is not None
                    else None
                ),
                "series": [p["utilization_pct"] for p in util_series],
            }
        )
    technicians.sort(key=lambda t: (t["utilization_pct"] is None, -(t["utilization_pct"] or 0), t["name"]))

    # --- Sites (site principal do técnico) ----------------------------------
    members_by_site = {}
    for cid, collaborator in current["collaborators"].items():
        members_by_site.setdefault(_primary_site(collaborator), set()).add(cid)
    prev_members_by_site = {}
    for cid, collaborator in previous["collaborators"].items():
        prev_members_by_site.setdefault(_primary_site(collaborator), set()).add(cid)

    sites = []
    for name, members in members_by_site.items():
        total = _empty()
        for (cid, _day), entry in current["rows"].items():
            if cid in members:
                _add(total, entry)
        prev_site_total = _empty()
        for (cid, _day), entry in previous["rows"].items():
            if cid in prev_members_by_site.get(name, ()):
                _add(prev_site_total, entry)
        summary = _summary(total, sum(current["incomplete"].get(cid, 0) for cid in members))
        prev_util = _pct(prev_site_total["productive"], prev_site_total["journey"])
        sites.append(
            {
                "name": name,
                "technicians": len(members),
                **summary,
                "previous_utilization_pct": prev_util,
                "utilization_delta": (
                    summary["utilization_pct"] - prev_util
                    if summary["utilization_pct"] is not None and prev_util is not None
                    else None
                ),
                "series": [p["utilization_pct"] for p in _series(current["rows"], starts, group, member=members)],
            }
        )
    sites.sort(key=lambda s: (s["utilization_pct"] is None, -(s["utilization_pct"] or 0), s["name"]))

    # --- Dia da semana -------------------------------------------------------
    by_weekday = _aggregate(current["rows"], lambda cid, day: day.weekday())
    weekdays = [
        {"label": WEEKDAY_LABELS[i], **_summary(by_weekday.get(i, _empty()))} for i in range(7)
    ]

    # --- Atividades e improdutivo por motivo: mesma base da tela principal ----
    base = build_operations_reports(
        site_id=site_id,
        date_from=date_from,
        date_to=date_to,
        log_entries_fn=lambda *args, **kwargs: [],
        user=user,
    )
    activities = [a for a in base["activity_productivity"] if a["sufficient_sample"]][:MAX_ACTIVITIES]

    return {
        "period": {"date_from": date_from.isoformat(), "date_to": date_to.isoformat(), "days": days, "group": group},
        "previous_period": {"date_from": prev_from.isoformat(), "date_to": prev_to.isoformat()},
        "generated_at": now.isoformat(),
        "kpis": {
            "current": {**_summary(cur_total, sum(current["incomplete"].values())), "technicians": technicians_active},
            "previous": {
                **_summary(prev_total, sum(previous["incomplete"].values())),
                "technicians": len(previous["collaborators"]),
            },
        },
        "series": _series(current["rows"], starts, group),
        "previous_series": _series(previous["rows"], prev_starts, group),
        "technicians": technicians,
        "sites": sites,
        "weekdays": weekdays,
        "unproductive_by_reason": base["unproductive_by_reason"],
        "activities": activities,
        "tracking_rate_pct": base["stats"]["tracking_rate_pct"],
        "max_period_days": MAX_PERIOD_DAYS,
    }

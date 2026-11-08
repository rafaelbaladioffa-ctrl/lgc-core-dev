"""Indicadores > Tendências (GET /api/indicators/trends/).

Série no tempo (dia/semana/mês) de três medidas:
- horas em execução (produtivas: execução + apoio a outro técnico);
- utilização (% da jornada), improdutivo por causa e homem-hora (HH) por período;
- horas improdutivas (disponível sem tarefa + bloqueio externo);
- tarefas executadas (conclusões no período, por técnico).

As definições são as do relatório gerencial (api/management_report.py) e, portanto, as de
api/reports.py: os totais batem com Relatórios e Indicadores para o mesmo período e filtros.

Filtros (um ou vários ids separados por vírgula): site, client (cliente) e region (regional).
Os filtros se combinam (E): o painel considera os sites que atendem a todos os que foram
informados — mesma regra de site da Central de Operações (técnico lotado no site; tarefas
do projeto do site).
"""

from datetime import date, timedelta

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.response import Response
from rest_framework.views import APIView

from core.collaborator_scope import supervisor_project_ids
from core.models import Site
from dispatch.models import TechnicianDailyPresence, TechnicianStatusEvent
from projects.models import ProjectTask, ProjectTaskAssignment

from .management_report import GROUPS, _bucket_start, _bucket_starts, _pct, _collect, _series, auto_group
from .operations import HasOperationsBoardPermission
from .reports import BATCH_MAX_HOURS, _execution_rows, _local_date, parse_site_ids

MAX_TREND_DAYS = 366
DEFAULT_DAYS = 30


def resolve_site_ids(site, client, region):
    """Ids de site que atendem a todos os filtros informados. None = sem filtro (todos);
    lista vazia = os filtros não casam com nenhum site."""
    site_ids, client_ids, region_ids = parse_site_ids(site), parse_site_ids(client), parse_site_ids(region)
    if not (site_ids or client_ids or region_ids):
        return None
    sites = Site.objects.all()
    if site_ids:
        sites = sites.filter(id__in=site_ids)
    if client_ids:
        sites = sites.filter(client_id__in=client_ids)
    if region_ids:
        sites = sites.filter(region_id__in=region_ids)
    return list(sites.values_list("id", flat=True))


def _zero_summary(start):
    return {
        "start": start.isoformat(),
        "productive_hours": 0.0,
        "external_block_hours": 0.0,
        "internal_idle_hours": 0.0,
        "completed_count": 0,
        "journey_hours": 0.0,
        "man_hours": 0.0,
        "utilization_pct": None,
    }


def _points(series):
    return [
        {
            "start": p["start"],
            "hours_execution": round(p["productive_hours"], 2),
            "hours_unproductive": round(p["external_block_hours"] + p["internal_idle_hours"], 2),
            "tasks_executed": p["completed_count"],
            "hours_external_block": round(p["external_block_hours"], 2),
            "hours_internal_idle": round(p["internal_idle_hours"], 2),
            "journey_hours": round(p["journey_hours"], 2),
            "man_hours": round(p["man_hours"], 2),
            "utilization_pct": p["utilization_pct"],
        }
        for p in series
    ]


def _totals(points):
    journey = sum(p["journey_hours"] for p in points)
    execution = sum(p["hours_execution"] for p in points)
    return {
        "hours_execution": round(execution, 2),
        "hours_unproductive": round(sum(p["hours_unproductive"] for p in points), 2),
        "tasks_executed": sum(p["tasks_executed"] for p in points),
        "hours_external_block": round(sum(p["hours_external_block"] for p in points), 2),
        "hours_internal_idle": round(sum(p["hours_internal_idle"] for p in points), 2),
        "journey_hours": round(journey, 2),
        "man_hours": round(sum(p["man_hours"] for p in points), 2),
        "utilization_pct": _pct(execution, journey),
    }


def _period(date_from, date_to, group):
    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "days": (date_to - date_from).days + 1,
        "group": group,
    }


def _collect_series(user, site_ids, date_from, date_to, group):
    """(starts, collect) — collect é None quando os filtros não casam com nenhum site."""
    starts = _bucket_starts(date_from, date_to, group)
    if site_ids is not None and not site_ids:
        return starts, None
    return starts, _collect(site_ids, date_from, date_to, user, timezone.now())


def build_trends(*, user, date_from, date_to, group, site_ids):
    starts, data = _collect_series(user, site_ids, date_from, date_to, group)
    series = [_zero_summary(s) for s in starts] if data is None else _series(data["rows"], starts, group)
    points = _points(series)
    return {
        "period": _period(date_from, date_to, group),
        "points": points,
        "totals": _totals(points),
        "max_period_days": MAX_TREND_DAYS,
    }


# --- Comparativos (por site, cliente, regional ou técnico) -----------------------------------

DIMENSIONS = ("site", "client", "region", "technician")
MAX_GROUPS = 8
MAX_HEATMAP_TECHNICIANS = 80


def _dimension_label(collaborator, dimension):
    """Rótulo do técnico na dimensão escolhida, pelo site principal dele (mesma regra do relatório gerencial)."""
    if dimension == "technician":
        return collaborator.person.name
    sites = sorted(collaborator.sites.all(), key=lambda s: s.name)
    if not sites:
        return {"site": "Sem site", "client": "Sem cliente", "region": "Sem regional"}[dimension]
    site = sites[0]
    if dimension == "site":
        return site.name or site.code or f"Site {site.pk}"
    if dimension == "client":
        return str(site.client) if site.client_id else "Sem cliente"
    return site.region.name if site.region_id else "Sem regional"


def build_breakdown(*, user, date_from, date_to, group, site_ids, dimension):
    starts, data = _collect_series(user, site_ids, date_from, date_to, group)
    groups = []
    if data is not None:
        members = {}
        for cid, collaborator in data["collaborators"].items():
            members.setdefault(_dimension_label(collaborator, dimension), set()).add(cid)
        entries = []
        for label, ids in members.items():
            points = _points(_series(data["rows"], starts, group, member=ids))
            totals = _totals(points)
            if totals["journey_hours"] or totals["hours_execution"] or totals["tasks_executed"]:
                entries.append({"label": label, "ids": ids, "points": points, "totals": totals})
        if dimension == "technician":
            entries.sort(key=lambda e: (e["totals"]["utilization_pct"] is None, -(e["totals"]["utilization_pct"] or 0), e["label"]))
            entries = entries[:MAX_HEATMAP_TECHNICIANS]
        else:
            entries.sort(key=lambda e: (-e["totals"]["hours_execution"], -e["totals"]["tasks_executed"], e["label"]))
            if len(entries) > MAX_GROUPS:
                rest = entries[MAX_GROUPS - 1 :]
                ids = set().union(*(e["ids"] for e in rest))
                points = _points(_series(data["rows"], starts, group, member=ids))
                entries = entries[: MAX_GROUPS - 1] + [
                    {"label": "Outros", "ids": ids, "points": points, "totals": _totals(points), "other": True}
                ]
        groups = [
            {"label": e["label"], "other": bool(e.get("other")), "totals": e["totals"], "points": e["points"]} for e in entries
        ]
    return {
        "period": _period(date_from, date_to, group),
        "dimension": dimension,
        "starts": [s.isoformat() for s in starts],
        "groups": groups,
    }


# --- Produção: fluxo de tarefas, planejado × realizado, produtividade e qualidade ---------------

MAX_ACTIVITIES = 12


def _task_scope(user, site_ids):
    qs = ProjectTask.objects.filter(exclude_from_reports=False)
    project_ids = supervisor_project_ids(user)
    if project_ids is not None:
        qs = qs.filter(project_id__in=project_ids)
    if site_ids is not None:
        qs = qs.filter(project__site_id__in=site_ids)
    return qs


def _bucketer(starts, group):
    index = {s: i for i, s in enumerate(starts)}

    def at(moment):
        if moment is None:
            return None
        day = moment if type(moment) is date else _local_date(moment)
        return index.get(_bucket_start(day, group))

    return at


def _flow(tasks_qs, date_from, date_to, starts, group):
    at = _bucketer(starts, group)
    n = len(starts)
    created, completed, planned = [0] * n, [0] * n, [0] * n
    est_hours, real_hours = [0.0] * n, [0.0] * n
    open_qs = tasks_qs.exclude(status=ProjectTask.STATUS_CANCELED)
    for moment in open_qs.filter(created_at__date__gte=date_from, created_at__date__lte=date_to).values_list("created_at", flat=True):
        i = at(moment)
        if i is not None:
            created[i] += 1
    done_qs = open_qs.filter(status=ProjectTask.STATUS_COMPLETED, actual_end__date__gte=date_from, actual_end__date__lte=date_to)
    for moment, est, real in done_qs.values_list("actual_end", "estimated_hours", "actual_hours"):
        i = at(moment)
        if i is None:
            continue
        completed[i] += 1
        if est is not None and real is not None:
            est_hours[i] += float(est)
            real_hours[i] += float(real)
    for moment in open_qs.filter(planned_end__date__gte=date_from, planned_end__date__lte=date_to).values_list("planned_end", flat=True):
        i = at(moment)
        if i is not None:
            planned[i] += 1
    # Fila no fim de cada período = criadas até ali − concluídas até ali (canceladas não contam).
    backlog_start = open_qs.filter(created_at__date__lt=date_from).count() - open_qs.filter(
        status=ProjectTask.STATUS_COMPLETED, created_at__date__lt=date_from, actual_end__date__lt=date_from
    ).count()
    backlog, running = [], backlog_start
    for i in range(n):
        running += created[i] - completed[i]
        backlog.append(max(running, 0))
    return [
        {
            "start": starts[i].isoformat(),
            "tasks_created": created[i],
            "tasks_completed": completed[i],
            "tasks_planned": planned[i],
            "backlog": backlog[i],
            "hours_estimated": round(est_hours[i], 2),
            "hours_real": round(real_hours[i], 2),
        }
        for i in range(n)
    ]


def _activity_productivity(tasks_qs, date_from, date_to, starts, group):
    at = _bucketer(starts, group)
    tasks = list(
        tasks_qs.filter(status=ProjectTask.STATUS_COMPLETED, actual_end__date__gte=date_from, actual_end__date__lte=date_to)
        .select_related("project", "task", "generated_task__activity", "generated_task__scope_item__cable_family")
        .prefetch_related("assignments__collaborator__person")
    )
    rows = _execution_rows(tasks)
    acc = {}
    for row in rows:
        if not row["included"] or not row["credited_quantity"] or not row["technician_hours"] or not row["date"]:
            continue
        i = at(date.fromisoformat(row["date"]))
        if i is None:
            continue
        a = acc.setdefault(
            row["activity_code"],
            {"code": row["activity_code"], "name": row["activity"], "unit": row["unit"], "q": [0.0] * len(starts), "h": [0.0] * len(starts), "n": 0},
        )
        a["q"][i] += row["credited_quantity"]
        a["h"][i] += row["technician_hours"]
        a["n"] += 1
    out = []
    for a in sorted(acc.values(), key=lambda a: (-a["n"], a["name"]))[:MAX_ACTIVITIES]:
        total_h = sum(a["h"])
        out.append(
            {
                "code": a["code"],
                "name": a["name"],
                "unit": a["unit"],
                "executions": a["n"],
                "rate": round(sum(a["q"]) / total_h, 2) if total_h else None,
                "points": [round(q / h, 2) if h else None for q, h in zip(a["q"], a["h"])],
            }
        )
    return out


def _quality(user, site_ids, date_from, date_to, starts, group):
    at = _bucketer(starts, group)
    n = len(starts)
    total, no_hours, batch = [0] * n, [0] * n, [0] * n
    qs = ProjectTaskAssignment.objects.filter(
        status=ProjectTask.STATUS_COMPLETED,
        assignment_end__date__gte=date_from,
        assignment_end__date__lte=date_to,
        project_task__exclude_from_reports=False,
    ).select_related("project_task")
    project_ids = supervisor_project_ids(user)
    if project_ids is not None:
        qs = qs.filter(project_task__project_id__in=project_ids)
    if site_ids is not None:
        qs = qs.filter(project_task__project__site_id__in=site_ids)
    for a in qs:
        i = at(a.assignment_end)
        if i is None:
            continue
        total[i] += 1
        if a.actual_hours is not None:
            hours = float(a.actual_hours)
        elif a.assignment_start is None and a.project_task.has_real_time_tracking:
            hours = a.project_task.worked_hours
        else:
            no_hours[i] += 1
            continue
        if 0 < hours < BATCH_MAX_HOURS:
            batch[i] += 1

    # Dias de presença incompletos: o último status do dia não foi Fim de Expediente nem Em Execução.
    incomplete = [0] * n
    from core.collaborator_scope import managed_collaborator_ids

    events = TechnicianStatusEvent.objects.filter(date__gte=date_from, date__lte=date_to)
    if site_ids is not None:
        from .reports import collaborators_in_sites

        events = events.filter(collaborator_id__in=collaborators_in_sites(site_ids))
    allowed = managed_collaborator_ids(user)
    if allowed is not None:
        events = events.filter(collaborator_id__in=allowed)
    last = {}
    for cid, day, status in events.order_by("collaborator_id", "date", "changed_at").values_list("collaborator_id", "date", "status"):
        last[(cid, day)] = status
    today = timezone.localdate()
    closing = (TechnicianDailyPresence.STATUS_OFF_DUTY, TechnicianDailyPresence.STATUS_IN_PROGRESS)
    for (cid, day), status in last.items():
        if day != today and status not in closing:
            idx = {s: i for i, s in enumerate(starts)}.get(_bucket_start(day, group))
            if idx is not None:
                incomplete[idx] += 1
    return [
        {
            "start": starts[i].isoformat(),
            "assignments": total[i],
            "no_hours": no_hours[i],
            "batch": batch[i],
            "suspect_pct": _pct(min(no_hours[i] + batch[i], total[i]), total[i]),
            "incomplete_days": incomplete[i],
        }
        for i in range(n)
    ]


def build_production(*, user, date_from, date_to, group, site_ids):
    starts = _bucket_starts(date_from, date_to, group)
    empty = site_ids is not None and not site_ids
    if empty:
        flow = [
            {"start": s.isoformat(), "tasks_created": 0, "tasks_completed": 0, "tasks_planned": 0, "backlog": 0, "hours_estimated": 0.0, "hours_real": 0.0}
            for s in starts
        ]
        quality = [
            {"start": s.isoformat(), "assignments": 0, "no_hours": 0, "batch": 0, "suspect_pct": None, "incomplete_days": 0}
            for s in starts
        ]
        activities = []
    else:
        scope = _task_scope(user, site_ids)
        flow = _flow(scope, date_from, date_to, starts, group)
        activities = _activity_productivity(scope, date_from, date_to, starts, group)
        quality = _quality(user, site_ids, date_from, date_to, starts, group)
    return {
        "period": _period(date_from, date_to, group),
        "flow": flow,
        "activities": activities,
        "quality": quality,
    }


# --- Views --------------------------------------------------------------------------------------


def _parse(request):
    """(date_from, date_to, group, site_ids) ou uma Response de erro 400."""
    params = request.query_params
    today = timezone.localdate()
    date_from = parse_date(params.get("date_from") or "") or (today - timedelta(days=DEFAULT_DAYS - 1))
    date_to = parse_date(params.get("date_to") or "") or today
    if date_from > date_to:
        return Response({"detail": "A data inicial não pode ser posterior à data final."}, status=400)
    days = (date_to - date_from).days + 1
    if days > MAX_TREND_DAYS:
        return Response({"detail": f"O período máximo é de {MAX_TREND_DAYS} dias."}, status=400)
    group = params.get("group")
    group = group if group in GROUPS else auto_group(days)
    site_ids = resolve_site_ids(params.get("site"), params.get("client"), params.get("region"))
    return date_from, date_to, group, site_ids


class IndicatorsTrendsView(APIView):
    """GET /api/indicators/trends/?date_from=&date_to=&group=day|week|month&site=&client=&region="""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        parsed = _parse(request)
        if isinstance(parsed, Response):
            return parsed
        date_from, date_to, group, site_ids = parsed
        return Response(build_trends(user=request.user, date_from=date_from, date_to=date_to, group=group, site_ids=site_ids))


class IndicatorsBreakdownView(APIView):
    """GET /api/indicators/trends/breakdown/?dimension=site|client|region|technician&(mesmos filtros)"""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        parsed = _parse(request)
        if isinstance(parsed, Response):
            return parsed
        date_from, date_to, group, site_ids = parsed
        dimension = request.query_params.get("dimension")
        if dimension not in DIMENSIONS:
            return Response({"detail": "Dimensão inválida."}, status=400)
        return Response(
            build_breakdown(user=request.user, date_from=date_from, date_to=date_to, group=group, site_ids=site_ids, dimension=dimension)
        )


class IndicatorsProductionView(APIView):
    """GET /api/indicators/trends/production/?(mesmos filtros) — fluxo de tarefas, produtividade e qualidade."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        parsed = _parse(request)
        if isinstance(parsed, Response):
            return parsed
        date_from, date_to, group, site_ids = parsed
        return Response(build_production(user=request.user, date_from=date_from, date_to=date_to, group=group, site_ids=site_ids))

"""Painel de Gestão de Sites — agregação somente leitura usada por
api/sites_panel.py. Visão de negócio e decisões em
docs/painel-gestao-sites.md; resumo das regras implementadas aqui:

- Carteira: projetos ativos (`is_active`) filtrados pelas mesmas abas da
  lista de projetos — Ativos, Pausados, Planejamentos, Finalizados — em
  qualquer combinação (padrão: as três primeiras). Finalizados nunca
  geram alerta.
- Avanço real/planejado IGNORAM tarefas canceladas (decisão 3) — por isso o
  % daqui pode diferir do resto do sistema. Planejado = % das tarefas cujo
  término previsto já passou; vira "sem base" (None) quando muitas tarefas
  não têm término previsto.
- Saúde do projeto: "late" (vermelho), "risk" (amarelo), "ok", "no_data"
  (cinza). Todo vermelho/amarelo carrega os motivos em texto.
- Técnico = colaborador ativo cujo cargo NÃO é de gestão (decisão 2).
- Site do técnico no dia = site do projeto da tarefa DESPACHADA a ele
  (decisão 1): em execução > concluída hoje > próxima da fila. Sem
  despacho, cai no site da lotação só quando ela é única.
- Capacidade x demanda fica de fora (decisão 4).
"""

from datetime import timedelta

from django.conf import settings
from django.db.models import Prefetch, Q
from django.utils import timezone

from core.access_scope import get_scope_for_user, scope_project_queryset
from core.collaborator_scope import is_supervisor_user, scope_collaborators, scope_supervisor_projects
from core.models import Collaborator, Site
from dispatch.models import TechnicianAbsence, TechnicianDailyPresence
from updates.models import ProjectDailyUpdate

from .models import Project, ProjectOccurrence, ProjectProgressSnapshot, ProjectTask, ProjectTaskAssignment

DEFAULT_THRESHOLDS = {
    "late_deviation_pp": 15,  # planejado - real >= isto → atrasado
    "risk_deviation_pp": 5,  # planejado - real >= isto → risco
    "ending_soon_days": 7,  # término em até N dias...
    "ending_soon_min_pct": 90,  # ...com real abaixo disto → risco
    "stalled_business_days": 3,  # em execução sem tarefa concluída há N dias úteis → risco
    "overdue_tasks_min": 3,  # tarefas vencidas >= isto...
    "overdue_tasks_pct": 10,  # ...ou >= este % → risco
    "planned_without_date_max_pct": 30,  # acima disto o planejado fica "sem base"
    "starting_soon_days": 7,
    "mobilization_days": 14,
}
DEFAULT_EXCLUDED_JOB_TITLE_KEYWORDS = ("Supervisor", "Coordenador", "Gerente")

EXECUTION_STATUSES = (Project.STATUS_IN_PROGRESS, Project.STATUS_PAUSED)
PLANNING_STATUSES = (Project.STATUS_PLANNING, Project.STATUS_NOT_STARTED)
FINISHED_STATUSES = (Project.STATUS_COMPLETED, Project.STATUS_CANCELED)

# Mesmas abas da lista de projetos (Ativos, Pausados, Planejamentos,
# Finalizados) — o filtro aceita qualquer combinação, ex. "active,paused".
STATUS_FILTERS = {
    "active": (Project.STATUS_IN_PROGRESS,),
    "paused": (Project.STATUS_PAUSED,),
    "planning": PLANNING_STATUSES,
    "finished": FINISHED_STATUSES,
}
DEFAULT_STATUS_FILTERS = ("active", "paused", "planning")


def parse_status_filters(value):
    """'active,paused' → ['active', 'paused']; vazio/inválido → padrão."""
    keys = [k.strip() for k in (value or "").split(",") if k.strip() in STATUS_FILTERS]
    return list(dict.fromkeys(keys)) or list(DEFAULT_STATUS_FILTERS)

HEALTH_LATE = "late"
HEALTH_RISK = "risk"
HEALTH_OK = "ok"
HEALTH_NO_DATA = "no_data"
HEALTH_RANK = {HEALTH_LATE: 3, HEALTH_RISK: 2, HEALTH_NO_DATA: 1, HEALTH_OK: 0}

# Categorias de técnico no dia — derivadas do status de presença.
TECH_EXECUTING = "executing"
TECH_UNPRODUCTIVE = "unproductive"  # disponível sem tarefa, sem acesso, aguardando liberação
TECH_BREAK = "break"  # almoço / particular
TECH_OFF_DUTY = "off_duty"
TECH_ON_LEAVE = "on_leave"
TECH_NO_CHECKIN = "no_checkin"
PRESENT_CATEGORIES = (TECH_EXECUTING, TECH_UNPRODUCTIVE, TECH_BREAK, TECH_OFF_DUTY)

GROUP_BY_CHOICES = ("site", "region", "client", "responsible")
# Ordem (hierarquia) usada ao combinar mais de uma dimensão de agrupamento.
GROUP_BY_ORDER = ("region", "client", "site", "responsible")


def parse_group_by(value):
    """Aceita uma dimensão ("site"), uma lista CSV ("region,client") ou um iterável e devolve
    a tupla de dimensões válidas na hierarquia Regional > Cliente > Site > Responsável.
    Valor vazio ou inválido cai no padrão ("site",)."""
    if isinstance(value, str):
        items = [v.strip() for v in value.split(",")]
    else:
        items = [str(v).strip() for v in (value or ())]
    chosen = {i for i in items if i in GROUP_BY_CHOICES}
    return tuple(d for d in GROUP_BY_ORDER if d in chosen) or ("site",)


def get_thresholds():
    return {**DEFAULT_THRESHOLDS, **getattr(settings, "SITES_PANEL_THRESHOLDS", {})}


def get_excluded_job_title_keywords():
    return tuple(getattr(settings, "SITES_PANEL_EXCLUDED_JOB_TITLE_KEYWORDS", DEFAULT_EXCLUDED_JOB_TITLE_KEYWORDS))


def business_days_between(start, end):
    """Dias úteis (seg–sex) de `start` (exclusivo) até `end` (inclusivo)."""
    if start >= end:
        return 0
    days = 0
    current = start
    while current < end:
        current += timedelta(days=1)
        if current.weekday() < 5:
            days += 1
    return days


def previous_business_day(day):
    day -= timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


def _fmt(day):
    return day.strftime("%d/%m") if day else ""


# ---------------------------------------------------------------------------
# Saúde do projeto
# ---------------------------------------------------------------------------


def compute_progress(tasks, now, thresholds=None):
    """(real_pct, planned_pct) ignorando canceladas. planned_pct é None
    quando não há base (muitas tarefas sem término previsto)."""
    thresholds = thresholds or get_thresholds()
    valid = [t for t in tasks if t.status != ProjectTask.STATUS_CANCELED]
    if not valid:
        return None, None
    completed = sum(1 for t in valid if t.status == ProjectTask.STATUS_COMPLETED)
    real_pct = round(completed / len(valid) * 100)
    without_date = sum(1 for t in valid if t.planned_end is None)
    if without_date / len(valid) * 100 > thresholds["planned_without_date_max_pct"]:
        return real_pct, None
    due = sum(1 for t in valid if t.planned_end is not None and t.planned_end <= now)
    return real_pct, round(due / len(valid) * 100)


def compute_project_health(project, tasks, occurrences, today, now, thresholds=None):
    """Classifica o projeto e devolve (health, reasons, metrics). Cada motivo
    é {"level": "late"|"risk"|"no_data", "code": str, "text": str}."""
    thresholds = thresholds or get_thresholds()
    valid = [t for t in tasks if t.status != ProjectTask.STATUS_CANCELED]
    real_pct, planned_pct = compute_progress(tasks, now, thresholds)
    deviation = planned_pct - real_pct if (real_pct is not None and planned_pct is not None) else None
    overdue_tasks = [
        t for t in valid if t.status != ProjectTask.STATUS_COMPLETED and t.planned_end is not None and t.planned_end < now
    ]
    reasons = []

    def add(level, code, text):
        reasons.append({"level": level, "code": code, "text": text})

    in_execution = project.status in EXECUTION_STATUSES
    if project.status in FINISHED_STATUSES:
        pass  # finalizado: sem alertas de prazo/avanço
    elif project.status in PLANNING_STATUSES:
        if project.planned_start and project.planned_start < today:
            add(HEALTH_RISK, "start_late", f"Início previsto para {_fmt(project.planned_start)} e o projeto não iniciou")
        if project.planned_end and project.planned_end < today:
            add(HEALTH_LATE, "end_passed", f"Término previsto ({_fmt(project.planned_end)}) já passou e o projeto nem iniciou")
    else:
        if project.planned_end and project.planned_end < today:
            add(HEALTH_LATE, "end_passed", f"Término previsto ({_fmt(project.planned_end)}) já passou e o projeto está em {real_pct or 0}%")
        if deviation is not None and deviation >= thresholds["late_deviation_pp"]:
            add(HEALTH_LATE, "deviation", f"Avanço {deviation} pp abaixo do planejado ({real_pct}% real x {planned_pct}% planejado)")
        elif deviation is not None and deviation >= thresholds["risk_deviation_pp"]:
            add(HEALTH_RISK, "deviation", f"Avanço {deviation} pp abaixo do planejado ({real_pct}% real x {planned_pct}% planejado)")
        if (
            project.planned_end
            and today <= project.planned_end <= today + timedelta(days=thresholds["ending_soon_days"])
            and real_pct is not None
            and real_pct < thresholds["ending_soon_min_pct"]
        ):
            add(HEALTH_RISK, "ending_soon", f"Término em {_fmt(project.planned_end)} com {real_pct}% concluído")
        if project.status == Project.STATUS_IN_PROGRESS and valid and real_pct is not None and real_pct < 100:
            completions = [t.actual_end for t in valid if t.status == ProjectTask.STATUS_COMPLETED and t.actual_end]
            last_progress = max(completions).date() if completions else project.actual_start
            if last_progress:
                idle = business_days_between(last_progress, today)
                if idle >= thresholds["stalled_business_days"]:
                    add(HEALTH_RISK, "stalled", f"Sem tarefa concluída há {idle} dias úteis")

    if valid and overdue_tasks:
        overdue_pct = len(overdue_tasks) / len(valid) * 100
        if len(overdue_tasks) >= thresholds["overdue_tasks_min"] or overdue_pct >= thresholds["overdue_tasks_pct"]:
            add(HEALTH_RISK, "overdue_tasks", f"{len(overdue_tasks)} tarefa(s) com término previsto vencido")

    severe = [
        o for o in occurrences
        if o.severity in (ProjectOccurrence.SEVERITY_HIGH, ProjectOccurrence.SEVERITY_CRITICAL)
    ]
    if severe:
        first = severe[0]
        days_open = (today - first.occurred_at).days if first.occurred_at else 0
        label = "crítica" if first.severity == ProjectOccurrence.SEVERITY_CRITICAL else "alta"
        extra = f" (+{len(severe) - 1})" if len(severe) > 1 else ""
        add(HEALTH_RISK, "occurrence", f"Ocorrência {label} aberta há {days_open} dia(s): {first.title}{extra}")

    if in_execution and not reasons:
        if not valid:
            add(HEALTH_NO_DATA, "no_tasks", "Projeto em execução sem tarefas cadastradas")
        elif not project.planned_end:
            add(HEALTH_NO_DATA, "no_end", "Projeto sem término previsto")

    if any(r["level"] == HEALTH_LATE for r in reasons):
        health = HEALTH_LATE
    elif any(r["level"] == HEALTH_RISK for r in reasons):
        health = HEALTH_RISK
    elif reasons:
        health = HEALTH_NO_DATA
    else:
        health = HEALTH_OK
    reasons.sort(key=lambda r: -HEALTH_RANK[r["level"]])

    metrics = {
        "real_pct": real_pct,
        "planned_pct": planned_pct,
        "deviation_pp": deviation,
        "tasks_total": len(valid),
        "tasks_completed": sum(1 for t in valid if t.status == ProjectTask.STATUS_COMPLETED),
        "tasks_overdue": len(overdue_tasks),
    }
    return health, reasons, metrics


# ---------------------------------------------------------------------------
# Técnicos do dia
# ---------------------------------------------------------------------------


def technician_queryset():
    qs = Collaborator.objects.filter(is_active=True)
    for keyword in get_excluded_job_title_keywords():
        qs = qs.exclude(job_title__name__icontains=keyword)
    return qs


def _presence_category(presence, absence):
    if absence:
        return TECH_ON_LEAVE
    if not presence or presence.status == TechnicianDailyPresence.STATUS_NOT_STARTED:
        return TECH_NO_CHECKIN
    if presence.status == TechnicianDailyPresence.STATUS_IN_PROGRESS:
        return TECH_EXECUTING
    if presence.status == TechnicianDailyPresence.STATUS_OFF_DUTY:
        return TECH_OFF_DUTY
    productivity = TechnicianDailyPresence.PRESENCE_PRODUCTIVITY.get(presence.status)
    if productivity == TechnicianDailyPresence.PRODUCTIVITY_PRODUCTIVE:
        return TECH_EXECUTING
    if productivity == TechnicianDailyPresence.PRODUCTIVITY_UNPRODUCTIVE:
        return TECH_UNPRODUCTIVE
    return TECH_BREAK


def resolve_dispatch_of_day(assignments, today):
    """Escolhe o despacho que define onde o técnico está hoje (decisão 1):
    em execução > concluído hoje > próximo da fila."""
    executing = [
        a for a in assignments
        if a.assignment_start and not a.assignment_end
        and a.status in (ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED)
    ]
    if executing:
        return max(executing, key=lambda a: a.assignment_start), "executing"
    finished_today = [a for a in assignments if a.assignment_end and timezone.localtime(a.assignment_end).date() == today]
    if finished_today:
        return max(finished_today, key=lambda a: a.assignment_end), "finished_today"
    queued = [
        a for a in assignments
        if not a.assignment_end and a.status == ProjectTask.STATUS_NOT_STARTED
    ]
    if queued:
        return min(queued, key=lambda a: (a.queue_order, a.dispatched_at)), "queued"
    return None, None


def build_technicians_of_day(today, project_ids_in_scope, site_ids_in_scope=None, user=None):
    """Lista de técnicos com categoria de presença e local do dia. Só
    entram técnicos cujo despacho do dia é de um projeto do escopo OU (sem
    despacho) com lotação em algum site do escopo."""
    collaborators = list(
        scope_collaborators(technician_queryset(), user).select_related("person", "job_title").prefetch_related("sites")
    )
    ids = [c.id for c in collaborators]
    presences = {p.collaborator_id: p for p in TechnicianDailyPresence.objects.filter(collaborator_id__in=ids, date=today)}
    absences = {
        a.collaborator_id: a
        for a in TechnicianAbsence.objects.filter(collaborator_id__in=ids, date_from__lte=today, date_to__gte=today)
    }
    assignments_by_collaborator = {}
    open_or_today = (
        ProjectTaskAssignment.objects.filter(collaborator_id__in=ids, project_task__project__is_active=True)
        .filter(
            Q(assignment_end__isnull=True, status__in=(
                ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED, ProjectTask.STATUS_NOT_STARTED
            ))
            | Q(assignment_end__date=today)
        )
        .select_related("project_task__project", "project_task__task")
    )
    for a in open_or_today:
        assignments_by_collaborator.setdefault(a.collaborator_id, []).append(a)

    result = []
    for c in collaborators:
        assignment, how = resolve_dispatch_of_day(assignments_by_collaborator.get(c.id, []), today)
        site_ids = [s.id for s in c.sites.all()]
        project = assignment.project_task.project if assignment else None
        if project is not None and project.id in project_ids_in_scope:
            site_id = project.site_id
        elif assignment is not None:
            continue  # despachado em projeto fora do escopo/filtro do painel
        elif len(site_ids) == 1:
            site_id = site_ids[0]
        elif site_ids and (site_ids_in_scope is None or set(site_ids) & site_ids_in_scope):
            site_id = None  # sem despacho e lotação múltipla: só no total geral
        else:
            continue  # sem despacho e sem lotação: não é técnico de site
        if site_ids_in_scope is not None and site_id is not None and site_id not in site_ids_in_scope:
            continue
        presence = presences.get(c.id)
        absence = absences.get(c.id)
        category = _presence_category(presence, absence)
        result.append(
            {
                "id": c.id,
                "name": c.person.name if c.person_id else str(c),
                "job_title": c.job_title.name if c.job_title_id else "",
                "category": category,
                "status_display": (
                    (absence.reason or "Férias / Ausência") if absence
                    else presence.get_status_display() if presence else "Sem check-in"
                ),
                "leave_until": absence.date_to if absence else None,
                "site_id": site_id,
                "project_id": project.id if project else None,
                "dispatched": assignment is not None and project is not None,
                "dispatch_kind": how if project is not None else None,
                "task_name": assignment.project_task.display_name if assignment and project is not None else "",
            }
        )
    return result


def _empty_tech_counts():
    return {
        "total": 0, "present": 0, "executing": 0, "unproductive": 0, "break": 0,
        "off_duty": 0, "on_leave": 0, "no_checkin": 0, "no_dispatch": 0,
    }


def _count_tech(counts, tech):
    counts["total"] += 1
    counts[tech["category"]] += 1
    if tech["category"] in PRESENT_CATEGORIES:
        counts["present"] += 1
    if not tech["dispatched"]:
        counts["no_dispatch"] += 1


# ---------------------------------------------------------------------------
# Painel
# ---------------------------------------------------------------------------


def _client_name(client):
    return str(client) if client else "Sem cliente"


def _site_label(site):
    if not site:
        return "Sem site"
    return f"{site.code} · {site.name}" if site.code and site.name else (site.name or site.code)


def _update_status(updates, today):
    """sent = atualização enviada hoje ou no último dia útil; draft =
    existe mas não foi enviada; missing = nenhuma."""
    reference = previous_business_day(today)
    recent = [u for u in updates if u.date >= reference]
    if any(u.sent_at for u in recent):
        return "sent"
    if recent:
        return "draft"
    return "missing"


def _single_group_key(project, group_by):
    if group_by == "region":
        region = project.site.region if project.site_id else None
        if region:
            return f"region:{region.id}", region.name, region.get_country_display()
        return "region:none", "Sem regional", ""
    if group_by == "client":
        if project.client_id:
            return f"client:{project.client_id}", _client_name(project.client), ""
        return "client:none", "Sem cliente", ""
    if group_by == "responsible":
        resp = project.responsible_cstr
        if resp:
            return f"responsible:{resp.id}", resp.person.name, "Responsável CSTR"
        return "responsible:none", "Sem responsável", ""
    site = project.site
    if site:
        region = site.region
        sub = " · ".join(x for x in [region.name if region else "Sem regional", _client_name(site.client)] if x)
        return f"site:{site.id}", _site_label(site), sub
    return "site:none", "Sem site", ""


def _group_key(project, group_by):
    """(chave, rótulo, sub-rótulo) do grupo do projeto. Com mais de uma dimensão, as chaves
    e os rótulos das dimensões são combinados (ex.: "Sudeste · Alfa Data Centers")."""
    dims = group_by if isinstance(group_by, tuple) else parse_group_by(group_by)
    if len(dims) == 1:
        return _single_group_key(project, dims[0])
    parts = [_single_group_key(project, d) for d in dims]
    return "|".join(x[0] for x in parts), " · ".join(x[1] for x in parts), ""


def build_sites_panel(user, *, group_by="site", today=None, filters=None, include_technicians=True):
    filters = filters or {}
    group_by = parse_group_by(group_by)
    thresholds = get_thresholds()
    today = today or timezone.localdate()
    now = timezone.now()

    status_keys = parse_status_filters(filters.get("status"))
    statuses = [st for key in status_keys for st in STATUS_FILTERS[key]]
    projects_qs = Project.objects.filter(is_active=True, status__in=statuses)
    projects_qs = scope_project_queryset(projects_qs, user)
    # Supervisor só enxerga os projetos em que é Responsável CSTR.
    projects_qs = scope_supervisor_projects(projects_qs, user)
    countries = [c.strip() for c in str(filters.get("country") or "").split(",") if c.strip()]
    if countries:
        projects_qs = projects_qs.filter(site__region__country__in=countries)
    if filters.get("region"):
        projects_qs = projects_qs.filter(site__region_id=filters["region"])
    if filters.get("client"):
        projects_qs = projects_qs.filter(client_id=filters["client"])
    if filters.get("site"):
        projects_qs = projects_qs.filter(site_id=filters["site"])
    if filters.get("responsible"):
        projects_qs = projects_qs.filter(responsible_cstr_id=filters["responsible"])

    trend_from = today - timedelta(days=7)
    projects = list(
        projects_qs.select_related(
            "client", "site", "site__client", "site__region", "responsible_cstr__person", "project_type"
        ).prefetch_related(
            Prefetch("project_tasks", queryset=ProjectTask.objects.only(
                "id", "project_id", "status", "planned_start", "planned_end", "actual_end"
            )),
            Prefetch(
                "occurrences",
                queryset=ProjectOccurrence.objects.filter(
                    status__in=(ProjectOccurrence.STATUS_OPEN, ProjectOccurrence.STATUS_IN_PROGRESS)
                ).order_by("occurred_at"),
                to_attr="open_occurrences",
            ),
            Prefetch(
                "client_daily_updates",
                queryset=ProjectDailyUpdate.objects.filter(date__gte=today - timedelta(days=7)).only(
                    "id", "project_id", "date", "sent_at"
                ),
                to_attr="recent_updates",
            ),
            Prefetch(
                "progress_snapshots",
                queryset=ProjectProgressSnapshot.objects.filter(date__gte=trend_from).order_by("date"),
                to_attr="recent_snapshots",
            ),
        )
    )
    project_ids = {p.id for p in projects}
    projects_by_id = {p.id: p for p in projects}

    technicians = []
    if include_technicians:
        if filters.get("site"):
            site_scope = {int(filters["site"])}
        elif (
            any(filters.get(k) for k in ("country", "region", "client", "responsible"))
            or set(status_keys) != set(DEFAULT_STATUS_FILTERS)
            or is_supervisor_user(user)
        ):
            site_scope = {p.site_id for p in projects if p.site_id}
        else:
            site_scope = None
        technicians = build_technicians_of_day(today, project_ids, site_scope, user=user)
        # Escopo de gestor/cliente: só técnicos de sites que ele enxerga.
        scope = get_scope_for_user(user)
        if scope is not None and scope.get("sites") is not None:
            technicians = [t for t in technicians if t["site_id"] in scope["sites"]]
    technicians_by_project = {}
    for t in technicians:
        if t["project_id"]:
            technicians_by_project.setdefault(t["project_id"], []).append(t)

    severity_rank = {
        ProjectOccurrence.SEVERITY_CRITICAL: 0, ProjectOccurrence.SEVERITY_HIGH: 1,
        ProjectOccurrence.SEVERITY_MEDIUM: 2, ProjectOccurrence.SEVERITY_LOW: 3,
    }
    project_rows = []
    for p in projects:
        tasks = list(p.project_tasks.all())
        occurrences = sorted(p.open_occurrences, key=lambda o: (severity_rank.get(o.severity, 9), o.occurred_at))
        health, reasons, metrics = compute_project_health(p, tasks, occurrences, today, now, thresholds)
        site = p.site
        region = site.region if site else None
        update_status = _update_status(p.recent_updates, today) if p.status == Project.STATUS_IN_PROGRESS else None
        key, label, _ = _group_key(p, group_by)
        project_rows.append(
            {
                "id": p.id,
                "code": p.code,
                "name": p.name,
                "status": p.status,
                "status_display": p.get_status_display(),
                "group_key": key,
                "group_label": label,
                "site": {"id": site.id, "name": site.name, "code": site.code} if site else None,
                "region": {"id": region.id, "name": region.name, "country": region.country} if region else None,
                "client": {"id": p.client_id, "name": _client_name(p.client)} if p.client_id else None,
                "responsible_cstr": (
                    {"id": p.responsible_cstr_id, "name": p.responsible_cstr.person.name} if p.responsible_cstr_id else None
                ),
                "project_type": p.project_type.name if p.project_type_id else "",
                "planned_start": p.planned_start,
                "planned_end": p.planned_end,
                **metrics,
                "health": health,
                "reasons": reasons,
                "occurrences_open": len(occurrences),
                "occurrences_severe": sum(
                    1 for o in occurrences
                    if o.severity in (ProjectOccurrence.SEVERITY_HIGH, ProjectOccurrence.SEVERITY_CRITICAL)
                ),
                "update_status": update_status,
                "trend": [{"date": s.date, "percent": s.percent} for s in p.recent_snapshots],
                "technicians_today": [
                    {"id": t["id"], "name": t["name"], "category": t["category"], "status_display": t["status_display"]}
                    for t in technicians_by_project.get(p.id, [])
                ],
            }
        )

    # ---- grupos -------------------------------------------------------------
    groups = {}

    def group_for(key, label, sublabel):
        if key not in groups:
            groups[key] = {
                "key": key, "label": label, "sublabel": sublabel, "health": HEALTH_OK,
                "projects": {"in_progress": 0, "paused": 0, "planning": 0, "finished": 0},
                "alerts": {"late": 0, "risk": 0, "no_data": 0},
                "technicians": _empty_tech_counts() if include_technicians else None,
                "occurrences_open": 0, "updates_pending": 0, "responsibles": set(), "project_ids": [],
            }
        return groups[key]

    for row, p in zip(project_rows, projects):
        key, label, sublabel = _group_key(p, group_by)
        g = group_for(key, label, sublabel)
        g["project_ids"].append(row["id"])
        if p.status == Project.STATUS_IN_PROGRESS:
            g["projects"]["in_progress"] += 1
        elif p.status == Project.STATUS_PAUSED:
            g["projects"]["paused"] += 1
        elif p.status in FINISHED_STATUSES:
            g["projects"]["finished"] += 1
        else:
            g["projects"]["planning"] += 1
        if row["health"] != HEALTH_OK:
            g["alerts"][row["health"]] += 1
        if HEALTH_RANK[row["health"]] > HEALTH_RANK[g["health"]]:
            g["health"] = row["health"]
        g["occurrences_open"] += row["occurrences_open"]
        if row["update_status"] in ("draft", "missing"):
            g["updates_pending"] += 1
        if row["responsible_cstr"]:
            g["responsibles"].add(row["responsible_cstr"]["name"])

    if include_technicians:
        site_objs = {p.site_id: p.site for p in projects if p.site_id}
        missing_site_ids = {t["site_id"] for t in technicians if t["site_id"]} - set(site_objs)
        site_objs.update({s.id: s for s in Site.objects.filter(id__in=missing_site_ids).select_related("region", "client")})
        for t in technicians:
            project = projects_by_id.get(t["project_id"]) if t["project_id"] else None
            if project is not None:
                key, label, sublabel = _group_key(project, group_by)
            elif set(group_by) <= {"site", "region"} and t["site_id"] in site_objs:
                # Sem despacho, lotação única: conta no site da lotação.
                site = site_objs[t["site_id"]]
                key, label, sublabel = _group_key(Project(site=site, client=site.client), group_by)
            else:
                # Visão cliente/responsável só conta quem está despachado em
                # projeto (evita dupla contagem); sem site: só no total geral.
                continue
            _count_tech(group_for(key, label, sublabel)["technicians"], t)

    group_list = []
    for g in groups.values():
        g["responsibles"] = sorted(g["responsibles"])
        group_list.append(g)
    group_list.sort(
        key=lambda g: (
            -HEALTH_RANK[g["health"]],
            -(g["alerts"]["late"] * 100 + g["alerts"]["risk"]),
            -((g["technicians"] or {}).get("on_leave", 0) + (g["technicians"] or {}).get("no_checkin", 0)),
            g["label"],
        )
    )

    # ---- sites (mapa) -------------------------------------------------------
    sites = {}
    for row, p in zip(project_rows, projects):
        if not p.site_id or p.site.latitude is None or p.site.longitude is None:
            continue
        s = sites.setdefault(
            p.site_id,
            {
                "id": p.site_id, "label": _site_label(p.site), "lat": float(p.site.latitude), "lng": float(p.site.longitude),
                "region": p.site.region.name if p.site.region_id else "Sem regional",
                "health": HEALTH_OK, "in_execution": 0, "planning": 0, "late": 0, "risk": 0,
                "technicians_present": 0, "technicians_total": 0,
            },
        )
        if p.status in EXECUTION_STATUSES:
            s["in_execution"] += 1
        elif p.status in PLANNING_STATUSES:
            s["planning"] += 1
        if row["health"] == HEALTH_LATE:
            s["late"] += 1
        elif row["health"] == HEALTH_RISK:
            s["risk"] += 1
        if HEALTH_RANK[row["health"]] > HEALTH_RANK[s["health"]]:
            s["health"] = row["health"]
    for t in technicians:
        if t["site_id"] in sites:
            sites[t["site_id"]]["technicians_total"] += 1
            if t["category"] in PRESENT_CATEGORIES:
                sites[t["site_id"]]["technicians_present"] += 1

    # ---- resumo -------------------------------------------------------------
    tech_summary = _empty_tech_counts() if include_technicians else None
    for t in technicians:
        _count_tech(tech_summary, t)
    starting_soon_limit = today + timedelta(days=thresholds["starting_soon_days"])
    summary = {
        "in_progress": sum(1 for p in projects if p.status == Project.STATUS_IN_PROGRESS),
        "paused": sum(1 for p in projects if p.status == Project.STATUS_PAUSED),
        "planning": sum(1 for p in projects if p.status in PLANNING_STATUSES),
        "finished": sum(1 for p in projects if p.status in FINISHED_STATUSES),
        "starting_soon": sum(
            1 for p in projects
            if p.status in PLANNING_STATUSES and p.planned_start and today <= p.planned_start <= starting_soon_limit
        ),
        "late": sum(1 for r in project_rows if r["health"] == HEALTH_LATE),
        "risk": sum(1 for r in project_rows if r["health"] == HEALTH_RISK),
        "no_data": sum(1 for r in project_rows if r["health"] == HEALTH_NO_DATA),
        "groups_with_late": sum(1 for g in group_list if g["alerts"]["late"]),
        "start_late": sum(1 for r in project_rows if any(x["code"] == "start_late" for x in r["reasons"])),
        "occurrences_open": sum(r["occurrences_open"] for r in project_rows),
        "updates_pending": sum(1 for r in project_rows if r["update_status"] in ("draft", "missing")),
        "technicians": tech_summary,
        "data_quality": {
            "sites_without_region": len({p.site_id for p in projects if p.site_id and not p.site.region_id}),
            "projects_without_end": sum(1 for p in projects if not p.planned_end),
            "projects_without_site": sum(1 for p in projects if not p.site_id),
            "executing_without_tasks": sum(
                1 for r in project_rows if r["status"] in EXECUTION_STATUSES and r["tasks_total"] == 0
            ),
            "technicians_without_job_title": (
                sum(1 for t in technicians if not t["job_title"]) if include_technicians else None
            ),
        },
    }
    summary["data_quality"]["total"] = sum(v or 0 for v in summary["data_quality"].values())

    exceptions = build_exceptions(project_rows, technicians, today, thresholds, include_technicians, projects)

    return {
        "date": today,
        "group_by": ",".join(group_by),
        "status_filters": status_keys,
        "include_technicians": include_technicians,
        "summary": summary,
        "groups": group_list,
        "projects": project_rows,
        "sites": list(sites.values()),
        "unplaced_technicians": [t for t in technicians if t["site_id"] is None] if include_technicians else [],
        "exceptions": exceptions,
    }


def build_exceptions(project_rows, technicians, today, thresholds, include_technicians, projects):
    """Fila de exceções que pedem ação (aba Regionais e exceções). Cada item:
    {level, kind, title, detail, action: {type, project_id?}}."""
    items = []
    for row in project_rows:
        if row["health"] not in (HEALTH_LATE, HEALTH_RISK):
            continue
        main = row["reasons"][0]
        where = " · ".join(x for x in [row["site"]["code"] or row["site"]["name"] if row["site"] else "", row["client"]["name"] if row["client"] else ""] if x)
        kind = {"start_late": "mobilization", "occurrence": "client"}.get(main["code"], "deadline")
        items.append(
            {
                "level": row["health"],
                "kind": kind,
                "title": f"{row['name']} — {main['text'][:1].lower()}{main['text'][1:]}",
                "detail": where + (f" · +{len(row['reasons']) - 1} motivo(s)" if len(row["reasons"]) > 1 else ""),
                "action": {"type": "project", "project_id": row["id"]},
            }
        )

    if include_technicians:
        by_site_unprod = {}
        by_site_nocheck = {}
        for t in technicians:
            if t["category"] == TECH_UNPRODUCTIVE:
                by_site_unprod.setdefault(t["site_id"], []).append(t)
            elif t["category"] == TECH_NO_CHECKIN:
                by_site_nocheck.setdefault(t["site_id"], []).append(t)
        site_names = {}
        for row in project_rows:
            if row["site"]:
                site_names[row["site"]["id"]] = row["site"]["code"] or row["site"]["name"]
        unprod = sum(len(v) for v in by_site_unprod.values())
        if unprod:
            items.append(
                {
                    "level": HEALTH_RISK, "kind": "team",
                    "title": f"{unprod} técnico(s) improdutivo(s) agora (sem tarefa, sem acesso ou aguardando liberação)",
                    "detail": " · ".join(f"{site_names.get(k, 'Sem site')} ({len(v)})" for k, v in by_site_unprod.items()),
                    "action": {"type": "operations"},
                }
            )
        nocheck = sum(len(v) for v in by_site_nocheck.values())
        if nocheck:
            items.append(
                {
                    "level": HEALTH_RISK, "kind": "team",
                    "title": f"{nocheck} técnico(s) sem check-in hoje",
                    "detail": " · ".join(f"{site_names.get(k, 'Sem site')} ({len(v)})" for k, v in by_site_nocheck.items()),
                    "action": {"type": "operations"},
                }
            )
        upcoming = TechnicianAbsence.objects.filter(
            collaborator_id__in=[t["id"] for t in technicians],
            date_from__gt=today, date_from__lte=today + timedelta(days=7),
        ).count()
        if upcoming:
            items.append(
                {
                    "level": "info", "kind": "team",
                    "title": f"{upcoming} ausência(s) programada(s) nos próximos 7 dias",
                    "detail": "Férias, folgas e atestados cadastrados na agenda",
                    "action": {"type": "operations"},
                }
            )

    pending_updates = [r for r in project_rows if r["update_status"] in ("draft", "missing")]
    if pending_updates:
        items.append(
            {
                "level": "info", "kind": "client",
                "title": f"{len(pending_updates)} projeto(s) sem atualização enviada ao cliente desde {_fmt(previous_business_day(today))}",
                "detail": ", ".join(r["code"] for r in pending_updates[:6]) + ("…" if len(pending_updates) > 6 else ""),
                "action": {"type": "updates"},
            }
        )

    mobilization_limit = today + timedelta(days=thresholds["mobilization_days"])
    dispatched_projects = {t["project_id"] for t in technicians if t["project_id"]}
    for row in project_rows:
        if row["status"] not in PLANNING_STATUSES or not row["planned_start"]:
            continue
        if not (today <= row["planned_start"] <= mobilization_limit):
            continue
        missing = []
        if row["tasks_total"] == 0:
            missing.append("sem tarefas")
        if include_technicians and row["id"] not in dispatched_projects:
            missing.append("sem técnico despachado")
        if missing:
            items.append(
                {
                    "level": "neutral", "kind": "mobilization",
                    "title": f"{row['name']} inicia em {_fmt(row['planned_start'])} {' e '.join(missing)}",
                    "detail": row["site"]["name"] if row["site"] else "Sem site",
                    "action": {"type": "project", "project_id": row["id"]},
                }
            )

    order = {HEALTH_LATE: 0, HEALTH_RISK: 1, "info": 2, "neutral": 3}
    items.sort(key=lambda i: order.get(i["level"], 9))
    return items

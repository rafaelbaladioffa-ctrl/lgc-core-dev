"""Endpoint agregado do módulo Central de Operações (MVP): o "board" de
despacho — técnicos do site com sua presença/atividade atual/fila, e o pool
de atividades pendentes do site. Somente leitura; despachar é uma action em
ProjectTaskViewSet (api/views.py), e presença tem seu próprio ViewSet
(TechnicianPresenceViewSet).
"""

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Collaborator
from dispatch.models import CollaboratorPair, TechnicianAbsence, TechnicianDailyPresence, TechnicianStatusEvent
from dispatch.blocks import work_units_label
from projects.models import ProjectTask, ProjectTaskAssignment

from .block_times import build_block_times
from .management_report import GROUPS, build_management_report
from .reports import MAX_PERIOD_DAYS, build_operations_reports, collaborators_in_sites, parse_site_ids
from core.collaborator_scope import scope_collaborators, supervisor_project_ids


class HasOperationsBoardPermission(IsAuthenticated):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:
            return True
        return request.user.has_perm("projects.view_projecttaskassignment")


def _current_tasks_by_collaborator(collaborator_ids, project_ids=None):
    """Tarefas 'abertas' (em execução OU pausadas) de cada técnico, numa
    única consulta. Pode haver mais de uma por técnico: pausar uma e iniciar
    outra é permitido, então mostrar só a primeira esconderia a que está
    rodando de verdade."""
    assignments = (
        ProjectTaskAssignment.objects.filter(
            collaborator_id__in=collaborator_ids,
            status__in=(ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED),
        )
        .select_related("project_task__project", "project_task__task")
        .order_by("status", "assignment_start")
    )
    if project_ids is not None:
        assignments = assignments.filter(project_task__project_id__in=project_ids)
    result = {}
    for a in assignments:
        result.setdefault(a.collaborator_id, []).append(
            {
                "id": a.project_task.id,
                "name": a.project_task.display_name,
                "project_name": a.project_task.project.name,
                # Status e início do próprio técnico, não da tarefa inteira.
                "status": a.status,
                "actual_start": a.assignment_start,
            }
        )
    return result


def _status_events_data(collaborator_ids, date):
    """Todas as trocas de status de presença do dia, por técnico — usado
    pra reconstruir a timeline mostrando cada mudança (não só a atual)."""
    events = TechnicianStatusEvent.objects.filter(
        collaborator_id__in=collaborator_ids, date=date
    ).order_by("changed_at")
    by_collaborator = {}
    for e in events:
        by_collaborator.setdefault(e.collaborator_id, []).append(
            {"status": e.status, "status_display": e.get_status_display(), "changed_at": e.changed_at, "adjusted": e.is_adjusted}
        )
    return by_collaborator


def _pair_partner_map(collaborator_ids):
    """{collaborator_id: {"id": parceiro_id, "name": nome_parceiro}} pras
    duplas fixas ativas que têm os dois lados dentro do escopo pedido (site
    filtrado) — usado pro board/timeline agruparem a dupla visualmente."""
    pairs = CollaboratorPair.objects.filter(
        is_active=True, collaborator_a_id__in=collaborator_ids, collaborator_b_id__in=collaborator_ids
    ).select_related("collaborator_a__person", "collaborator_b__person")
    partner_map = {}
    for pair in pairs:
        partner_map[pair.collaborator_a_id] = {"id": pair.collaborator_b_id, "name": pair.collaborator_b.person.name}
        partner_map[pair.collaborator_b_id] = {"id": pair.collaborator_a_id, "name": pair.collaborator_a.person.name}
    return partner_map


def _working_sites_by_collaborator(collaborator_ids, date):
    """Site(s) onde cada técnico ATUA no dia, a partir das tarefas dele — não do
    cadastro (Collaborator.sites lista onde ele pode trabalhar, não onde está).

    Prioridade: tarefa em execução/pausada agora (só no dia de hoje) > tarefas que
    ele iniciou ou concluiu naquela data (mais recentes primeiro) > tarefas da fila
    previstas para a data. Sem nenhuma tarefa, o técnico não tem site no dia.
    Devolve {collaborator_id: "GRU65" | "GRU60, GRU65"}."""
    is_today = date == timezone.localdate()
    day_filter = (
        Q(assignment_start__date=date)
        | Q(assignment_end__date=date)
        | Q(project_task__actual_start__date=date)
        | Q(project_task__actual_end__date=date)
    )
    open_statuses = (ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED)
    relevant = day_filter
    if is_today:
        relevant = relevant | Q(status__in=open_statuses) | Q(status=ProjectTask.STATUS_NOT_STARTED, project_task__planned_start__date=date)
    else:
        relevant = relevant | Q(status=ProjectTask.STATUS_NOT_STARTED, project_task__planned_start__date=date)
    assignments = (
        ProjectTaskAssignment.objects.filter(collaborator_id__in=collaborator_ids, project_task__project__site__isnull=False)
        .filter(relevant)
        .select_related("project_task__project__site")
    )

    ranked = {}
    for a in assignments:
        site_name = a.project_task.project.site.name
        moment = a.assignment_end or a.assignment_start or a.project_task.actual_end or a.project_task.actual_start
        if is_today and a.status in open_statuses:
            rank = 0
        elif a.status == ProjectTask.STATUS_NOT_STARTED:
            rank = 2
        else:
            rank = 1
        # dentro de cada faixa, o mais recente primeiro
        order_key = (rank, -(moment.timestamp() if moment else 0))
        entries = ranked.setdefault(a.collaborator_id, {})
        if site_name not in entries or order_key < entries[site_name]:
            entries[site_name] = order_key

    return {
        collaborator_id: ", ".join(name for name, _ in sorted(entries.items(), key=lambda kv: kv[1]))
        for collaborator_id, entries in ranked.items()
    }


def _queue_by_collaborator(collaborator_ids, project_ids=None):
    assignments = (
        ProjectTaskAssignment.objects.filter(
            collaborator_id__in=collaborator_ids, status=ProjectTask.STATUS_NOT_STARTED
        )
        .select_related("project_task__project", "project_task__task")
        .order_by("queue_order", "dispatched_at")
    )
    if project_ids is not None:
        assignments = assignments.filter(project_task__project_id__in=project_ids)
    result = {}
    for a in assignments:
        result.setdefault(a.collaborator_id, []).append(
            {
                "task_id": a.project_task_id,
                "task_name": a.project_task.display_name,
                "project_name": a.project_task.project.name,
                "queue_order": a.queue_order,
            }
        )
    return result


def _pending_predecessors(pool_tasks):
    """{id da tarefa do pool: [nomes das etapas anteriores ainda não concluídas]}, a partir das
    dependências do cadastro mestre (GeneratedTaskDependency, "terminar para começar" entre etapas
    vizinhas do mesmo item de escopo). Etapa anterior sem tarefa no projeto não bloqueia."""
    from master_data.models import GeneratedTaskDependency

    generated_ids = {t.generated_task_id for t in pool_tasks if t.generated_task_id}
    if not generated_ids:
        return {}
    deps = list(
        GeneratedTaskDependency.objects.filter(successor_task_id__in=generated_ids).values_list(
            "successor_task_id", "predecessor_task_id"
        )
    )
    predecessor_ids = {p for _, p in deps}
    pending = {
        pt.generated_task_id: pt
        for pt in ProjectTask.objects.filter(generated_task_id__in=predecessor_ids)
        .exclude(status=ProjectTask.STATUS_COMPLETED)
        .select_related("generated_task__activity")
    }
    by_successor = {}
    for successor_id, predecessor_id in deps:
        task = pending.get(predecessor_id)
        if task is not None:
            by_successor.setdefault(successor_id, set()).add(task.generated_task.activity.name)
    return {
        t.id: sorted(by_successor.get(t.generated_task_id, []))
        for t in pool_tasks
        if t.generated_task_id and by_successor.get(t.generated_task_id)
    }


def build_board_data(site_id, date=None, user=None):
    """Monta os mesmos dados de OperationsBoardView.get() — extraído à parte
    pra ser reaproveitado pela view de "print" (bot do WhatsApp), sem
    duplicar a lógica."""
    today = date or timezone.localdate()
    collaborators_qs = Collaborator.objects.filter(is_active=True).select_related("person").prefetch_related("sites")
    collaborators_qs = scope_collaborators(collaborators_qs, user)
    site_ids = parse_site_ids(site_id)
    if site_ids:
        collaborators_qs = collaborators_qs.filter(id__in=collaborators_in_sites(site_ids))
    # Supervisor: só técnicos sob a sua gestão (acima) e só tarefas dos projetos em que é Responsável CSTR.
    project_ids = supervisor_project_ids(user)

    presence_filter = {"date": today}
    if site_ids:
        presence_filter["collaborator_id__in"] = collaborators_in_sites(site_ids)
    presences = {p.collaborator_id: p for p in TechnicianDailyPresence.objects.filter(**presence_filter)}
    collaborator_ids = [c.id for c in collaborators_qs]
    status_events_by_collaborator = _status_events_data(collaborator_ids, today)
    pair_partner_by_collaborator = _pair_partner_map(collaborator_ids)
    current_tasks_by_collaborator = _current_tasks_by_collaborator(collaborator_ids, project_ids)
    queue_by_collaborator = _queue_by_collaborator(collaborator_ids, project_ids)
    working_sites = _working_sites_by_collaborator(collaborator_ids, today)
    absences_today = {
        a.collaborator_id: a
        for a in TechnicianAbsence.objects.filter(
            collaborator_id__in=collaborator_ids, date_from__lte=today, date_to__gte=today
        )
    }

    technicians = []
    for collaborator in collaborators_qs:
        presence = presences.get(collaborator.id)
        absence = absences_today.get(collaborator.id)
        technicians.append(
            {
                "id": collaborator.id,
                "name": collaborator.person.name if collaborator.person_id else str(collaborator),
                "site_name": working_sites.get(collaborator.id, ""),
                "presence_status": "on_leave" if absence else (presence.status if presence else TechnicianDailyPresence.STATUS_NOT_STARTED),
                "presence_status_display": (
                    (absence.reason or "Férias / Ausência") if absence
                    else presence.get_status_display() if presence else "Indisponível"
                ),
                "on_leave": absence is not None,
                "leave_until": absence.date_to if absence else None,
                "checked_in_at": presence.checked_in_at if presence else None,
                "checked_out_at": presence.checked_out_at if presence else None,
                "current_tasks": current_tasks_by_collaborator.get(collaborator.id, []),
                "queue": queue_by_collaborator.get(collaborator.id, []),
                "status_events": status_events_by_collaborator.get(collaborator.id, []),
                "pair_partner": pair_partner_by_collaborator.get(collaborator.id),
            }
        )

    # Só entra no pool do dia quem tem início AGENDADO pra data — sem
    # isso, todo o backlog não iniciado (mesmo tarefas agendadas pra
    # daqui semanas) aparecia junto, inflando a lista.
    pool_qs = ProjectTask.objects.filter(status=ProjectTask.STATUS_NOT_STARTED, planned_start__date=today)
    if project_ids is not None:
        pool_qs = pool_qs.filter(project_id__in=project_ids)
    if site_ids:
        pool_qs = pool_qs.filter(project__site_id__in=site_ids)
    pool = list(
        pool_qs.select_related(
            "project",
            "project__site",
            "task",
            "generated_task__activity",
            "generated_task__scope_item__cable_family",
        )
        .prefetch_related("assignments__collaborator__person")
        .order_by("order", "id")
    )
    blocked_by = _pending_predecessors(pool)
    pool_data = []
    for t in pool:
        generated = t.generated_task
        family = generated.scope_item.cable_family if generated else None
        units, units_label = work_units_label(t)
        pool_data.append(
            {
                "id": t.id,
                "name": t.display_name,
                "project_name": t.project.name,
                "project_code": t.project.code,
                "site_name": t.project.site.name if t.project.site_id else "—",
                "estimated_hours": t.estimated_hours,
                "assignees": [
                    {"collaborator_id": a.collaborator_id, "name": a.collaborator.person.name, "queue_order": a.queue_order}
                    for a in t.assignments.all()
                ],
                # Pacote de trabalho = atividade + grupo de material (mesma regra do bloco do técnico).
                "activity_code": generated.activity.code if generated else None,
                "activity_name": generated.activity.name if generated else None,
                "step_order": generated.step_order if generated else None,
                "scope_item_code": generated.scope_item.code if generated else None,
                "work_group": family.work_group if family else "",
                "work_group_label": family.get_work_group_display() if family and family.work_group else "",
                "work_units": round(units, 1),
                "work_units_label": units_label,
                "blocked_by": blocked_by.get(t.id, []),
            }
        )

    active_qs = ProjectTask.objects.filter(status__in=(ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED))
    completed_qs = ProjectTask.objects.filter(status=ProjectTask.STATUS_COMPLETED, actual_end__date=today)
    if project_ids is not None:
        active_qs = active_qs.filter(project_id__in=project_ids)
        completed_qs = completed_qs.filter(project_id__in=project_ids)
    if site_ids:
        active_qs = active_qs.filter(project__site_id__in=site_ids)
        completed_qs = completed_qs.filter(project__site_id__in=site_ids)
    pending_count = len(pool_data)
    active_count = active_qs.count()
    completed_today_count = completed_qs.count()
    planned_count = pending_count + active_count + completed_today_count
    technicians_on_site = sum(
        1 for t in technicians
        if t["presence_status"] != TechnicianDailyPresence.STATUS_NOT_STARTED
        and not t["on_leave"]
    )
    technicians_absent = sum(
        1 for t in technicians
        if t["presence_status"] == TechnicianDailyPresence.STATUS_NOT_STARTED
        and not t["on_leave"]
    )
    stats = {
        "planned": planned_count,
        "active": active_count,
        "completed": completed_today_count,
        "pending": pending_count,
        "technicians_on_site": technicians_on_site,
        "technicians_absent": technicians_absent,
        "progress_pct": round((completed_today_count / planned_count) * 100) if planned_count else 0,
    }

    return {"technicians": technicians, "pool": pool_data, "stats": stats}


class OperationsBoardView(APIView):
    """GET /api/operations/board/?site=<id> — omita `site` (ou use
    `site=all`) pra ver todos os sites de uma vez."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        site_id = request.query_params.get("site")
        if site_id == "all":
            site_id = None
        date_str = request.query_params.get("date")
        date = parse_date(date_str) if date_str else None
        return Response(build_board_data(site_id, date=date, user=request.user))


def _working_intervals(assignment, task):
    """Intervalos [início, fim] em que ESTE técnico esteve de fato executando a
    tarefa: do início até a primeira pausa, da retomada até a pausa seguinte, e
    assim por diante (assignment.pause_log + pausa em aberto). O último intervalo
    fica em aberto (fim None) enquanto ele ainda executa. Devolve None quando o
    despacho não tem rastreamento próprio (dado antigo) — a timeline cai no
    comportamento anterior (início/fim da tarefa)."""
    start = assignment.assignment_start
    if start is None:
        return None
    end = assignment.assignment_end
    if assignment.status == ProjectTask.STATUS_COMPLETED and end is None:
        end = task.actual_end  # concluída por ajuste do admin: sem fim próprio
    pauses = []
    for pair in assignment.pause_log or []:
        try:
            pauses.append((parse_datetime(pair[0]), parse_datetime(pair[1])))
        except (TypeError, IndexError, ValueError):
            continue
    pauses = sorted(p for p in pauses if p[0] and p[1])
    if assignment.paused_at:
        pauses.append((assignment.paused_at, None))  # pausa em aberto: encerra o último trecho
    intervals = []
    cursor = start
    for pause_start, pause_end in pauses:
        if pause_start > cursor:
            intervals.append({"start": cursor, "end": pause_start})
        if pause_end is None:
            return intervals
        cursor = max(cursor, pause_end)
    if end is not None and cursor >= end:
        return intervals
    if end is None and assignment.status not in (ProjectTask.STATUS_IN_PROGRESS,):
        return intervals  # sem fim e sem execução em curso: não há trecho aberto
    intervals.append({"start": cursor, "end": end})
    return intervals


def build_timeline_data(site_id, date, user=None):
    """Monta os mesmos dados de OperationsTimelineView.get() — extraído à
    parte pra ser reaproveitado pela view de "print" (bot do WhatsApp)."""
    is_today = date == timezone.localdate()

    collaborators_qs = Collaborator.objects.filter(is_active=True).select_related("person").prefetch_related("sites")
    collaborators_qs = scope_collaborators(collaborators_qs, user)
    site_ids = parse_site_ids(site_id)
    if site_ids:
        collaborators_qs = collaborators_qs.filter(id__in=collaborators_in_sites(site_ids))

    collaborator_ids = [c.id for c in collaborators_qs]
    status_events_by_collaborator = _status_events_data(collaborator_ids, date)
    pair_partner_by_collaborator = _pair_partner_map(collaborator_ids)
    project_ids = supervisor_project_ids(user)  # supervisor: só tarefas dos projetos em que é Responsável CSTR
    working_sites = _working_sites_by_collaborator(collaborator_ids, date)

    queue_by_collaborator = _queue_by_collaborator(collaborator_ids, project_ids) if is_today else {}
    # Timestamps do PRÓPRIO técnico (assignment_start/assignment_end) quando
    # disponíveis, para não mostrar barras no período em que outro técnico
    # executava a tarefa e este não.
    assignments_by_collaborator = {}
    all_assignments = (
        ProjectTaskAssignment.objects.filter(collaborator_id__in=collaborator_ids)
        .select_related("project_task", "project_task__project", "project_task__task")
        .prefetch_related("project_task__assignments")
        .filter(
            Q(assignment_start__date=date)
            | Q(project_task__actual_start__date=date)
            | Q(project_task__planned_start__date=date)
            | Q(status__in=(ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED))
        )
        .order_by("project_task__planned_start", "project_task__actual_start")
    )
    if project_ids is not None:
        all_assignments = all_assignments.filter(project_task__project_id__in=project_ids)
    for a in all_assignments:
        assignments_by_collaborator.setdefault(a.collaborator_id, []).append(a)

    technicians = []
    for collaborator in collaborators_qs:
        assignments = assignments_by_collaborator.get(collaborator.id, [])
        seen_task_ids = set()
        blocks = []
        for a in assignments:
            t = a.project_task
            if t.id in seen_task_ids:
                continue
            seen_task_ids.add(t.id)
            # Quando o assignment tem timestamps próprios, usa eles (rastreamento individual).
            # Fallback para task-level APENAS quando o técnico é o único designado —
            # se há múltiplos designados sem rastreamento por assignment, não usar os
            # timestamps da tarefa (que representam o intervalo total, não o deste técnico).
            is_sole_assignee = t.assignments.count() <= 1
            actual_start = a.assignment_start or (t.actual_start if is_sole_assignee else None)
            actual_end = a.assignment_end or (t.actual_end if is_sole_assignee else None)
            blocks.append({
                "id": t.id,
                "name": t.display_name,
                "project_name": t.project.name,
                "status": a.status,
                "planned_start": t.planned_start,
                "planned_end": t.planned_end,
                "actual_start": actual_start,
                "actual_end": actual_end,
                "estimated_hours": t.estimated_hours,
                "working_intervals": _working_intervals(a, t),
                "adjusted": a.is_adjusted,
            })
        technicians.append(
            {
                "id": collaborator.id,
                "name": collaborator.person.name,
                "site_name": working_sites.get(collaborator.id, ""),
                "blocks": blocks,
                "queue": queue_by_collaborator.get(collaborator.id, []),
                "status_events": status_events_by_collaborator.get(collaborator.id, []),
                "pair_partner": pair_partner_by_collaborator.get(collaborator.id),
            }
        )

    return {"date": date.isoformat(), "is_today": is_today, "technicians": technicians}


class OperationsTimelineView(APIView):
    """GET /api/operations/timeline/?site=<id>&date=<YYYY-MM-DD, opcional>

    Uma linha por técnico do site, com os blocos (ProjectTask) relevantes
    pro dia: tarefas com início real ou previsto naquele dia, mais qualquer
    tarefa que esteja em execução/pausada agora (mesmo se começou antes) —
    pra não "sumir" um bloco que ainda está rodando."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        site_id = request.query_params.get("site")
        if site_id == "all":
            site_id = None

        date_param = request.query_params.get("date")
        date = parse_date(date_param) if date_param else timezone.localdate()
        if date is None:
            date = timezone.localdate()

        return Response(build_timeline_data(site_id, date, user=request.user))


def _log_entries(collaborator_ids, date, limit=60, project_ids=None):
    """Feed de eventos do dia pra exibição — combina despachos
    (ProjectTaskAssignment.dispatched_at), início/fim real de tarefa
    (ProjectTask.actual_start/actual_end) e trocas de status
    (TechnicianStatusEvent), numa lista só ordenada por horário. Evita
    duplicar sinal: "in_progress" no histórico de status é ignorado (já vira
    'iniciou atividade' via actual_start, com timestamp mais confiável), e
    'ficou disponível' logo após uma conclusão também é descartado (já virou
    'concluiu atividade')."""
    collaborator_ids = set(collaborator_ids)
    entries = []

    dispatches = ProjectTaskAssignment.objects.filter(
        collaborator_id__in=collaborator_ids, dispatched_at__date=date
    ).select_related("project_task__task", "collaborator__person")
    if project_ids is not None:
        dispatches = dispatches.filter(project_task__project_id__in=project_ids)
    for a in dispatches:
        entries.append({"at": a.dispatched_at, "name": a.collaborator.person.name, "type": "dispatch", "text": f"foi despachado → {a.project_task.display_name}"})

    # Usa timestamps do assignment individual (assignment_start/assignment_end)
    # quando disponíveis, para refletir quando ESTE técnico iniciou/concluiu —
    # não quando qualquer outro técnico da mesma tarefa agiu.
    log_assignments = (
        ProjectTaskAssignment.objects.filter(collaborator_id__in=collaborator_ids)
        .filter(
            Q(assignment_start__date=date)
            | Q(assignment_end__date=date)
            | Q(project_task__actual_start__date=date)
            | Q(project_task__actual_end__date=date)
        )
        .select_related("project_task__task", "project_task__project", "collaborator__person")
        .distinct()
    )
    if project_ids is not None:
        log_assignments = log_assignments.filter(project_task__project_id__in=project_ids)
    completion_marks = {}
    for a in log_assignments:
        t = a.project_task
        name = a.collaborator.person.name
        start_ts = a.assignment_start or t.actual_start
        end_ts = a.assignment_end or t.actual_end
        if start_ts and start_ts.date() == date:
            entries.append({"at": start_ts, "name": name, "type": "start", "text": f"iniciou atividade → {t.display_name}"})
        if end_ts and end_ts.date() == date:
            entries.append({"at": end_ts, "name": name, "type": "complete", "text": f"concluiu atividade → {t.display_name}"})
            completion_marks.setdefault(a.collaborator_id, []).append(end_ts)

    events = (
        TechnicianStatusEvent.objects.filter(collaborator_id__in=collaborator_ids, date=date)
        .select_related("collaborator__person")
        .order_by("collaborator_id", "changed_at")
    )
    by_collaborator = {}
    for e in events:
        by_collaborator.setdefault(e.collaborator_id, []).append(e)

    for collaborator_id, evs in by_collaborator.items():
        name = evs[0].collaborator.person.name
        for i, ev in enumerate(evs):
            if ev.status == TechnicianDailyPresence.STATUS_IN_PROGRESS:
                continue
            if i == 0:
                entries.append({"at": ev.changed_at, "name": name, "type": "checkin", "text": "realizou check-in"})
                continue
            if ev.status == TechnicianDailyPresence.STATUS_AVAILABLE:
                near_completion = any(
                    abs((ev.changed_at - t).total_seconds()) < 5 for t in completion_marks.get(collaborator_id, [])
                )
                if near_completion:
                    continue
                prev_status = evs[i - 1].status
                if prev_status == TechnicianDailyPresence.STATUS_IN_PROGRESS:
                    entry_type, text = "pause", "pausou a atividade atual"
                else:
                    entry_type, text = "available", "ficou disponível"
                entries.append({"at": ev.changed_at, "name": name, "type": entry_type, "text": text})
            else:
                entries.append({"at": ev.changed_at, "name": name, "type": "status", "text": f"ficou {ev.get_status_display()}"})

    entries.sort(key=lambda e: e["at"])
    if limit:
        entries = entries[-limit:]
    return entries


class OperationsReportsView(APIView):
    """GET /api/operations/reports/?site=<id|all>&date_from=&date_to=

    Relatórios e Indicadores (padrão: últimos 30 dias, máximo 180). Regras
    de negócio em docs/features/relatorios-v2.md; agregação em
    api/reports.py."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        site_id = request.query_params.get("site")
        if site_id == "all":
            site_id = None

        today = timezone.localdate()
        date_from = parse_date(request.query_params.get("date_from") or "") or (today - timedelta(days=29))
        date_to = parse_date(request.query_params.get("date_to") or "") or today
        if date_from > date_to:
            return Response({"detail": "A data inicial não pode ser posterior à data final."}, status=400)
        if (date_to - date_from).days + 1 > MAX_PERIOD_DAYS:
            return Response({"detail": f"O período máximo é de {MAX_PERIOD_DAYS} dias."}, status=400)

        return Response(
            build_operations_reports(
                site_id=site_id, date_from=date_from, date_to=date_to, log_entries_fn=_log_entries, user=request.user
            )
        )


class OperationsManagementReportView(APIView):
    """GET /api/operations/reports/management/?site=<id|all>&date_from=&date_to=&group=day|week|month

    Relatório gerencial: tendência, ranking de técnicos, comparação entre
    sites e período atual × anterior. Agregação em api/management_report.py."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        site_id = request.query_params.get("site")
        if site_id == "all":
            site_id = None

        today = timezone.localdate()
        date_from = parse_date(request.query_params.get("date_from") or "") or (today - timedelta(days=29))
        date_to = parse_date(request.query_params.get("date_to") or "") or today
        if date_from > date_to:
            return Response({"detail": "A data inicial não pode ser posterior à data final."}, status=400)
        if (date_to - date_from).days + 1 > MAX_PERIOD_DAYS:
            return Response({"detail": f"O período máximo é de {MAX_PERIOD_DAYS} dias."}, status=400)
        group = request.query_params.get("group")
        if group and group not in GROUPS:
            return Response({"detail": "Agrupamento inválido (use day, week ou month)."}, status=400)

        return Response(
            build_management_report(
                site_id=site_id, date_from=date_from, date_to=date_to, group=group, user=request.user
            )
        )


class OperationsBlockTimesView(APIView):
    """GET /api/operations/reports/block-times/?site=<id|all>&date_from=&date_to=

    Tempo por unidade por atividade e grupo de material (blocos do técnico) e workflow de um cabo.
    Agregação em api/block_times.py."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        site_id = request.query_params.get("site")
        if site_id == "all":
            site_id = None

        today = timezone.localdate()
        date_from = parse_date(request.query_params.get("date_from") or "") or (today - timedelta(days=29))
        date_to = parse_date(request.query_params.get("date_to") or "") or today
        if date_from > date_to:
            return Response({"detail": "A data inicial não pode ser posterior à data final."}, status=400)
        if (date_to - date_from).days + 1 > MAX_PERIOD_DAYS:
            return Response({"detail": f"O período máximo é de {MAX_PERIOD_DAYS} dias."}, status=400)

        return Response(build_block_times(site_id=site_id, date_from=date_from, date_to=date_to, user=request.user))

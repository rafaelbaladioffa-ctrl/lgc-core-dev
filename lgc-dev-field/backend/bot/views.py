from datetime import date, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from api.operations import build_board_data
from core.models import Collaborator, Site
from core.phone_utils import phones_match
from projects.models import Project, ProjectAttachment, ProjectOccurrence, ProjectProgressSnapshot, ProjectTask, ProjectTaskAssignment
from updates.models import DailyUpdateAllocation, ProjectDailyUpdate
from updates.project_client_mail import WORKDAY_END, WORKDAY_START, compute_progress_defaults

from .message_templates import FIELD_DEFINITIONS, get_effective_template, preview_for_template
from .models import BotMessageTemplate, BotSubscriber
from .permissions import BotSharedSecretPermission


def _find_bot_collaborator(name="", phone=""):
    """Acha o Colaborador ativo correspondente ao nome (busca parcial) ou
    telefone informado pelo técnico no bot do WhatsApp. Retorna uma tupla
    (collaborator, ambiguous_matches) — só um dos dois é preenchido."""
    active_collaborators = Collaborator.objects.filter(is_active=True).select_related("person")

    if name:
        matches = list(active_collaborators.filter(person__name__icontains=name))
        if len(matches) > 1:
            return None, [c.person.name for c in matches]
        return (matches[0] if matches else None), None

    collaborator = next(
        (c for c in active_collaborators if c.person.phone and phones_match(c.person.phone, phone)),
        None,
    )
    return collaborator, None


class BotAllocationView(APIView):
    """GET /api/bot/allocation/?name=<nome>  (ou ?phone=<numero>)

    Usado pelo bot do WhatsApp: dado o nome (ou telefone) digitado pelo
    técnico, acha o Colaborador correspondente e retorna em quais
    projetos/sites ele está alocado na Atualização Diária de hoje."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        name = request.query_params.get("name", "").strip()
        phone = request.query_params.get("phone", "")
        if not name and not phone:
            return Response({"detail": "Informe o parâmetro 'name' ou 'phone'."}, status=400)

        collaborator, ambiguous_matches = _find_bot_collaborator(name, phone)
        if ambiguous_matches is not None:
            return Response({"found": "ambiguous", "matches": ambiguous_matches})

        if not collaborator:
            return Response({"found": False})

        today = timezone.localdate()
        allocations = DailyUpdateAllocation.objects.filter(
            daily_update__allocation_date=today,
            collaborators=collaborator,
        ).select_related("project", "project__site")

        return Response(
            {
                "found": True,
                "collaborator_name": collaborator.person.name,
                "date": today.isoformat(),
                "allocations": [
                    {
                        "project": a.project.name,
                        "code": a.project.code,
                        "site": a.project.site.name if a.project.site_id else None,
                    }
                    for a in allocations
                ],
            }
        )


def _allocations_for(target_date, rule=None):
    """Alocações do dia; com `rule`, só dos projetos que passam nos filtros
    da regra (cliente, categoria, regional, site, status)."""
    qs = DailyUpdateAllocation.objects.filter(daily_update__allocation_date=target_date)
    if rule is not None:
        qs = qs.filter(project_id__in=_rule_projects_queryset(rule).values("pk"))
    return qs


def build_allocation_technicians(target_date, rule=None, require_phone=True):
    """Técnicos com alocação na data, com os projetos de cada um. Com
    `require_phone`, só quem tem telefone (envio individual); sem ele, todos
    (resumo enviado a um grupo)."""
    allocations = _allocations_for(target_date, rule).select_related("project", "project__site").prefetch_related("collaborators__person")

    # Filtro Gestor: só técnicos da equipe (direta ou indireta) dos gestores da regra.
    allowed_ids = None
    if rule is not None:
        manager_ids = list(rule.managers.values_list("pk", flat=True))
        if manager_ids:
            from core.collaborator_scope import team_collaborator_ids

            allowed_ids = team_collaborator_ids(manager_ids)

    by_collaborator = {}
    for allocation in allocations:
        for collaborator in allocation.collaborators.all():
            if not collaborator.is_active or (require_phone and not collaborator.person.phone):
                continue
            if allowed_ids is not None and collaborator.id not in allowed_ids:
                continue
            entry = by_collaborator.setdefault(
                collaborator.id,
                {
                    "phone": collaborator.person.phone,
                    "collaborator_name": collaborator.person.name,
                    "allocations": [],
                },
            )
            entry["allocations"].append(
                {
                    "project": allocation.project.name,
                    "code": allocation.project.code,
                    "site": allocation.project.site.name if allocation.project.site_id else None,
                }
            )

    return list(by_collaborator.values())


def build_daily_tasks_projects(target_date, rule=None):
    """Projetos alocados na data, com técnicos e tarefas pendentes."""
    allocations = _allocations_for(target_date, rule).select_related("project", "project__site").prefetch_related("collaborators__person")

    status_labels = dict(ProjectTask.STATUS_CHOICES)
    projects = []
    for allocation in allocations:
        project = allocation.project
        allocated_collaborators = list(allocation.collaborators.all())
        # Só tarefas pendentes explicitamente atribuídas a um dos técnicos
        # alocados hoje nesse projeto — não entra tarefa sem responsável
        # nem tarefa de outra pessoa que não está no time de hoje.
        # Status do próprio técnico: a tarefa some da lista dele quando ele
        # finalizar a parte dele, mesmo que um colega ainda esteja trabalhando.
        pending_assignments = (
            ProjectTaskAssignment.objects.filter(project_task__project=project, collaborator__in=allocated_collaborators)
            .exclude(status__in=(ProjectTask.STATUS_COMPLETED, ProjectTask.STATUS_CANCELED))
            .select_related("project_task__task")
            .order_by("project_task__order", "project_task_id")
        )
        pending_lines = {}
        for assignment in pending_assignments:
            pending_lines.setdefault(
                assignment.project_task_id,
                f"{assignment.project_task.display_name} ({status_labels.get(assignment.status, assignment.status)})",
            )
        projects.append(
            {
                "project": project.name,
                "code": project.code,
                "site": project.site.name if project.site_id else None,
                "collaborators": [
                    c.person.name for c in allocation.collaborators.order_by("person__name")
                ],
                "tasks": list(pending_lines.values()),
            }
        )

    return projects


def build_project_updates_projects(target_date, rule=None):
    """Dados da Atualização Diária de Projeto dos projetos alocados na data."""
    project_ids = _allocations_for(target_date, rule).values_list("project_id", flat=True).distinct()
    projects_qs = Project.objects.filter(pk__in=project_ids).select_related(
        "responsible_client__person", "responsible_cstr__person"
    )
    # Se já existe uma Atualização de Projeto registrada pra essa data,
    # usa os colaboradores e a observação que a pessoa responsável
    # digitou lá — só o percentual/atividades/certificação continuam
    # sempre recalculados ao vivo (mesmo critério de refresh_from_tasks()).
    existing_updates = {
        u.project_id: u
        for u in ProjectDailyUpdate.objects.filter(
            project_id__in=project_ids, date=target_date
        ).prefetch_related("collaborators__person")
    }

    projects = []
    for project in projects_qs:
        defaults = compute_progress_defaults(project, target_date)
        existing = existing_updates.get(project.id)

        if existing:
            collaborator_names = list(
                existing.collaborators.order_by("person__name").values_list("person__name", flat=True)
            )
            summary = existing.summary or None
        else:
            collaborator_names = list(
                Collaborator.objects.filter(pk__in=defaults["collaborator_ids"])
                .select_related("person")
                .order_by("person__name")
                .values_list("person__name", flat=True)
            )
            summary = None

        projects.append(
            {
                "project": project.name,
                "po": project.po or None,
                "responsible_client": project.responsible_client.person.name if project.responsible_client_id else None,
                "responsible_cstr": project.responsible_cstr.person.name if project.responsible_cstr_id else None,
                "collaborators": collaborator_names,
                "completion_percent": defaults["percent"],
                "activities_text": defaults["activities_text"] or None,
                "certification_done": defaults["certification_done"],
                "project_finished": defaults["project_finished"],
                "summary": summary,
            }
        )

    return projects


class BotDailyBroadcastView(APIView):
    """GET /api/bot/daily-broadcast/?date=<AAAA-MM-DD, opcional>

    Usado pelo envio automático diário do bot (não é um técnico chamando):
    lista, para a data informada (padrão: amanhã — as Atualizações Diárias
    já são criadas com essa data por padrão, já que o gestor normalmente
    planeja o dia seguinte à tarde), cada colaborador com alocação
    registrada e telefone cadastrado, para o bot mandar a mensagem
    proativamente, sem o técnico precisar chamar o bot."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        target_date, error = _parse_target_date(request, default_days_ahead=1)
        if error:
            return error

        technicians = build_allocation_technicians(target_date)

        return Response({"date": target_date.isoformat(), "technicians": technicians})


class BotMyTasksView(APIView):
    """GET /api/bot/my-tasks/?name=<nome>

    Usado pelo bot do WhatsApp: dado o nome digitado pelo técnico, retorna
    as tarefas pendentes (não concluídas/canceladas) atribuídas a ele em
    projetos ativos, agrupadas por projeto."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        name = request.query_params.get("name", "").strip()
        if not name:
            return Response({"detail": "Parâmetro 'name' é obrigatório."}, status=400)

        collaborator, ambiguous_matches = _find_bot_collaborator(name=name)
        if ambiguous_matches is not None:
            return Response({"found": "ambiguous", "matches": ambiguous_matches})

        if not collaborator:
            return Response({"found": False})

        assignments = (
            ProjectTaskAssignment.objects.filter(collaborator=collaborator, project_task__project__is_active=True)
            .exclude(status__in=(ProjectTask.STATUS_COMPLETED, ProjectTask.STATUS_CANCELED))
            .select_related("project_task__project", "project_task__task")
            .order_by("project_task__project__name", "project_task__order", "project_task_id")
        )
        status_labels = dict(ProjectTask.STATUS_CHOICES)

        return Response(
            {
                "found": True,
                "collaborator_name": collaborator.person.name,
                "tasks": [
                    {
                        "project": a.project_task.project.name,
                        "code": a.project_task.project.code,
                        "task": a.project_task.display_name,
                        "status": status_labels.get(a.status, a.status),
                    }
                    for a in assignments
                ],
            }
        )


class BotSitesView(APIView):
    """GET /api/bot/sites/

    Lista os sites que têm ao menos um projeto ativo, para o técnico
    escolher no fluxo de "Atualização de projetos" do bot."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        sites = Site.objects.filter(projects__is_active=True).distinct().order_by("name")
        return Response([{"id": s.id, "name": s.name or s.code or f"Site #{s.id}"} for s in sites])


class BotTechStatusSitesView(APIView):
    """GET /api/bot/tech-status/sites/

    Lista os sites que têm ao menos um técnico ativo vinculado, para o
    técnico/gestor escolher no fluxo "Status dos Técnicos" do bot."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        sites = Site.objects.filter(collaborators__is_active=True).distinct().order_by("name")
        return Response([{"id": s.id, "name": s.name or s.code or f"Site #{s.id}"} for s in sites])


class BotTechStatusView(APIView):
    """GET /api/bot/tech-status/?site_id=<id, opcional>

    Usado pelo bot do WhatsApp: status de presença de cada técnico ativo
    agora — de um site específico, ou de todos (sem 'site_id'). Reaproveita
    build_board_data (mesma lógica da Central de Operações)."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        site_id = request.query_params.get("site_id") or None
        board = build_board_data(site_id)
        technicians = [
            {
                "name": t["name"],
                "site_name": t["site_name"],
                "status": t["presence_status_display"],
                "current_task": t["current_tasks"][0]["name"] if t["current_tasks"] else None,
            }
            for t in board["technicians"]
        ]
        return Response({"technicians": technicians})


class BotProjectsView(APIView):
    """GET /api/bot/projects/?site_id=<id>

    Lista os projetos ativos de um site, para o técnico escolher no fluxo
    de "Atualização de projetos" do bot."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        site_id = request.query_params.get("site_id")
        if not site_id:
            return Response({"detail": "Parâmetro 'site_id' é obrigatório."}, status=400)

        projects = Project.objects.filter(is_active=True, site_id=site_id).order_by("name")
        return Response([{"id": p.id, "code": p.code, "name": p.name} for p in projects])


def _serialize_project_update(project):
    today = timezone.localdate()
    today_update = ProjectDailyUpdate.objects.filter(project=project, date=today).first()
    if today_update:
        today_update.refresh_from_tasks()

    client = str(project.client) if project.client_id else (str(project.site.client) if project.site_id else None)
    status_label = dict(Project.STATUS_CHOICES).get(project.status, project.status)
    responsible_client = project.responsible_client.person.name if project.responsible_client_id else None
    # Percentual geral de conclusão do projeto (todas as tarefas, não só as
    # de hoje) — independe de existir uma Atualização de Projeto para hoje.
    completion_percent = compute_progress_defaults(project, today)["percent"]

    return {
        "code": project.code,
        "name": project.name,
        "client": client,
        "site": project.site.name if project.site_id else None,
        "status": status_label,
        "po": project.po or None,
        "responsible_client": responsible_client,
        "completion_percent": completion_percent,
        "planned_start": project.planned_start.isoformat() if project.planned_start else None,
        "planned_end": project.planned_end.isoformat() if project.planned_end else None,
        "description": project.description or None,
        "today_update": (
            {
                "completion_percent": today_update.completion_percent,
                "activities_text": today_update.activities_text or None,
                "certification_done": today_update.certification_done,
                "project_finished": today_update.project_finished,
                "summary": today_update.summary or None,
                "collaborators": list(
                    today_update.collaborators.order_by("person__name").values_list("person__name", flat=True)
                ),
            }
            if today_update
            else None
        ),
    }


class BotProjectUpdateView(APIView):
    """GET /api/bot/project-update/?project_id=<id>
    GET /api/bot/project-update/?site_id=<id>  (todos os projetos ativos do site)

    Usado pelo bot do WhatsApp para trazer a atualização do dia e um
    overview geral de um projeto (ou de todos os projetos ativos de um
    site)."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        project_id = request.query_params.get("project_id")
        site_id = request.query_params.get("site_id")
        if not project_id and not site_id:
            return Response({"detail": "Informe 'project_id' ou 'site_id'."}, status=400)

        if project_id:
            projects = Project.objects.filter(pk=project_id, is_active=True).select_related(
                "client", "site", "site__client", "responsible_client__person"
            )
        else:
            projects = (
                Project.objects.filter(site_id=site_id, is_active=True)
                .select_related("client", "site", "site__client", "responsible_client__person")
                .order_by("name")
            )

        return Response([_serialize_project_update(p) for p in projects])


def _parse_target_date(request, default_days_ahead=0):
    """Lê o parâmetro 'date' (AAAA-MM-DD) da query string, com padrão de
    hoje + `default_days_ahead` dias. Retorna (data, None) ou (None,
    Response de erro)."""
    date_str = request.query_params.get("date")
    if not date_str:
        return timezone.localdate() + timedelta(days=default_days_ahead), None
    try:
        return date.fromisoformat(date_str), None
    except ValueError:
        return None, Response({"detail": "Parâmetro 'date' inválido, use AAAA-MM-DD."}, status=400)


def _active_subscribers(flag):
    """Destinatários ativos de um tipo de envio. `group_jid` preenchido
    significa grupo do WhatsApp — o bot usa ele no lugar do telefone."""
    return list(
        BotSubscriber.objects.filter(is_active=True, **{flag: True})
        .order_by("name")
        .values("name", "phone", "group_jid")
    )


class BotOperationsPrintRecipientsView(APIView):
    """GET /api/bot/broadcasts/operations-print-recipients/

    Lista quem deve receber o print da Operação do Dia (8h/10h/12h/14h/16h/
    18h) — o bot captura a imagem (via /api/bot/operations-print/) e manda
    pra cada telefone daqui."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        return Response({"recipients": _active_subscribers("receives_operations_print")})


class BotDailyTasksBroadcastView(APIView):
    """GET /api/bot/broadcasts/daily-tasks/?date=<AAAA-MM-DD, opcional>

    Envio automático das 10h: para os projetos com alocação registrada na
    data informada (padrão: hoje), lista as tarefas pendentes, os técnicos
    alocados e o projeto/site — para os destinatários cadastrados com
    receives_daily_tasks=True."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        target_date, error = _parse_target_date(request, default_days_ahead=0)
        if error:
            return error

        projects = build_daily_tasks_projects(target_date)

        return Response(
            {
                "date": target_date.isoformat(),
                "projects": projects,
                "recipients": _active_subscribers("receives_daily_tasks"),
            }
        )


class BotProjectUpdatesBroadcastView(APIView):
    """GET /api/bot/broadcasts/project-updates/?date=<AAAA-MM-DD, opcional>

    Envio automático das 17h: para os mesmos projetos alocados na data
    informada (padrão: hoje), traz o mesmo conteúdo da Atualização Diária de
    Projeto enviada por e-mail (ver updates/project_client_mail.py) — para os
    destinatários cadastrados com receives_project_updates=True."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        target_date, error = _parse_target_date(request, default_days_ahead=0)
        if error:
            return error

        projects = build_project_updates_projects(target_date)

        return Response(
            {
                "date": target_date.isoformat(),
                "workday_start": WORKDAY_START,
                "workday_end": WORKDAY_END,
                "projects": projects,
                "recipients": _active_subscribers("receives_project_updates"),
            }
        )


def _rule_projects_queryset(rule):
    """Projetos que entram numa regra de envio. Filtro vazio = não filtra
    por aquela dimensão. O cliente pode estar direto no projeto ou herdado
    do site."""
    qs = Project.objects.filter(is_active=True)
    if rule.statuses:
        qs = qs.filter(status__in=rule.statuses)
    client_ids = list(rule.clients.values_list("pk", flat=True))
    if client_ids:
        qs = qs.filter(Q(client_id__in=client_ids) | Q(site__client_id__in=client_ids))
    category_ids = list(rule.categories.values_list("pk", flat=True))
    if category_ids:
        category_q = Q(category_id__in=category_ids)
        if rule.include_no_category:
            category_q |= Q(category__isnull=True)
        qs = qs.filter(category_q)
    region_ids = list(rule.regions.values_list("pk", flat=True))
    if region_ids:
        qs = qs.filter(site__region_id__in=region_ids)
    responsible_ids = list(rule.responsibles.values_list("pk", flat=True))
    if responsible_ids:
        qs = qs.filter(responsible_cstr_id__in=responsible_ids)
    site_ids = list(rule.sites.values_list("pk", flat=True))
    if site_ids:
        qs = qs.filter(site_id__in=site_ids)
    return qs


def build_daily_project_report_projects(target_date, rule=None):
    """Dados compartilhados entre o texto e a imagem do relatório das 15h.

    A imagem não depende de um layout fixo: esta função sempre calcula a
    lista atual de projetos e as mesmas condicionais usadas no texto.
    Com `rule`, os filtros vêm da regra de envio; sem ela, entram todos os
    projetos ativos e em andamento.
    """
    if rule is not None:
        projects_qs = (
            _rule_projects_queryset(rule)
            .select_related("site", "site__client", "client", "category", "responsible_client__person", "responsible_cstr__person")
            .order_by("name")
        )
    else:
        # Disparo manual sem regra: todos os projetos ativos e em andamento. Recortes por
        # cliente/categoria/regional/etc. são feitos pelos filtros das regras de envio.
        projects_qs = (
            Project.objects.filter(status=Project.STATUS_IN_PROGRESS, is_active=True)
            .select_related("site", "site__client", "client", "category", "responsible_client__person", "responsible_cstr__person")
            .order_by("name")
        )

    project_ids = [p.id for p in projects_qs]

        # Pendências/Bloqueios: ocorrências ainda não resolvidas (aberta ou em
        # andamento) do projeto — sem data-corte, é um retrato do estado atual,
        # não algo restrito ao dia do relatório.
    open_occurrences = {}
    for occurrence in ProjectOccurrence.objects.filter(
        project_id__in=project_ids,
        status__in=(ProjectOccurrence.STATUS_OPEN, ProjectOccurrence.STATUS_IN_PROGRESS),
    ).order_by("-occurred_at", "-id"):
        open_occurrences.setdefault(occurrence.project_id, []).append(occurrence.title)

        # Certificação é derivada, não digitada: um projeto conta como
        # certificado quando tem ao menos um anexo (o laudo/relatório de
        # certificação é justamente o que se anexa ao projeto).
    certified_ids = set(
        ProjectAttachment.objects.filter(project_id__in=project_ids)
        .values_list("project_id", flat=True)
        .distinct()
    )

        # "Avanço no dia" = avanço de hoje menos o do retrato diário anterior.
        # Busca o retrato mais recente ANTES da data alvo (e não o de ontem
        # especificamente) para que fim de semana/feriado sem envio não zere a
        # comparação — o delta passa a ser "desde a última vez que medimos".
    previous_percent = {}
    for snapshot in ProjectProgressSnapshot.objects.filter(
        project_id__in=project_ids, date__lt=target_date
    ).order_by("project_id", "-date"):
        previous_percent.setdefault(snapshot.project_id, snapshot.percent)

    projects = []
    for project in projects_qs:
        defaults = compute_progress_defaults(project, target_date)
        percent = defaults["percent"]
        previous = previous_percent.get(project.id)

        projects.append(
            {
                "project": project.name,
                "po": project.po or None,
                "site": project.site.code or project.site.name if project.site_id else None,
                "responsible_client": project.responsible_client.person.name if project.responsible_client_id else None,
                "responsible_cstr": project.responsible_cstr.person.name if project.responsible_cstr_id else None,
                "completion_percent": percent,
                "daily_delta": None if previous is None else percent - previous,
                "planned_end": project.planned_end.strftime("%Y-%m-%d") if project.planned_end else None,
                "certification_label": "Concluída" if project.id in certified_ids else "Pendente",
                "project_finished": defaults["project_finished"],
                "occurrences": open_occurrences.get(project.id, []),
            }
        )

        # Grava o retrato de hoje DEPOIS de calcular o delta. Rodar de novo
        # no mesmo dia só atualiza o valor, sem afetar a comparação.
        ProjectProgressSnapshot.objects.update_or_create(
            project=project, date=target_date, defaults={"percent": percent}
        )

    return projects


class BotDailyProjectReportBroadcastView(APIView):
    """GET /api/bot/broadcasts/daily-project-report/?date=<AAAA-MM-DD, opcional>"""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        target_date, error = _parse_target_date(request, default_days_ahead=0)
        if error:
            return error

        projects = build_daily_project_report_projects(target_date)

        return Response(
            {
                "date": target_date.isoformat(),
                "projects": projects,
                "recipients": _active_subscribers("receives_daily_project_report"),
            }
        )


class BotMessageTemplatesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not request.user.has_perm("bot.view_botmessagetemplate"):
            return Response({"detail": "Sem permissão."}, status=403)
        return Response([get_effective_template(message_type) for message_type in FIELD_DEFINITIONS])

    def patch(self, request):
        if not request.user.has_perm("bot.change_botmessagetemplate"):
            return Response({"detail": "Sem permissão."}, status=403)
        message_type = request.data.get("message_type")
        if message_type not in FIELD_DEFINITIONS:
            return Response({"detail": "Tipo de mensagem inválido."}, status=400)
        allowed_fields = {key for key, _label in FIELD_DEFINITIONS[message_type]}
        enabled_fields = {
            key: bool(value)
            for key, value in (request.data.get("enabled_fields") or {}).items()
            if key in allowed_fields
        }
        template, _created = BotMessageTemplate.objects.update_or_create(
            message_type=message_type,
            defaults={
                "title": request.data.get("title", ""),
                "intro_text": request.data.get("intro_text", ""),
                "footer_text": request.data.get("footer_text", ""),
                "enabled_fields": enabled_fields,
                "is_active": bool(request.data.get("is_active", True)),
            },
        )
        return Response(get_effective_template(template.message_type))


class BotMessageTemplatePreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.has_perm("bot.view_botmessagetemplate"):
            return Response({"detail": "Sem permissão."}, status=403)
        message_type = request.data.get("message_type")
        if message_type not in FIELD_DEFINITIONS:
            return Response({"detail": "Tipo de mensagem inválido."}, status=400)
        return Response({"preview": preview_for_template(request.data)})


class BotMessageTemplateRuntimeView(APIView):
    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        message_type = request.query_params.get("message_type")
        if message_type not in FIELD_DEFINITIONS:
            return Response({"detail": "Tipo de mensagem inválido."}, status=400)
        return Response(get_effective_template(message_type))

import csv

from django.db import models, transaction
from django.db.models.functions import Coalesce
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import mixins, permissions, viewsets
from rest_framework import status as drf_status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from audit.models import AuditLog
from core.access_scope import (
    deny_if_client_scoped,
    scope_category_queryset,
    scope_client_queryset,
    scope_project_queryset,
    scope_site_queryset,
    user_can_access_project,
)
from core.csv_io import MAX_CSV_UPLOAD_BYTES, build_csv_content, import_csv_rows
from core.models import (
    Category,
    Client,
    Collaborator,
    Company,
    JobTitle,
    Notification,
    ConsultimerProjectType,
    ProjectType,
    PushSubscription,
    Region,
    Responsible,
    Site,
    Task,
    get_collaborator_role,
)
from dispatch.models import CollaboratorPair, TechnicianAbsence, TechnicianDailyPresence, TechnicianStatusEvent
from dispatch.services import release_stuck_execution
from master_data.models import (
    Activity,
    CableAlias,
    CableFamily,
    CableImport,
    CableImportItem,
    CableSpec,
    CertificationType,
    DeviceType,
    GeneratedTask,
    GeneratedTaskDependency,
    Location,
    Network,
    Path,
    ScopeItem,
    SowImport,
    SowParsedItem,
    TaskTemplate,
    TaskTemplateRule,
    TaskTemplateStep,
    Workstream,
)
from master_data.models import Site as MasterDataSite
from master_data.services.cable_wizard import WizardError as CableWizardError
from master_data.services.cable_wizard import build_preview as build_cable_wizard_preview
from master_data.services.cable_wizard import create_from_wizard as create_cable_wizard
from master_data.services.cable_wizard import wizard_options as cable_wizard_options
from master_data.services.cable_import import CableImportError, create_cable_import, finalize_cable_import, recompute_item_conflicts
from master_data.services.sow_parser.ai_parser import AiSowParserError, get_ai_config_status, get_ai_sow_parser
from master_data.services.sow_parser.service import (
    ApprovalBlockedError,
    FinalizeBlockedError,
    ReprocessBlockedError,
    SowProcessingError,
    approve_selected as sow_approve_selected,
    approve_sow_parsed_item,
    finalize_sow_import,
    process_sow_import,
    reject_selected as sow_reject_selected,
    reject_sow_parsed_item,
    reprocess_sow_import,
    reprocess_sow_parsed_item,
)
from master_data.services.task_dependency_generator import generate_dependencies_for_scope_item
from master_data.services.task_generator import TaskGenerationError, generate_tasks_for_scope_item
from master_data.services.task_rule_resolver import (
    TaskRuleResolutionError,
    apply_resolution_to_scope_item,
    simulate_task_template,
)
from projects.models import (
    Project,
    ProjectAttachment,
    ProjectHourEntry,
    ProjectOccurrence,
    ProjectTask,
    ProjectTaskAssignment,
    RackPosition,
    merged_worked_hours,
)
from projects.services import (
    BulkActionError,
    add_custom_tasks_to_project,
    add_tasks_to_project,
    apply_bulk_task_update,
    create_project_tasks_from_generated_tasks,
    create_rack_positions_bulk,
    create_task_instances,
    import_tasks_from_project_type,
)
from technical.models import MyTask
from updates.mail import send_daily_update_emails
from updates.models import DailyUpdate, DailyUpdateAllocation, ProjectDailyUpdate
from updates.pdf import build_daily_updates_pdf
from updates.project_client_mail import send_project_daily_update_email, send_weekly_update_email
from updates.project_pdf import build_project_daily_update_pdf

from .permissions import (
    AllowManageProjectTasks,
    CableImportPermission,
    CableWizardPermission,
    DenyClientScopedUsers,
    IsSuperUser,
    require_perms,
    RequireChangePermissionForActions,
    RequireViewPermissionForActions,
    ViewAwareModelPermissions,
)
from core.collaborator_scope import managed_collaborator_ids, scope_collaborators, scope_supervisor_projects
from .serializers import (
    AuditLogSerializer,
    ClientCrudSerializer,
    ClientSerializer,
    CollaboratorCrudSerializer,
    CollaboratorSerializer,
    CompanyCrudSerializer,
    CableAliasCrudSerializer,
    CableFamilyCrudSerializer,
    CableImportItemSerializer,
    CableImportSerializer,
    CableSpecCrudSerializer,
    ActivityCrudSerializer,
    NetworkCrudSerializer,
    DeviceTypeCrudSerializer,
    TaskTemplateCrudSerializer,
    TaskTemplateStepCrudSerializer,
    TaskTemplateRuleCrudSerializer,
    TaskTemplateRuleSimulateSerializer,
    ScopeItemCrudSerializer,
    GeneratedTaskCrudSerializer,
    GeneratedTaskDependencyCrudSerializer,
    SowImportSerializer,
    SowParsedItemSerializer,
    LocationCrudSerializer,
    MasterDataSiteCrudSerializer,
    PathCrudSerializer,
    WorkstreamCrudSerializer,
    CertificationTypeCrudSerializer,
    CategoryCrudSerializer,
    DailyUpdateSerializer,
    JobTitleCrudSerializer,
    MyTaskSerializer,
    MyTaskUpdateSerializer,
    NotificationSerializer,
    ProjectAttachmentSerializer,
    ProjectDailyUpdateCreateSerializer,
    ProjectDailyUpdateSerializer,
    ProjectOccurrenceSerializer,
    ProjectSerializer,
    ProjectTaskBulkActionSerializer,
    ProjectTaskCreateSerializer,
    ProjectTaskSerializer,
    ConsultimerProjectTypeCrudSerializer,
    ProjectTypeCrudSerializer,
    RackPositionBulkCreateSerializer,
    RackPositionSerializer,
    RegionSerializer,
    ResponsibleCrudSerializer,
    SiteCrudSerializer,
    SiteSerializer,
    TaskCrudSerializer,
    TechnicianAbsenceSerializer,
    TechnicianDailyPresenceSerializer,
)


def clean_bulk_names(raw_names):
    """Normaliza a lista de nomes vinda do textarea 'Adicionar Vários': tira
    espaços, remove vazios e duplicados preservando a ordem — mesmo
    comportamento do ProjectTypeAdminForm/TaskAdminForm no Django Admin."""
    if not isinstance(raw_names, list):
        return []
    return list(dict.fromkeys(name.strip() for name in raw_names if isinstance(name, str) and name.strip()))


class CSVExportImportMixin:
    """Adiciona export-csv (GET) e import-csv (POST multipart) a qualquer
    ViewSet de Cadastros Gerais — mesma lógica usada pelos botões
    'Importar/Exportar CSV' do Django Admin (core/csv_io.py): colunas
    derivadas automaticamente dos campos editáveis do model, relações
    exportadas/importadas pelo texto do __str__ do registro relacionado."""

    @action(detail=False, methods=["get"], url_path="export-csv")
    def export_csv(self, request):
        model = self.get_queryset().model
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{model._meta.model_name}.csv"'
        response.write(build_csv_content(model, self.get_queryset()))
        return response

    @action(detail=False, methods=["post"], url_path="import-csv", parser_classes=[MultiPartParser])
    def import_csv(self, request):
        model = self.get_queryset().model
        uploaded_file = request.FILES.get("csv_file")
        if not uploaded_file:
            return Response({"detail": "Envie um arquivo CSV no campo 'csv_file'."}, status=400)
        if uploaded_file.size > MAX_CSV_UPLOAD_BYTES:
            return Response(
                {"detail": f"Arquivo CSV muito grande (máximo {MAX_CSV_UPLOAD_BYTES // (1024 * 1024)} MB)."},
                status=400,
            )
        try:
            content = uploaded_file.read().decode("utf-8-sig")
            created, errors = import_csv_rows(model, content)
        except (UnicodeDecodeError, csv.Error, ValueError) as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"created": created, "errors": errors})


class RegistryViewSet(CSVExportImportMixin, viewsets.ModelViewSet):
    """Base para os cadastros gerais: CRUD completo com busca simples por
    nome e filtro opcional por is_active, protegido pelas permissões
    padrão do Django (view/add/change/delete) por modelo."""

    permission_classes = [ViewAwareModelPermissions]
    search_fields: tuple[str, ...] = ("name",)

    ORDERING_ALLOWLIST = ("updated_at", "-updated_at", "created_at", "-created_at")

    # Como um usuário-cliente (User.client preenchido) deve ser tratado neste
    # cadastro: "deny" (padrão) nega acesso total — cadastro interno, sem
    # relação direta com Cliente; "client"/"site"/"category" aplicam o
    # escopo correspondente de core.access_scope. Subclasses que representam
    # dado do próprio Cliente (Client, Site, Categoria) sobrescrevem isso.
    client_scope_mode = "deny"
    client_scope_field = None

    # Nome do campo booleano "ativo" no model — todo cadastro existente usa
    # is_active; CableFamily (Cadastros Mestres) usa "active" (ver estrutura
    # pedida para o módulo). O parâmetro de busca na URL continua sempre
    # ?is_active=, só o campo filtrado no banco muda por subclasse.
    active_field = "is_active"

    def get_queryset(self):
        queryset = super().get_queryset()
        is_active = self.request.query_params.get("is_active")
        if is_active is not None:
            queryset = queryset.filter(**{self.active_field: is_active.lower() in ("1", "true", "yes")})
        search = self.request.query_params.get("search")
        if search:
            from django.db.models import Q

            condition = Q()
            for field in self.search_fields:
                condition |= Q(**{f"{field}__icontains": search})
            queryset = queryset.filter(condition)
        ordering = self.request.query_params.get("ordering")
        if ordering in self.ORDERING_ALLOWLIST:
            queryset = queryset.order_by(ordering)
        return self.apply_client_scope(queryset)

    def apply_client_scope(self, queryset):
        user = self.request.user
        if self.client_scope_mode == "client":
            return scope_client_queryset(queryset, user, client_field=self.client_scope_field or "id")
        if self.client_scope_mode == "site":
            return scope_site_queryset(queryset, user, client_field=self.client_scope_field or "client_id")
        if self.client_scope_mode == "category":
            return scope_category_queryset(queryset, user)
        return deny_if_client_scoped(queryset, user)


class UserOptionsView(APIView):
    """Lista enxuta de usuários do sistema (id/nome/e-mail) para telas que
    precisam deixar o usuário escolher destinatários adicionais de e-mail
    (ex: enviar Atualização de Projeto para alguém além dos responsáveis)."""

    permission_classes = [DenyClientScopedUsers]

    def get(self, request):
        from users.models import User

        users = (
            User.objects.filter(is_active=True)
            .exclude(email="")
            .order_by("first_name", "last_name", "username")
        )
        data = [
            {"id": u.pk, "name": u.get_full_name() or u.username, "email": u.email}
            for u in users
        ]
        return Response(data)


class MeView(APIView):
    def get(self, request):
        user = request.user
        if user.is_superuser:
            permissions = ["*"]
        else:
            permissions = sorted(user.get_all_permissions())
        return Response({
            "id": user.pk,
            "username": user.get_username(),
            "full_name": user.get_full_name(),
            "email": user.email,
            "company_id": user.company_id,
            "is_superuser": user.is_superuser,
            "permissions": permissions,
            "has_collaborator_profile": get_collaborator_role(user) is not None,
            "must_change_password": user.must_change_password,
        })


class ChangePasswordView(APIView):
    """Permite ao usuário autenticado trocar a própria senha (menu Minha
    Conta), validando a senha atual e aplicando os mesmos validadores de
    senha do Django Admin/createsuperuser."""

    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        old_password = request.data.get("old_password") or ""
        new_password = request.data.get("new_password") or ""
        if not request.user.check_password(old_password):
            return Response({"detail": "Senha atual incorreta."}, status=400)
        if not new_password:
            return Response({"detail": "Informe a nova senha."}, status=400)
        try:
            validate_password(new_password, user=request.user)
        except DjangoValidationError as exc:
            return Response({"detail": " ".join(exc.messages)}, status=400)
        request.user.set_password(new_password)
        request.user.must_change_password = False
        request.user.save(update_fields=["password", "must_change_password"])
        return Response({"detail": "Senha alterada com sucesso."})


class GlobalSearchView(APIView):
    """Busca global do shell (barra de pesquisa no topo): procura Projetos
    (nome/código/PO), Sites (nome/código) e Tarefas de Projeto (pelo nome
    da Tarefa do catálogo), respeitando o escopo de acesso do usuário-
    cliente. Resultados limitados a 6 por categoria — é um "quick search",
    não uma busca paginada."""

    LIMIT = 6

    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        if len(query) < 2:
            return Response({"projects": [], "sites": [], "tasks": []})
        user = request.user
        can_projects = user.has_perm("projects.view_project")
        can_sites = user.has_perm("core.view_site")
        can_tasks = user.has_perm("projects.view_projecttask")

        projects_qs = scope_project_queryset(
            Project.objects.select_related("client", "site").filter(
                models.Q(name__icontains=query) | models.Q(code__icontains=query) | models.Q(po__icontains=query)
            ),
            request.user,
        )[: self.LIMIT]
        projects = [
            {
                "id": p.pk,
                "code": p.code,
                "name": p.name,
                "po": p.po,
                "client": str(p.client) if p.client_id else "",
                "site": str(p.site) if p.site_id else "",
            }
            for p in projects_qs
        ] if can_projects else []

        sites_qs = scope_site_queryset(
            Site.objects.select_related("client").filter(
                models.Q(name__icontains=query) | models.Q(code__icontains=query)
            ),
            request.user,
        )[: self.LIMIT]
        sites = [
            {
                "id": s.pk,
                "code": s.code,
                "name": s.name,
                "client": str(s.client) if s.client_id else "",
                "city": s.city,
            }
            for s in sites_qs
        ] if can_sites else []

        tasks_qs = scope_project_queryset(
            ProjectTask.objects.select_related("task", "project").filter(
                models.Q(task__name__icontains=query) | models.Q(custom_name__icontains=query)
            ),
            request.user,
            field_prefix="project__",
        )[: self.LIMIT]
        tasks = [
            {
                "id": t.pk,
                "task_name": t.display_name,
                "project_id": t.project_id,
                "project_name": t.project.name,
                "project_code": t.project.code,
                "status": t.status,
                "status_display": t.get_status_display(),
            }
            for t in tasks_qs
        ] if can_tasks else []

        return Response({"projects": projects, "sites": sites, "tasks": tasks})


class ClientViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Client.objects.filter(is_active=True).order_by("legal_name")
    serializer_class = ClientSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        return scope_client_queryset(super().get_queryset(), self.request.user)


class RegionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Region.objects.filter(is_active=True).order_by("country", "name")
    serializer_class = RegionSerializer
    permission_classes = [permissions.IsAuthenticated]


class SiteViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Site.objects.filter(is_active=True).select_related("region").order_by("name")
    serializer_class = SiteSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        return scope_site_queryset(super().get_queryset(), self.request.user)


class CollaboratorViewSet(viewsets.ReadOnlyModelViewSet):
    """Colaboradores são dados internos (equipe CSTR), não do Cliente — um
    usuário-cliente não deve enxergá-los de forma alguma."""

    queryset = Collaborator.objects.filter(is_active=True).select_related("person").order_by("person__name")
    serializer_class = CollaboratorSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        queryset = deny_if_client_scoped(super().get_queryset(), self.request.user)
        # Supervisor só enxerga os colaboradores sob a sua gestão.
        return scope_collaborators(queryset, self.request.user)


def _collaborators_outside_team(user, collaborator_ids):
    """Supervisor só aloca/despacha técnicos sob a sua gestão: devolve a resposta 403 se algum
    técnico informado estiver fora da equipe (None quando está tudo certo ou não há restrição)."""
    allowed = managed_collaborator_ids(user)
    if allowed is None:
        return None
    requested = set()
    for value in collaborator_ids:
        try:
            requested.add(int(value))
        except (TypeError, ValueError):
            continue
    if requested - allowed:
        return Response({"detail": "Só é possível alocar técnicos que estão sob a sua gestão."}, status=403)
    return None


class ProjectViewSet(AllowManageProjectTasks, RequireChangePermissionForActions, viewsets.ModelViewSet):
    queryset = (
        Project.objects.select_related(
            "client", "site", "category", "consultimer_type", "responsible_cstr__person", "responsible_client__person"
        )
        .prefetch_related("project_tasks__assignments")
        .order_by("-created_at")
    )
    serializer_class = ProjectSerializer
    permission_classes = [ViewAwareModelPermissions]
    change_permission_actions = ("tasks_bulk", "import_tasks", "rack_positions_bulk", "tasks_create", "tasks_create_custom")
    # Ajuste em massa de tarefas (status, datas, colaboradores) também liberado a quem gerencia tarefas.
    manage_task_actions = ("tasks_bulk",)

    def get_queryset(self):
        queryset = super().get_queryset().annotate(
            historical_hours_total=Coalesce(
                models.Subquery(
                    ProjectHourEntry.objects.filter(project=models.OuterRef("pk"))
                    .values("project")
                    .annotate(total=models.Sum("total_hours"))
                    .values("total")[:1]
                ),
                models.Value(0),
                output_field=models.DecimalField(max_digits=10, decimal_places=2),
            )
        )
        status_param = self.request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                models.Q(name__icontains=search) | models.Q(code__icontains=search) | models.Q(po__icontains=search)
            )
        # Supervisor só enxerga os projetos em que é Responsável CSTR (lista, detalhe e ações).
        queryset = scope_supervisor_projects(queryset, self.request.user)
        return scope_project_queryset(queryset, self.request.user)

    @action(detail=True, methods=["get"])
    def tasks(self, request, pk=None):
        project = self.get_object()
        tasks = (
            project.project_tasks.select_related(
                "task", "project", "generated_task__activity", "generated_task__path",
                "generated_task__scope_item", "generated_task__task_template",
            )
            .prefetch_related("collaborators__person", "rack_positions", "assignments")
            .order_by("order", "id")
        )
        serializer = ProjectTaskSerializer(tasks, many=True, context=self.get_serializer_context())
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="hours-by-collaborator")
    def hours_by_collaborator(self, request, pk=None):
        project = self.get_object()
        tasks = list(project.project_tasks.prefetch_related("collaborators__person"))

        tasks_by_collaborator: dict[int, list] = {}
        names_by_collaborator: dict[int, str] = {}
        for task in tasks:
            for collaborator in task.collaborators.all():
                tasks_by_collaborator.setdefault(collaborator.id, []).append(task)
                names_by_collaborator[collaborator.id] = collaborator.person.name

        data = [
            {
                "collaborator_id": collaborator_id,
                "collaborator_name": names_by_collaborator[collaborator_id],
                # Mescla intervalos sobrepostos (ex: técnico inicia várias
                # tarefas ao mesmo tempo) para não contar o mesmo tempo
                # trabalhado mais de uma vez.
                "hours": merged_worked_hours(collaborator_tasks),
            }
            for collaborator_id, collaborator_tasks in tasks_by_collaborator.items()
        ]
        data = [item for item in data if item["hours"] > 0]
        data.sort(key=lambda item: item["hours"], reverse=True)
        return Response(data)

    @action(detail=True, methods=["get"], url_path="rack-positions")
    def rack_positions(self, request, pk=None):
        project = self.get_object()
        positions = project.rack_positions.all().order_by("position")
        serializer = RackPositionSerializer(positions, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="rack-positions/bulk")
    def rack_positions_bulk(self, request, pk=None):
        project = self.get_object()
        if not project.has_rack_positions:
            return Response({"detail": 'Marque "Rack Position" para poder cadastrar Rack Positions.'}, status=400)
        payload = RackPositionBulkCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            created, skipped = create_rack_positions_bulk(project, payload.validated_data["text"])
        except BulkActionError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"created": created, "skipped": skipped})

    @action(detail=True, methods=["post"], url_path="tasks/create")
    def tasks_create(self, request, pk=None):
        project = self.get_object()
        payload = ProjectTaskCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        rack_positions = data["rack_position_ids"]
        invalid = [rp for rp in rack_positions if rp.project_id != project.pk]
        if invalid:
            names = ", ".join(rp.position for rp in invalid)
            return Response({"detail": f"Rack Position(s) que não pertencem a este projeto: {names}."}, status=400)

        fields = {
            "status": data["status"],
            "planned_start": data["planned_start"],
            "planned_end": data["planned_end"],
            "estimated_hours": data["estimated_hours"] if data["estimated_hours"] is not None else data["task"].estimated_hours,
            "notes": data["notes"],
        }
        created, skipped = create_task_instances(project, data["task"], rack_positions, collaborators=data["collaborator_ids"], **fields)
        tasks = ProjectTaskSerializer(created, many=True).data
        return Response({"created": len(created), "skipped": skipped, "tasks": tasks})

    @action(detail=True, methods=["post"], url_path="tasks/create-custom")
    def tasks_create_custom(self, request, pk=None):
        project = self.get_object()
        names = clean_bulk_names(request.data.get("names"))
        if not names:
            return Response({"detail": "Informe ao menos um nome de tarefa."}, status=400)
        created = add_custom_tasks_to_project(project, names)
        tasks = ProjectTaskSerializer(created, many=True).data
        return Response({"created": len(created), "tasks": tasks})

    @action(detail=True, methods=["post"], url_path="import-tasks")
    def import_tasks(self, request, pk=None):
        project = self.get_object()
        try:
            created = import_tasks_from_project_type(project)
        except BulkActionError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"created": created})

    @action(detail=True, methods=["post"], url_path="tasks/bulk")
    def tasks_bulk(self, request, pk=None):
        project = self.get_object()
        payload = ProjectTaskBulkActionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        bulk_action = data["action"]

        # Quem só gerencia tarefas (sem poder de alterar/criar projetos) não adiciona nem exclui tarefas em massa.
        user = request.user
        if bulk_action in (ProjectTaskBulkActionSerializer.ACTION_ADD, ProjectTaskBulkActionSerializer.ACTION_DELETE) and not (
            user.has_perm("projects.change_project") and user.has_perm("projects.add_project")
        ):
            return Response({"detail": "Sem permissão para adicionar ou excluir tarefas."}, status=403)

        if bulk_action == ProjectTaskBulkActionSerializer.ACTION_ADD:
            add_tasks = data["add_task_ids"]
            if not add_tasks:
                return Response({"detail": "Selecione ao menos uma Tarefa do catálogo para adicionar."}, status=400)
            rack_positions = data["rack_position_ids"]
            if rack_positions:
                invalid = [rp for rp in rack_positions if rp.project_id != project.pk]
                if invalid:
                    names = ", ".join(rp.position for rp in invalid)
                    return Response({"detail": f"Rack Position(s) que não pertencem a este projeto: {names}."}, status=400)
            created = add_tasks_to_project(project, add_tasks, rack_positions=rack_positions or None)
            return Response({"created": created})

        selected_ids = [task.pk for task in data["task_ids"]]
        target_tasks = project.project_tasks.filter(pk__in=selected_ids)
        if not selected_ids:
            return Response({"detail": "Selecione ao menos uma Tarefa."}, status=400)

        if bulk_action == ProjectTaskBulkActionSerializer.ACTION_DELETE:
            deleted, _ = target_tasks.delete()
            return Response({"deleted": deleted})

        collaborators = data["collaborator_ids"]
        outside_team = _collaborators_outside_team(request.user, [c.pk for c in collaborators])
        if outside_team:
            return outside_team
        rack_positions = data["rack_position_ids"]
        if rack_positions:
            invalid = [rp for rp in rack_positions if rp.project_id != project.pk]
            if invalid:
                names = ", ".join(rp.position for rp in invalid)
                return Response({"detail": f"Rack Position(s) que não pertencem a este projeto: {names}."}, status=400)
        has_input = (
            data["status"]
            or data["planned_start"]
            or data["planned_end"]
            or data["estimated_hours"] is not None
            or data.get("priority")
            or collaborators
            or rack_positions
        )
        if not has_input:
            return Response({"detail": "Informe ao menos um valor para a atualização em massa."}, status=400)
        updated = apply_bulk_task_update(
            target_tasks,
            status=data["status"] or None,
            planned_start=data["planned_start"],
            planned_end=data["planned_end"],
            estimated_hours=data["estimated_hours"],
            priority=data.get("priority") or None,
            collaborators=collaborators,
            rack_positions=rack_positions,
        )
        return Response({"updated": updated})


class ProjectTaskViewSet(AllowManageProjectTasks, RequireChangePermissionForActions, viewsets.ModelViewSet):
    queryset = ProjectTask.objects.select_related(
        "task", "project", "generated_task__activity", "generated_task__path", "generated_task__scope_item", "generated_task__task_template"
    ).prefetch_related("collaborators__person", "rack_positions", "assignments")
    serializer_class = ProjectTaskSerializer
    permission_classes = [ViewAwareModelPermissions]
    change_permission_actions = ("dispatch_task", "undispatch_task", "return_to_pool", "dispatch_bulk", "assignment_status")
    # Gestor (permissão dedicada) despacha, altera status/datas/colaboradores; criar e excluir seguem restritos.
    manage_task_actions = ("dispatch_task", "undispatch_task", "return_to_pool", "dispatch_bulk", "assignment_status", "update", "partial_update")

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        # Filtros usados pela tela Planejamento > Plano do Projeto ao
        # atribuir tarefas geradas a partir de uma SOW — nenhum desses é
        # uma coluna própria de ProjectTask, todos vêm de generated_task
        # (ver ProjectTaskSerializer).
        activity_code = self.request.query_params.get("activity")
        if activity_code:
            queryset = queryset.filter(generated_task__activity__code=activity_code)
        path_code = self.request.query_params.get("path")
        if path_code:
            queryset = queryset.filter(generated_task__path__code=path_code)
        sow_import_code = self.request.query_params.get("sow_import")
        if sow_import_code:
            queryset = queryset.filter(generated_task__scope_item__source_reference=sow_import_code)
        origin = self.request.query_params.get("origin")
        if origin:
            queryset = queryset.filter(origin=origin)
        queryset = scope_project_queryset(queryset, self.request.user, field_prefix="project__")
        # Supervisor só enxerga/altera tarefas dos projetos em que é Responsável CSTR.
        queryset = scope_supervisor_projects(queryset, self.request.user, field_prefix="project__")
        return queryset.order_by("order", "id")

    def perform_create(self, serializer):
        from django.db import transaction

        project = serializer.validated_data["project"]
        with transaction.atomic():
            Project.objects.select_for_update().filter(pk=project.pk).exists()
            next_order = (project.project_tasks.aggregate(highest=models.Max("order"))["highest"] or 0) + 1
            serializer.save(order=serializer.validated_data.get("order") or next_order)

    def perform_update(self, serializer):
        # Status enviado no PATCH da tarefa inteira é aplicado a todos os técnicos
        # despachados, sem apontamento de horas (ver ProjectTask.set_status_by_admin).
        status = serializer.validated_data.pop("status", None)
        instance = serializer.save()
        if status:
            instance.set_status_by_admin(status)

    @action(detail=True, methods=["post"], url_path="assignment-status")
    def assignment_status(self, request, pk=None):
        """Ajusta o status de UM técnico despachado (ex.: admin finaliza a parte
        de quem esqueceu de finalizar). Sem apontamento de horas — ver
        ProjectTask.set_assignment_status_by_admin. Body: collaborator_id, status,
        e opcionalmente completion_outcome."""
        task = self.get_object()
        collaborator_id = request.data.get("collaborator_id")
        status_value = request.data.get("status")
        if not collaborator_id or status_value not in dict(ProjectTask.STATUS_CHOICES):
            return Response({"detail": "Informe collaborator_id e um status válido."}, status=400)
        try:
            task.set_assignment_status_by_admin(
                int(collaborator_id), status_value, completion_outcome=request.data.get("completion_outcome")
            )
        except ProjectTaskAssignment.DoesNotExist:
            return Response({"detail": "Este técnico não está despachado para a tarefa."}, status=404)
        task.refresh_from_db()
        return Response(ProjectTaskSerializer(task, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_task(self, request, pk=None):
        """Despacha a tarefa pra um ou mais técnicos: cria (ou atualiza) a
        ProjectTaskAssignment de cada um, colocando-a no fim da fila dele
        (posições anteriores dele em tarefas ainda não iniciadas)."""
        task = self.get_object()
        collaborator_ids = list(request.data.get("collaborator_ids") or [])
        if not collaborator_ids:
            return Response({"detail": "Informe ao menos um técnico."}, status=400)
        outside_team = _collaborators_outside_team(request.user, collaborator_ids)
        if outside_team:
            return outside_team

        collaborators = self._dispatch_collaborators(collaborator_ids)
        self._assign_collaborators(task, collaborators, request.user)

        # `task` veio de self.get_object(), que já tinha prefetch_related("collaborators")
        # rodado (vazio, antes do despacho acima) — refresh_from_db() limpa esse cache
        # de prefetch pra refletir as ProjectTaskAssignment recém-criadas na resposta.
        task.refresh_from_db()
        return Response(ProjectTaskSerializer(task, context=self.get_serializer_context()).data)

    @staticmethod
    def _dispatch_collaborators(collaborator_ids):
        """Expande as duplas fixas (sempre despachadas juntas — mesmo que o front só
        tenha mandado um dos dois, o parceiro entra automaticamente) e devolve os
        técnicos ativos."""
        collaborator_ids = list(collaborator_ids)
        paired = CollaboratorPair.objects.filter(
            is_active=True
        ).filter(models.Q(collaborator_a_id__in=collaborator_ids) | models.Q(collaborator_b_id__in=collaborator_ids))
        for pair in paired:
            collaborator_ids.append(pair.collaborator_a_id)
            collaborator_ids.append(pair.collaborator_b_id)
        collaborator_ids = list(dict.fromkeys(collaborator_ids))
        return list(Collaborator.objects.filter(id__in=collaborator_ids, is_active=True))

    @staticmethod
    def _assign_collaborators(task, collaborators, user):
        """Cria (ou atualiza) a ProjectTaskAssignment de cada técnico, colocando a tarefa
        no fim da fila dele (posições anteriores dele em tarefas ainda não iniciadas)."""
        for collaborator in collaborators:
            # Fila do técnico = as tarefas que ELE ainda não iniciou.
            next_order = (
                ProjectTaskAssignment.objects.filter(
                    collaborator=collaborator, status=ProjectTask.STATUS_NOT_STARTED
                ).aggregate(highest=models.Max("queue_order"))["highest"]
                or 0
            ) + 1
            ProjectTaskAssignment.objects.update_or_create(
                project_task=task,
                collaborator=collaborator,
                defaults={"dispatched_by": user, "queue_order": next_order},
            )


        task.sync_from_assignments()

    @action(detail=False, methods=["post"], url_path="dispatch-bulk")
    def dispatch_bulk(self, request):
        """Despacha várias tarefas de uma vez para os mesmos técnicos. A ordem de `task_ids`
        é a ordem de entrada na fila de cada técnico. Tudo ou nada (transação única)."""
        from django.db import transaction

        try:
            task_ids = list(dict.fromkeys(int(i) for i in (request.data.get("task_ids") or [])))
        except (TypeError, ValueError):
            return Response({"detail": "task_ids inválido."}, status=400)
        collaborator_ids = list(request.data.get("collaborator_ids") or [])
        if not task_ids:
            return Response({"detail": "Informe ao menos uma tarefa."}, status=400)
        if not collaborator_ids:
            return Response({"detail": "Informe ao menos um técnico."}, status=400)
        outside_team = _collaborators_outside_team(request.user, collaborator_ids)
        if outside_team:
            return outside_team

        tasks_by_id = {t.id: t for t in self.get_queryset().filter(id__in=task_ids)}
        missing = [i for i in task_ids if i not in tasks_by_id]
        if missing:
            return Response({"detail": "Tarefa não encontrada ou sem acesso.", "missing": missing}, status=404)

        collaborators = self._dispatch_collaborators(collaborator_ids)
        with transaction.atomic():
            for task_id in task_ids:
                self._assign_collaborators(tasks_by_id[task_id], collaborators, request.user)
        return Response({"dispatched": len(task_ids), "task_ids": task_ids})

    @action(detail=True, methods=["post"], url_path="undispatch")
    def undispatch_task(self, request, pk=None):
        """Desfaz o despacho: remove a ProjectTaskAssignment de um ou mais
        técnicos (ou de todos, se collaborator_ids não for informado).
        O status da tarefa é recalculado com quem sobrou; sem nenhum técnico,
        mantém o status atual."""
        task = self.get_object()
        collaborator_ids = list(request.data.get("collaborator_ids") or [])

        if collaborator_ids:
            # Mesma expansão de duplas fixas do despacho — remover só um dos
            # dois deixaria a dupla quebrada de forma inconsistente.
            paired = CollaboratorPair.objects.filter(
                is_active=True
            ).filter(models.Q(collaborator_a_id__in=collaborator_ids) | models.Q(collaborator_b_id__in=collaborator_ids))
            for pair in paired:
                collaborator_ids.append(pair.collaborator_a_id)
                collaborator_ids.append(pair.collaborator_b_id)
            collaborator_ids = list(dict.fromkeys(collaborator_ids))
            task.assignments.filter(collaborator_id__in=collaborator_ids).delete()
        else:
            task.assignments.all().delete()

        task.sync_from_assignments()
        task.refresh_from_db()
        return Response(ProjectTaskSerializer(task, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="return-to-pool")
    def return_to_pool(self, request, pk=None):
        """Devolve ao pool uma tarefa em QUALQUER status (inclusive concluída ou
        cancelada). Com `collaborator_ids`, retira SÓ esses técnicos (sem
        expandir duplas — a escolha é explícita): o apontamento deles some e a
        tarefa é recalculada a partir de quem sobrou. Sem `collaborator_ids`,
        ou quando ninguém sobra, a tarefa volta inteira pra Não Iniciada,
        zerando o apontamento real (início, fim, horas e pausas) — senão
        voltaria ao pool com horas fantasma nos relatórios. Datas planejadas
        são mantidas."""
        task = self.get_object()
        collaborator_ids = list(request.data.get("collaborator_ids") or [])
        with transaction.atomic():
            if collaborator_ids:
                task.assignments.filter(collaborator_id__in=collaborator_ids).delete()
            else:
                task.assignments.all().delete()

            # Consulta direta: task.assignments vem do prefetch do get_object() e estaria desatualizado.
            if ProjectTaskAssignment.objects.filter(project_task=task).exists():
                task.sync_from_assignments()
            else:
                # .update() de propósito: ProjectTask.save() recalcula paused_seconds
                # ao sair de "pausada" e desfaria o zeramento abaixo.
                ProjectTask.objects.filter(pk=task.pk).update(
                    status=ProjectTask.STATUS_NOT_STARTED,
                    actual_start=None,
                    actual_end=None,
                    actual_hours=None,
                    paused_seconds=0,
                    paused_at=None,
                    completion_outcome="",
                    quantity_done="",
                    updated_at=timezone.now(),
                )

        task = self.get_queryset().get(pk=task.pk)
        return Response(ProjectTaskSerializer(task, context=self.get_serializer_context()).data)


class RackPositionViewSet(viewsets.ModelViewSet):
    queryset = RackPosition.objects.select_related("project").order_by("project_id", "position")
    serializer_class = RackPositionSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return scope_project_queryset(queryset, self.request.user, field_prefix="project__")


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user).order_by("-created_at")

    def get_permissions(self):
        # Notificações são sempre pessoais — não faz sentido exigir a
        # permissão de model do Django aqui (não há como conceder acesso a
        # "ver notificação de outra pessoa"); basta estar autenticado.
        return [permission() for permission in (permissions.IsAuthenticated,)]

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        return Response({"count": self.get_queryset().filter(is_read=False).count()})

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response({"detail": "ok"})


class VapidPublicKeyView(APIView):
    """GET /api/push/vapid-public-key/ — retorna a chave pública VAPID para o frontend assinar."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from django.conf import settings
        return Response({"vapid_public_key": settings.VAPID_PUBLIC_KEY})


class PushSubscriptionViewSet(mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """POST /api/push-subscriptions/ — salva assinatura do browser.
    DELETE /api/push-subscriptions/<endpoint_hash>/ — remove ao cancelar.
    O endpoint é único por dispositivo; upsert por endpoint para suportar
    renovação automática de assinatura pelo browser."""

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return PushSubscription.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        from core.models import PushSubscription as PS
        endpoint = request.data.get("endpoint", "").strip()
        p256dh = request.data.get("p256dh", "").strip()
        auth = request.data.get("auth", "").strip()
        if not endpoint or not p256dh or not auth:
            return Response({"detail": "endpoint, p256dh e auth são obrigatórios."}, status=400)
        obj, _ = PS.objects.update_or_create(
            endpoint=endpoint,
            defaults={"user": request.user, "p256dh": p256dh, "auth": auth},
        )
        return Response({"id": obj.pk}, status=201)

    def destroy(self, request, *args, **kwargs):
        from core.models import PushSubscription as PS
        endpoint = request.data.get("endpoint", "").strip()
        PS.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response(status=204)


class ProjectOccurrenceViewSet(viewsets.ModelViewSet):
    queryset = ProjectOccurrence.objects.select_related("project", "responsible").order_by("-occurred_at", "-id")
    serializer_class = ProjectOccurrenceSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return scope_project_queryset(queryset, self.request.user, field_prefix="project__")


class ProjectAttachmentViewSet(viewsets.ModelViewSet):
    queryset = ProjectAttachment.objects.select_related("project", "uploaded_by").order_by("-created_at")
    serializer_class = ProjectAttachmentSerializer
    permission_classes = [ViewAwareModelPermissions]
    parser_classes = [MultiPartParser]

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return scope_project_queryset(queryset, self.request.user, field_prefix="project__")

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        attachment = self.get_object()
        filename = attachment.file.name.rsplit("/", 1)[-1]
        return FileResponse(attachment.file.open("rb"), as_attachment=True, filename=filename)


# ---------------------------------------------------------------------------
# Cadastros Gerais
# ---------------------------------------------------------------------------


class CompanyViewSet(RegistryViewSet):
    queryset = Company.objects.order_by("legal_name")
    serializer_class = CompanyCrudSerializer
    search_fields = ("legal_name", "trade_name", "tax_id")


class CategoryViewSet(RegistryViewSet):
    queryset = Category.objects.order_by("name")
    serializer_class = CategoryCrudSerializer
    search_fields = ("name",)
    client_scope_mode = "category"


class CableFamilyViewSet(RegistryViewSet):
    """Cadastros Mestres > Engenharia > Famílias de Cabo. Catálogo interno
    (client_scope_mode="deny", herdado de RegistryViewSet) — sem relação
    com Cliente, um usuário-cliente não deve enxergar este cadastro."""

    queryset = CableFamily.objects.select_related("created_by", "updated_by").order_by("code")
    serializer_class = CableFamilyCrudSerializer
    search_fields = ("code", "name", "description")
    active_field = "active"

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class CableAliasViewSet(RegistryViewSet):
    """Cadastros Mestres > Engenharia > Aliases de Cabos. Mesmo padrão de
    CableFamilyViewSet (catálogo interno, active_field="active"); acrescenta
    filtro exato por família e por tipo de alias além da busca/is_active
    herdados de RegistryViewSet."""

    queryset = CableAlias.objects.select_related("cable_family", "created_by", "updated_by").order_by("alias")
    serializer_class = CableAliasCrudSerializer
    search_fields = ("alias", "normalized_alias", "cable_family__name", "cable_family__code")
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        cable_family_id = self.request.query_params.get("cable_family")
        if cable_family_id:
            queryset = queryset.filter(cable_family_id=cable_family_id)
        alias_type = self.request.query_params.get("alias_type")
        if alias_type:
            queryset = queryset.filter(alias_type=alias_type)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class CableSpecViewSet(RegistryViewSet):
    """Cadastros Mestres > Engenharia > Especificações de Cabos. Mesmo
    padrão de CableFamilyViewSet/CableAliasViewSet; filtros exatos por
    família, part number, tipo de fibra e polaridade além da busca/is_active
    herdados de RegistryViewSet."""

    queryset = CableSpec.objects.select_related("cable_family", "created_by", "updated_by").order_by("code")
    serializer_class = CableSpecCrudSerializer
    search_fields = ("code", "name", "part_number", "manufacturer", "cable_family__name", "cable_family__code")
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param, field in (
            ("cable_family", "cable_family_id"),
            ("part_number", "part_number"),
            ("fiber_type", "fiber_type"),
            ("polarity", "polarity"),
        ):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class CertificationTypeViewSet(RegistryViewSet):
    """Cadastros Mestres > Engenharia > Tipos de Certificação. Mesmo padrão
    de CableFamilyViewSet — catálogo interno, active_field="active". Sem
    relação com CableFamily nesta etapa (deliberadamente fora de escopo)."""

    queryset = CertificationType.objects.select_related("created_by", "updated_by").order_by("code")
    serializer_class = CertificationTypeCrudSerializer
    search_fields = ("code", "name", "method", "description")
    active_field = "active"

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class ActivityViewSet(RegistryViewSet):
    """Cadastros Mestres > Operação > Atividades. Catálogo canônico de
    ações operacionais padronizadas — mesmo padrão de CertificationTypeViewSet
    (catálogo interno, active_field="active"); acrescenta filtros exatos por
    categoria, tipo de execução e mensurável."""

    queryset = Activity.objects.select_related("created_by", "updated_by").order_by("code")
    serializer_class = ActivityCrudSerializer
    search_fields = ("code", "name", "category", "execution_type", "description")
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param in ("category", "execution_type"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        measurable = self.request.query_params.get("measurable")
        if measurable is not None:
            queryset = queryset.filter(measurable=measurable.lower() in ("1", "true", "yes"))
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class NetworkViewSet(RegistryViewSet):
    """Cadastros Mestres > Operação > Redes. Catálogo canônico da função
    lógica/operacional da conexão (não o tipo físico do cabo, não a frente
    de execução do projeto) — mesmo padrão de ActivityViewSet; filtros
    exatos por domínio e meio além da busca/is_active herdados de
    RegistryViewSet."""

    queryset = Network.objects.select_related("created_by", "updated_by").order_by("code")
    serializer_class = NetworkCrudSerializer
    search_fields = ("code", "name", "domain", "medium", "description")
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param in ("domain", "medium"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class WorkstreamViewSet(RegistryViewSet):
    """Cadastros Mestres > Operação > Workstreams. Catálogo canônico das
    frentes operacionais de execução — mesmo padrão de NetworkViewSet;
    filtros exatos por categoria e meio padrão além da busca/is_active
    herdados de RegistryViewSet. Sem relação com Network nesta etapa
    (deliberadamente fora de escopo — ver docstring do model)."""

    queryset = Workstream.objects.select_related("created_by", "updated_by").order_by("code")
    serializer_class = WorkstreamCrudSerializer
    search_fields = ("code", "name", "category", "default_medium", "description")
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param in ("category", "default_medium"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PathViewSet(RegistryViewSet):
    """Cadastros Mestres > Operação > Rotas/Caminhos. Catálogo canônico dos
    tipos de caminho/rota — mesmo padrão de WorkstreamViewSet; filtros
    exatos por grupo e tipo além da busca/is_active herdados de
    RegistryViewSet. Sem relação com CableFamily/Network/scope_connections
    nesta etapa (deliberadamente fora de escopo — ver docstring do model)."""

    queryset = Path.objects.select_related("created_by", "updated_by").order_by("code")
    serializer_class = PathCrudSerializer
    search_fields = ("code", "name", "path_group", "path_type", "description")
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param in ("path_group", "path_type"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class MasterDataSiteViewSet(RegistryViewSet):
    """Cadastros Mestres > Infraestrutura > Sites. Catálogo canônico de
    sites/datacenters (nível mais alto da topologia física) — mesmo padrão
    de PathViewSet; filtros exatos por país/estado/tipo além da busca/
    is_active herdados de RegistryViewSet. Não confundir com
    core.Site (site do Cliente, usado em Cadastros Gerais) — conceitos
    diferentes, convivem sem colidir (tabelas separadas)."""

    queryset = MasterDataSite.objects.select_related("created_by", "updated_by").order_by("code")
    serializer_class = MasterDataSiteCrudSerializer
    search_fields = ("code", "name", "city", "state", "country", "site_type", "description")
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param in ("country", "state", "site_type"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class LocationViewSet(RegistryViewSet):
    """Cadastros Mestres > Infraestrutura > Localizações. Catálogo canônico
    das localizações físicas dentro de um Site — mesmo padrão de
    MasterDataSiteViewSet; filtros exatos por site/tipo/room além da
    busca/is_active herdados de RegistryViewSet."""

    queryset = Location.objects.select_related("site", "created_by", "updated_by").order_by("code")
    serializer_class = LocationCrudSerializer
    search_fields = (
        "code",
        "canonical_address",
        "site__code",
        "site__name",
        "area",
        "room",
        "row",
        "rack",
        "position",
        "ru",
        "description",
    )
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param, field in (("site", "site_id"), ("location_type", "location_type"), ("room", "room")):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class DeviceTypeViewSet(RegistryViewSet):
    """Cadastros Mestres > Infraestrutura > Tipos de Dispositivo. Catálogo
    canônico dos TIPOS de dispositivo/equipamento — mesmo padrão de
    WorkstreamViewSet; filtros exatos por categoria e meio padrão além da
    busca/is_active herdados de RegistryViewSet. Sem relação com Location
    nesta etapa (deliberadamente fora de escopo — ver docstring do model)."""

    queryset = DeviceType.objects.select_related("created_by", "updated_by").order_by("code")
    serializer_class = DeviceTypeCrudSerializer
    search_fields = ("code", "name", "category", "default_medium", "description")
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param in ("category", "default_medium"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class TaskTemplateViewSet(RegistryViewSet):
    """Cadastros Mestres > Operação > Templates de Tarefas. Cabeçalho/
    classificação de receitas de execução padronizadas — mesmo padrão de
    WorkstreamViewSet; filtros exatos por categoria e meio além da busca/
    is_active herdados de RegistryViewSet. Sem relação com CableFamily/
    Network/Workstream/Path/Activity nesta etapa (deliberadamente fora de
    escopo — ver docstring do model). As etapas de cada template são
    TaskTemplateStep (ver TaskTemplateStepViewSet logo abaixo)."""

    queryset = TaskTemplate.objects.select_related("created_by", "updated_by").order_by("code")
    serializer_class = TaskTemplateCrudSerializer
    search_fields = ("code", "name", "category", "medium", "description")
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param in ("category", "medium"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class TaskTemplateStepViewSet(RegistryViewSet):
    """Cadastros Mestres > Operação > Etapas dos Templates. Uma etapa
    (Activity + ordem) dentro da receita de um TaskTemplate — sem `code`
    próprio (não é catálogo, é linha de composição); busca/is_active
    herdados de RegistryViewSet, mais filtros exatos por template/
    atividade/obrigatória/repetível."""

    queryset = TaskTemplateStep.objects.select_related(
        "task_template", "activity", "created_by", "updated_by"
    ).order_by("task_template__code", "step_order")
    serializer_class = TaskTemplateStepCrudSerializer
    search_fields = (
        "activity__code",
        "activity__name",
        "task_template__code",
        "task_template__name",
        "name_override",
        "description",
    )
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param, field in (("task_template", "task_template_id"), ("activity", "activity_id")):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        for param in ("required", "repeatable"):
            value = self.request.query_params.get(param)
            if value is not None:
                queryset = queryset.filter(**{param: value.lower() in ("1", "true", "yes")})
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class TaskTemplateRuleViewSet(RequireViewPermissionForActions, RegistryViewSet):
    """Cadastros Mestres > Operação > Regras de Templates. Determina qual
    TaskTemplate deve ser usado para um item de escopo, a partir de
    critérios opcionais (família de cabo, especificação, rede, workstream,
    meio, pré-terminado) — base do futuro motor de geração automática de
    tarefas (Rules Engine, ainda não implementado). Busca/is_active
    herdados de RegistryViewSet, mais filtros exatos por template/família/
    rede/workstream/meio/pré-terminado. `simulate` (POST, mas só leitura —
    ver RequireViewPermissionForActions) alimenta o Simulador de Regras."""

    view_permission_actions = ("simulate",)

    queryset = TaskTemplateRule.objects.select_related(
        "task_template", "cable_family", "cable_spec", "network", "workstream", "created_by", "updated_by"
    ).order_by("priority", "code")
    serializer_class = TaskTemplateRuleCrudSerializer
    search_fields = (
        "code",
        "name",
        "task_template__code",
        "task_template__name",
        "cable_family__code",
        "cable_family__name",
        "cable_spec__code",
        "cable_spec__part_number",
        "network__code",
        "network__name",
        "workstream__code",
        "workstream__name",
        "description",
    )
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param, field in (
            ("task_template", "task_template_id"),
            ("cable_family", "cable_family_id"),
            ("cable_spec", "cable_spec_id"),
            ("network", "network_id"),
            ("workstream", "workstream_id"),
        ):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        medium = self.request.query_params.get("medium")
        if medium:
            queryset = queryset.filter(medium=medium)
        preterminated = self.request.query_params.get("preterminated")
        if preterminated is not None:
            queryset = queryset.filter(preterminated=preterminated.lower() in ("1", "true", "yes"))
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=["post"], url_path="simulate")
    def simulate(self, request):
        """Cadastros Mestres > Operação > Simulador de Regras. Não cria nem
        altera nenhum registro — só executa
        `master_data.services.task_rule_resolver.simulate_task_template`
        (a lógica de match/ranking vive lá, não aqui) e devolve o
        resultado. Erros de entrada inconsistente (CableSpec x CableFamily)
        viram 400; "nenhuma regra compatível" é um resultado 200 normal
        (matches/selected_rule vazios), não um erro."""
        input_serializer = TaskTemplateRuleSimulateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        try:
            result = simulate_task_template(
                cable_family=data.get("cable_family"),
                cable_spec=data.get("cable_spec"),
                network=data.get("network"),
                workstream=data.get("workstream"),
                medium=data.get("medium") or "",
                preterminated=data.get("preterminated"),
            )
        except TaskRuleResolutionError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(result)


class ScopeItemViewSet(RequireChangePermissionForActions, RegistryViewSet):
    """Planejamento > Itens de Escopo. Representa O QUE O ESCOPO PEDE (não
    O QUE PRECISAMOS FAZER — isso continua sendo Task, numa fase futura)
    — item técnico extraído de um SOW/cutsheet, cadastrado manualmente
    nesta etapa. `resolve-template`/`resolve-all` (POST, mutam estado) só
    gravam o resultado da resolução (resolved_rule/resolved_template/
    rule_resolution_status); NUNCA criam Task nenhuma."""

    change_permission_actions = ("resolve_template", "resolve_all", "generate_tasks", "generate_tasks_bulk")

    queryset = ScopeItem.objects.select_related(
        "cable_family",
        "cable_spec",
        "network",
        "workstream",
        "path",
        "resolved_rule",
        "resolved_template",
        "created_by",
        "updated_by",
    ).order_by("code")
    serializer_class = ScopeItemCrudSerializer
    search_fields = (
        "code",
        "name",
        "raw_text",
        "cable_family__code",
        "cable_family__name",
        "cable_spec__part_number",
        "network__code",
        "workstream__code",
        "resolved_template__code",
    )
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param, field in (
            ("cable_family", "cable_family_id"),
            ("network", "network_id"),
            ("workstream", "workstream_id"),
            ("path", "path_id"),
        ):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        for param in ("item_type", "medium", "rule_resolution_status"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        requires_review = self.request.query_params.get("requires_review")
        if requires_review is not None:
            queryset = queryset.filter(requires_review=requires_review.lower() in ("1", "true", "yes"))
        if self.action == "list":
            queryset = queryset.annotate(
                generated_tasks_exist=models.Exists(GeneratedTask.objects.filter(scope_item=models.OuterRef("pk")))
            )
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="resolve-template")
    def resolve_template(self, request, pk=None):
        """Resolve o item (via apply_resolution_to_scope_item — o mesmo
        motor de match do Simulador de Regras, nada duplicado aqui) e
        grava o resultado. Não cria nenhuma Task."""
        scope_item = self.get_object()
        result = apply_resolution_to_scope_item(scope_item)
        scope_item.updated_by = request.user
        scope_item.save(update_fields=("resolved_rule", "resolved_template", "rule_resolution_status", "updated_by", "updated_at"))
        return Response(result)

    @action(detail=False, methods=["post"], url_path="resolve-all")
    def resolve_all(self, request):
        """Resolve todos os ScopeItems ativos ainda com
        rule_resolution_status=NOT_RESOLVED — mesma lógica de
        `resolve_template`, um item por vez. Não cria nenhuma Task.
        Aceita `?source_reference=` opcional para restringir a uma única
        importação de SOW (usado pela ação "Resolver templates
        pendentes" na tela Importar SOW)."""
        pending = ScopeItem.objects.filter(active=True, rule_resolution_status="NOT_RESOLVED")
        source_reference = request.query_params.get("source_reference")
        if source_reference:
            pending = pending.filter(source_reference=source_reference)
        summary = {"total": pending.count(), "resolved": 0, "no_match": 0, "conflict": 0}
        for scope_item in pending:
            result = apply_resolution_to_scope_item(scope_item)
            scope_item.updated_by = request.user
            scope_item.save(update_fields=("resolved_rule", "resolved_template", "rule_resolution_status", "updated_by", "updated_at"))
            status_key = result["rule_resolution_status"].lower()
            if status_key == "resolved":
                summary["resolved"] += 1
            elif status_key == "no_match":
                summary["no_match"] += 1
            elif status_key == "conflict":
                summary["conflict"] += 1
        return Response(summary)

    @action(detail=True, methods=["post"], url_path="generate-tasks")
    def generate_tasks(self, request, pk=None):
        """Gera GeneratedTasks a partir das TaskTemplateSteps do template já
        resolvido do item (via master_data.services.task_generator — a
        lógica de geração/idempotência vive lá, não aqui). Exige
        rule_resolution_status=RESOLVED; NÃO resolve o template
        automaticamente (o fluxo é sempre Resolver Template -> Gerar
        Tarefas, nunca implícito, para ficar auditável)."""
        scope_item = self.get_object()
        try:
            result = generate_tasks_for_scope_item(scope_item, user=request.user)
        except TaskGenerationError as exc:
            return Response({"detail": str(exc)}, status=400)

        # Gera as dependências SÓ depois de garantir que as tarefas já
        # existem (o dependency_generator lê GeneratedTask do banco, não
        # os objetos recém-criados em memória) — nunca duplica, mesmo
        # motivo de generate_tasks_for_scope_item.
        dependency_result = generate_dependencies_for_scope_item(scope_item)

        created_data = GeneratedTaskCrudSerializer(result["created_tasks"], many=True).data
        existing_data = GeneratedTaskCrudSerializer(result["existing_tasks"], many=True).data
        all_tasks = sorted(
            list(created_data) + list(existing_data), key=lambda t: (t["step_order"], t["expansion_key"])
        )
        created_dependencies_data = GeneratedTaskDependencyCrudSerializer(
            dependency_result["created"], many=True
        ).data
        existing_dependencies_data = GeneratedTaskDependencyCrudSerializer(
            dependency_result["existing"], many=True
        ).data
        return Response(
            {
                "scope_item_id": scope_item.pk,
                "scope_item_code": scope_item.code,
                "resolved_rule_code": scope_item.resolved_rule.code if scope_item.resolved_rule_id else None,
                "resolved_template_code": scope_item.resolved_template.code
                if scope_item.resolved_template_id
                else None,
                "created_count": len(created_data),
                "existing_count": len(existing_data),
                "created_tasks": created_data,
                "existing_tasks": existing_data,
                "tasks": all_tasks,
                "created_dependencies": created_dependencies_data,
                "existing_dependencies": existing_dependencies_data,
                "warnings": result["warnings"],
            }
        )

    @action(detail=False, methods=["post"], url_path="generate-tasks-bulk")
    def generate_tasks_bulk(self, request):
        """Gera tarefas para TODOS os ScopeItems ativos com
        rule_resolution_status=RESOLVED que baterem com o filtro
        informado — hoje só `source_reference` (usado pela ação "Gerar
        tarefas dos itens prontos" na tela Importar SOW, que fecha o
        fluxo SOW -> ScopeItems -> Tarefas Geradas sem o usuário precisar
        abrir item por item). Mesma lógica de geração/idempotência de
        `generate_tasks` (um item de cada vez, via
        master_data.services.task_generator) — nunca duplica, nunca gera
        para item ainda não resolvido."""
        source_reference = request.data.get("source_reference") or request.query_params.get("source_reference")
        candidates = ScopeItem.objects.filter(active=True, rule_resolution_status="RESOLVED")
        if source_reference:
            candidates = candidates.filter(source_reference=source_reference)

        scope_items_processed = 0
        tasks_created = 0
        tasks_existing = 0
        dependencies_created = 0
        dependencies_existing = 0
        errors = []
        for scope_item in candidates:
            try:
                result = generate_tasks_for_scope_item(scope_item, user=request.user)
            except TaskGenerationError as exc:
                errors.append({"scope_item_code": scope_item.code, "detail": str(exc)})
                continue
            dependency_result = generate_dependencies_for_scope_item(scope_item)
            scope_items_processed += 1
            tasks_created += len(result["created_tasks"])
            tasks_existing += len(result["existing_tasks"])
            dependencies_created += len(dependency_result["created"])
            dependencies_existing += len(dependency_result["existing"])

        return Response(
            {
                "scope_items_processed": scope_items_processed,
                "tasks_created": tasks_created,
                "tasks_existing": tasks_existing,
                "dependencies_created": dependencies_created,
                "dependencies_existing": dependencies_existing,
                "errors": errors,
            }
        )


class GeneratedTaskViewSet(RegistryViewSet):
    """Planejamento > Tarefas Geradas. Tarefa operacional concreta gerada a
    partir de um ScopeItem resolvido — O QUE A EQUIPE PRECISA EXECUTAR
    (nunca substitui ScopeItem, que continua representando O QUE O
    PROJETO PEDE). Criação SÓ via
    ScopeItemViewSet.generate_tasks/master_data.services.task_generator
    nesta primeira versão — POST direto neste endpoint é bloqueado (ver
    `create` abaixo); edição é permitida só para os campos que fazem
    sentido revisar depois de gerada (name/quantity/unit/status/
    description/active — o vínculo de rastreabilidade e o snapshot da
    geração são somente leitura, ver GeneratedTaskCrudSerializer)."""

    queryset = GeneratedTask.objects.select_related(
        "scope_item", "task_template", "task_template_step", "activity", "path", "created_by", "updated_by"
    ).order_by("scope_item__code", "step_order", "expansion_key")
    serializer_class = GeneratedTaskCrudSerializer
    search_fields = (
        "code",
        "name",
        "scope_item__code",
        "scope_item__raw_text",
        "activity__code",
        "activity__name",
        "task_template__code",
    )
    active_field = "active"

    def get_queryset(self):
        queryset = super().get_queryset()
        for param, field in (
            ("scope_item", "scope_item_id"),
            ("task_template", "task_template_id"),
            ("activity", "activity_id"),
            ("path", "path_id"),
        ):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        for param in ("status", "generation_source", "expansion_key"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        # Filtra por importação de SOW de origem (via ScopeItem.
        # source_reference) — fecha o link "Abrir Tarefas Geradas desta
        # SOW" a partir da tela Importar SOW, sem precisar de FK direta
        # entre GeneratedTask e SowImport.
        sow_import_code = self.request.query_params.get("sow_import")
        if sow_import_code:
            queryset = queryset.filter(scope_item__source_reference=sow_import_code)
        return queryset

    def create(self, request, *args, **kwargs):
        # Bloqueado de propósito nesta primeira versão — ver docstring da
        # classe: GeneratedTask só é criada via
        # ScopeItemViewSet.generate_tasks (master_data.services.
        # task_generator.generate_tasks_for_scope_item), nunca por POST
        # manual direto neste endpoint.
        return Response(
            {
                "detail": (
                    "Tarefas Geradas só podem ser criadas via "
                    '"Gerar Tarefas" em um Item de Escopo resolvido (POST '
                    ".../scope-items/{id}/generate-tasks/), não diretamente."
                )
            },
            status=405,
        )

    def import_csv(self, request):
        # Mesmo motivo de create() acima — import-csv também criaria
        # registros diretamente, contornando o service de geração.
        return Response(
            {"detail": "Tarefas Geradas não podem ser importadas via CSV — só geradas via template."}, status=405
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class GeneratedTaskDependencyViewSet(viewsets.ReadOnlyModelViewSet):
    """Dependências entre GeneratedTasks — geradas automaticamente por
    master_data.services.task_dependency_generator (chamado a partir de
    ScopeItemViewSet.generate_tasks), nunca criadas/editadas manualmente
    nesta primeira versão: só GET/list/detail, para não arriscar quebrar o
    DAG com um POST irrestrito (ver GeneratedTaskDependency.clean(), que
    já valida auto-dependência e ciclo para quando uma edição
    administrativa for permitida numa fase futura). Usado pela tela de
    Tarefas Geradas para mostrar Predecessoras/Sucessoras de uma tarefa, e
    também para listar todas as dependências de um Item de Escopo."""

    permission_classes = [ViewAwareModelPermissions]
    queryset = GeneratedTaskDependency.objects.select_related("predecessor_task", "successor_task").order_by(
        "predecessor_task__step_order", "successor_task__step_order"
    )
    serializer_class = GeneratedTaskDependencyCrudSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        for param, field in (
            ("predecessor_task", "predecessor_task_id"),
            ("successor_task", "successor_task_id"),
            ("scope_item", "predecessor_task__scope_item_id"),
        ):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset


class SowImportViewSet(RequireChangePermissionForActions, viewsets.ModelViewSet):
    """Planejamento > Importar SOW. Ponto de entrada do módulo de ingestão
    inteligente de escopo (ver docstring de SowImport em
    master_data/models.py): cria o registro (texto colado OU arquivo),
    depois `process`/`reprocess` chamam o parser determinístico + IA
    (master_data.services.sow_parser.service), gerando SowParsedItem
    (preview) — nunca ScopeItem diretamente, nunca GeneratedTask."""

    permission_classes = [ViewAwareModelPermissions]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    queryset = SowImport.objects.select_related("created_by", "updated_by").order_by("-created_at")
    serializer_class = SowImportSerializer
    change_permission_actions = ("process", "reprocess", "approve_selected", "reject_selected", "finalize")

    def get_queryset(self):
        queryset = super().get_queryset()
        status_param = self.request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(models.Q(code__icontains=search) | models.Q(title__icontains=search))
        return queryset

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=["get"])
    def items(self, request, pk=None):
        sow_import = self.get_object()
        items = (
            sow_import.parsed_items.filter(active=True)
            .select_related(
                "suggested_cable_family",
                "suggested_cable_spec",
                "suggested_network",
                "suggested_workstream",
                "approved_scope_item",
                "reviewed_by",
            )
            .prefetch_related("suggested_paths")
            .order_by("sequence")
        )
        serializer = SowParsedItemSerializer(items, many=True, context=self.get_serializer_context())
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def process(self, request, pk=None):
        sow_import = self.get_object()
        try:
            process_sow_import(sow_import)
        except SowProcessingError as exc:
            return Response({"detail": str(exc)}, status=400)
        sow_import.refresh_from_db()
        return Response(self.get_serializer(sow_import).data)

    @action(detail=True, methods=["post"])
    def reprocess(self, request, pk=None):
        sow_import = self.get_object()
        try:
            reprocess_sow_import(sow_import)
        except ReprocessBlockedError as exc:
            return Response({"detail": str(exc)}, status=400)
        sow_import.refresh_from_db()
        return Response(self.get_serializer(sow_import).data)

    @action(detail=True, methods=["post"], url_path="approve-selected")
    def approve_selected(self, request, pk=None):
        sow_import = self.get_object()
        item_ids = list(request.data.get("item_ids") or [])
        if not item_ids:
            return Response({"detail": "Informe ao menos um item em item_ids."}, status=400)
        results = sow_approve_selected(sow_import, item_ids, request.user)
        sow_import.refresh_from_db()
        return Response({**results, "sow_import": self.get_serializer(sow_import).data})

    @action(detail=True, methods=["post"], url_path="reject-selected")
    def reject_selected(self, request, pk=None):
        sow_import = self.get_object()
        item_ids = list(request.data.get("item_ids") or [])
        if not item_ids:
            return Response({"detail": "Informe ao menos um item em item_ids."}, status=400)
        results = sow_reject_selected(sow_import, item_ids, request.user)
        sow_import.refresh_from_db()
        return Response({**results, "sow_import": self.get_serializer(sow_import).data})

    @action(detail=True, methods=["post"])
    def finalize(self, request, pk=None):
        sow_import = self.get_object()
        try:
            finalize_sow_import(sow_import, request.user)
        except FinalizeBlockedError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(self.get_serializer(sow_import).data)

    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        """Resumo operacional desta importação — fecha o fluxo SOW ->
        ScopeItems -> resolução -> Tarefas Geradas numa única chamada,
        pra tela de detalhe não precisar navegar até Itens de Escopo só
        pra saber quantos já foram resolvidos/geraram tarefa. ScopeItems
        e GeneratedTasks são relacionados a esta importação por
        `ScopeItem.source_reference == self.code` (mesmo mecanismo já
        usado por approve_sow_parsed_item)."""
        sow_import = self.get_object()
        scope_items = ScopeItem.objects.filter(source_reference=sow_import.code, active=True)
        scope_items_created = scope_items.count()
        templates_resolved = scope_items.filter(rule_resolution_status="RESOLVED").count()
        items_awaiting_resolution = scope_items.exclude(rule_resolution_status="RESOLVED").count()
        tasks_generated = GeneratedTask.objects.filter(scope_item__source_reference=sow_import.code).count()
        return Response(
            {
                "total_items_detected": sow_import.total_items_detected,
                "total_items_approved": sow_import.total_items_approved,
                "total_items_rejected": sow_import.total_items_rejected,
                "scope_items_created": scope_items_created,
                "templates_resolved": templates_resolved,
                "items_awaiting_resolution": items_awaiting_resolution,
                "tasks_generated": tasks_generated,
            }
        )


class SowParsedItemViewSet(RequireChangePermissionForActions, viewsets.ModelViewSet):
    """Preview revisável de itens extraídos de um SowImport — PATCH permite
    correção manual dos campos sugeridos (nunca `raw_text`); `approve`/
    `reject`/`reprocess` são as únicas ações que mudam `review_status`
    (nunca um PATCH direto, ver SowParsedItemSerializer.validate()).
    Criação direta é bloqueada: só o processamento de um SowImport cria
    SowParsedItem (ver SowImportViewSet.process/reprocess)."""

    permission_classes = [ViewAwareModelPermissions]
    queryset = SowParsedItem.objects.select_related(
        "sow_import",
        "suggested_cable_family",
        "suggested_cable_spec",
        "suggested_network",
        "suggested_workstream",
        "approved_scope_item",
        "reviewed_by",
    ).prefetch_related("suggested_paths").order_by("sow_import", "sequence")
    serializer_class = SowParsedItemSerializer
    change_permission_actions = ("approve", "reject", "reprocess_item")

    def get_queryset(self):
        queryset = super().get_queryset()
        for param, field in (
            ("sow_import", "sow_import_id"),
            ("review_status", "review_status"),
            ("item_type", "item_type"),
        ):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset

    def create(self, request, *args, **kwargs):
        # Bloqueado de propósito — SowParsedItem só é criado pelo
        # processamento de um SowImport (ver docstring da classe).
        return Response(
            {"detail": "Itens extraídos só são criados pelo processamento de uma Importação de SOW."}, status=405
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        item = self.get_object()
        try:
            scope_item = approve_sow_parsed_item(item, request.user)
        except ApprovalBlockedError as exc:
            return Response({"detail": str(exc)}, status=400)
        item.refresh_from_db()
        return Response(
            {
                "scope_item_id": scope_item.pk,
                "scope_item_code": scope_item.code,
                "item": self.get_serializer(item).data,
            }
        )

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        item = self.get_object()
        try:
            reject_sow_parsed_item(item, request.user)
        except ApprovalBlockedError as exc:
            return Response({"detail": str(exc)}, status=400)
        item.refresh_from_db()
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=["post"], url_path="reprocess")
    def reprocess_item(self, request, pk=None):
        item = self.get_object()
        try:
            reprocess_sow_parsed_item(item)
        except ApprovalBlockedError as exc:
            return Response({"detail": str(exc)}, status=400)
        item.refresh_from_db()
        return Response(self.get_serializer(item).data)


class AiStatusView(APIView):
    """GET /api/planning/ai/status/ — só reporta como o provider de IA do
    parser de SOW está CONFIGURADO (env vars), sem nenhuma chamada real ao
    OpenRouter. Nunca retorna a API key."""

    permission_classes = [require_perms("master_data.view_sowimport")]

    def get(self, request):
        return Response(get_ai_config_status())


class AiTestView(APIView):
    """POST /api/planning/ai/test/ — executa UMA chamada mínima real ao
    provider configurado (prompt curto pedindo só `{"ok": true}`), pra
    validar credencial/conectividade sem rodar o pipeline de SOW inteiro.
    Nunca retorna a API key. Retorna 503 (não 200) quando a IA não está
    configurada ou a chamada falha — o corpo sempre traz `success` e,
    quando falha, `error_code`/`detail`."""

    permission_classes = [require_perms("master_data.add_sowimport")]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ai_test"

    def post(self, request):
        ai_parser = get_ai_sow_parser()
        if ai_parser is None:
            return Response(
                {"success": False, "error_code": "OPENROUTER_NOT_CONFIGURED", "detail": "IA não configurada (AI_API_KEY/AI_MODEL ausentes)."},
                status=503,
            )
        try:
            result = ai_parser.test_connection()
        except AiSowParserError as exc:
            return Response({"success": False, "error_code": exc.code, "detail": str(exc)}, status=503)
        return Response(result)


class ProjectPlanView(APIView):
    """GET /api/planning/project-plan/?project=<id>&sow_import=<code>
    (ou &scope_item_ids=1,2,3) — Planejamento > Plano do Projeto: consolida
    uma SOW (ou um conjunto de ScopeItems) dentro de um Projeto, sem criar
    nada — só leitura, pra alimentar o resumo antes da confirmação de
    "Criar tarefas do projeto" (ver ProjectPlanCreateTasksView)."""

    permission_classes = [require_perms("master_data.view_generatedtask")]

    def get(self, request):
        project_id = request.query_params.get("project")
        if not project_id:
            return Response({"detail": "Informe o parâmetro project."}, status=400)
        project = Project.objects.filter(pk=project_id).first()
        if project is None or not user_can_access_project(request.user, project):
            return Response({"detail": "Projeto não encontrado."}, status=404)

        scope_items_qs = ScopeItem.objects.filter(active=True)
        sow_import_code = request.query_params.get("sow_import")
        sow_import_data = None
        if sow_import_code:
            scope_items_qs = scope_items_qs.filter(source_reference=sow_import_code)
            sow_import = SowImport.objects.filter(code=sow_import_code).first()
            if sow_import is not None:
                sow_import_data = {"id": sow_import.pk, "code": sow_import.code, "title": sow_import.title}
        else:
            raw_ids = request.query_params.get("scope_item_ids", "")
            ids = [int(part) for part in raw_ids.split(",") if part.strip().isdigit()]
            if not ids:
                return Response({"detail": "Informe sow_import ou scope_item_ids."}, status=400)
            scope_items_qs = scope_items_qs.filter(pk__in=ids)

        scope_items = list(
            scope_items_qs.select_related("resolved_template").prefetch_related("generated_tasks__path")
        )

        scope_item_rows = []
        paths_involved = set()
        warnings = []
        generated_tasks_total = 0
        project_tasks_existing_total = 0
        scope_items_ready = 0
        scope_items_pending = 0

        for scope_item in scope_items:
            generated_tasks = [gt for gt in scope_item.generated_tasks.all() if gt.active]
            generated_tasks_total += len(generated_tasks)
            existing_count = ProjectTask.objects.filter(project=project, generated_task__in=generated_tasks).count()
            project_tasks_existing_total += existing_count
            for generated_task in generated_tasks:
                if generated_task.path_id:
                    paths_involved.add(generated_task.path.code)
            if scope_item.rule_resolution_status == "RESOLVED":
                scope_items_ready += 1
            else:
                scope_items_pending += 1
            if scope_item.requires_review:
                warnings.append(f"{scope_item.code}: exige revisão.")
            scope_item_rows.append(
                {
                    "id": scope_item.pk,
                    "code": scope_item.code,
                    "raw_text": scope_item.raw_text,
                    "rule_resolution_status": scope_item.rule_resolution_status,
                    "resolved_template_code": scope_item.resolved_template.code
                    if scope_item.resolved_template_id
                    else None,
                    "requires_review": scope_item.requires_review,
                    "generated_tasks_count": len(generated_tasks),
                    "project_tasks_existing_count": existing_count,
                }
            )

        return Response(
            {
                "project": {"id": project.pk, "code": project.code, "name": project.name},
                "sow_import": sow_import_data,
                "scope_items": scope_item_rows,
                "totals": {
                    "scope_items_total": len(scope_items),
                    "scope_items_ready": scope_items_ready,
                    "scope_items_pending_resolution": scope_items_pending,
                    "generated_tasks_total": generated_tasks_total,
                    "project_tasks_to_create": generated_tasks_total - project_tasks_existing_total,
                    "project_tasks_existing": project_tasks_existing_total,
                    "paths_involved": sorted(paths_involved),
                    "warnings": warnings,
                },
            }
        )


class ProjectPlanCreateTasksView(APIView):
    """POST /api/planning/project-plan/create-tasks/ — cria (via
    projects.services.create_project_tasks_from_generated_tasks) uma
    ProjectTask por GeneratedTask ativa dos ScopeItems selecionados (por
    `sow_import` ou `scope_item_ids`) que já têm rule_resolution_status=
    RESOLVED. Idempotente: nunca duplica, nunca sobrescreve uma
    ProjectTask já vinculada a uma GeneratedTask."""

    permission_classes = [require_perms("master_data.view_generatedtask", "projects.add_projecttask")]

    def post(self, request):
        project_id = request.data.get("project")
        if not project_id:
            return Response({"detail": "Informe project."}, status=400)
        project = Project.objects.filter(pk=project_id).first()
        if project is None or not user_can_access_project(request.user, project):
            return Response({"detail": "Projeto não encontrado."}, status=404)

        scope_items_qs = ScopeItem.objects.filter(active=True, rule_resolution_status="RESOLVED")
        sow_import_code = request.data.get("sow_import")
        scope_item_ids = request.data.get("scope_item_ids")
        if sow_import_code:
            scope_items_qs = scope_items_qs.filter(source_reference=sow_import_code)
        elif scope_item_ids:
            scope_items_qs = scope_items_qs.filter(pk__in=scope_item_ids)
        else:
            return Response({"detail": "Informe sow_import ou scope_item_ids."}, status=400)

        generated_tasks = GeneratedTask.objects.filter(
            scope_item__in=scope_items_qs, active=True
        ).select_related("scope_item", "task_template", "activity", "path")
        result = create_project_tasks_from_generated_tasks(project, generated_tasks, user=request.user)
        created_data = ProjectTaskSerializer(result["created"], many=True, context={"request": request}).data
        existing_data = ProjectTaskSerializer(result["existing"], many=True, context={"request": request}).data
        return Response(
            {
                "project_id": project.pk,
                "project_name": project.name,
                "created_count": len(created_data),
                "existing_count": len(existing_data),
                "created_tasks": created_data,
                "existing_tasks": existing_data,
            }
        )


class ProjectTypeViewSet(RegistryViewSet):
    queryset = ProjectType.objects.order_by("name")
    serializer_class = ProjectTypeCrudSerializer
    search_fields = ("name",)

    @action(detail=False, methods=["post"], url_path="bulk-create")
    def bulk_create(self, request):
        names = clean_bulk_names(request.data.get("names"))
        if not names:
            return Response({"detail": "Informe ao menos um nome."}, status=400)
        description = request.data.get("description", "")
        is_active = request.data.get("is_active", True)
        created = 0
        for name in names:
            _, was_created = ProjectType.objects.get_or_create(
                name=name, defaults={"description": description, "is_active": is_active}
            )
            created += int(was_created)
        return Response({"created": created})


class ConsultimerProjectTypeViewSet(RegistryViewSet):
    queryset = ConsultimerProjectType.objects.order_by("name")
    serializer_class = ConsultimerProjectTypeCrudSerializer
    search_fields = ("name", "code")


class JobTitleViewSet(RegistryViewSet):
    queryset = JobTitle.objects.select_related("company").order_by("name")
    serializer_class = JobTitleCrudSerializer
    search_fields = ("name",)


class SiteRegistryViewSet(RequireChangePermissionForActions, RegistryViewSet):
    queryset = Site.objects.select_related("client").order_by("name")
    serializer_class = SiteCrudSerializer
    search_fields = ("name", "code", "city")
    change_permission_actions = ("regeocode", "regeocode_bulk")
    client_scope_mode = "site"

    @action(detail=False, methods=["get"], url_path="map-data")
    def map_data(self, request):
        from projects.models import Project

        sites = self.get_queryset().filter(is_active=True, latitude__isnull=False, longitude__isnull=False)
        active_projects = (
            Project.objects.filter(site__in=sites, status=Project.STATUS_IN_PROGRESS)
            .select_related("client", "site")
            .order_by("name")
        )
        projects_by_site = {}
        for project in active_projects:
            projects_by_site.setdefault(project.site_id, []).append(
                {
                    "id": project.pk,
                    "code": project.code,
                    "name": project.name,
                    "client": str(project.client) if project.client_id else "",
                }
            )
        points = [
            {
                "id": site.pk,
                "name": str(site),
                "client": str(site.client) if site.client_id else "",
                "address": site.full_address,
                "lat": float(site.latitude),
                "lng": float(site.longitude),
                "projects": projects_by_site.get(site.pk, []),
            }
            for site in sites
        ]
        without_coords = (
            self.get_queryset()
            .filter(is_active=True)
            .filter(models.Q(latitude__isnull=True) | models.Q(longitude__isnull=True))
            .count()
        )
        return Response({"points": points, "points_count": len(points), "without_coords": without_coords})

    @action(detail=True, methods=["post"])
    def regeocode(self, request, pk=None):
        site = self.get_object()
        if site.manual_coordinates:
            return Response({"detail": "Este site tem coordenadas manuais e não é regeocodificado automaticamente."}, status=400)
        site.geocoded_address = ""
        site.save()
        site.refresh_from_db()
        return Response(SiteCrudSerializer(site).data)

    @action(detail=False, methods=["post"], url_path="regeocode-bulk")
    def regeocode_bulk(self, request):
        import time

        ids = request.data.get("ids")
        queryset = self.get_queryset()
        queryset = queryset.filter(pk__in=ids) if ids else queryset.filter(is_active=True)
        candidates = list(queryset.exclude(manual_coordinates=True))
        skipped_manual = queryset.filter(manual_coordinates=True).count()
        updated = 0
        failed = 0
        for index, site in enumerate(candidates):
            if index:
                time.sleep(1)
            site.geocoded_address = ""
            site.save()
            site.refresh_from_db()
            if site.latitude is not None and site.longitude is not None:
                updated += 1
            else:
                failed += 1
        return Response({"updated": updated, "failed": failed, "skipped_manual": skipped_manual})


class ClientRegistryViewSet(RegistryViewSet):
    queryset = Client.objects.select_related("company").order_by("legal_name")
    serializer_class = ClientCrudSerializer
    search_fields = ("legal_name", "trade_name", "tax_id")
    client_scope_mode = "client"


class ResponsibleViewSet(RegistryViewSet):
    """Responsáveis unificados (CSTR + Cliente, ver Responsible.kind). Um
    usuário-cliente só enxerga os de kind=client do próprio Cliente — os de
    kind=cstr têm client_id nulo, então o filtro de escopo já os exclui
    automaticamente (client_id__in nunca casa com NULL)."""

    queryset = Responsible.objects.select_related("client", "person", "person__company").order_by("person__name")
    serializer_class = ResponsibleCrudSerializer
    search_fields = ("person__name", "person__email")
    client_scope_mode = "client"
    client_scope_field = "client_id"

    def get_queryset(self):
        queryset = super().get_queryset()
        kind = self.request.query_params.get("kind")
        if kind:
            queryset = queryset.filter(kind=kind)
        client_id = self.request.query_params.get("client")
        if client_id:
            queryset = queryset.filter(client_id=client_id)
        return queryset


class CollaboratorRegistryViewSet(RegistryViewSet):
    queryset = Collaborator.objects.select_related("person", "person__company", "job_title", "manager").order_by("person__name")
    serializer_class = CollaboratorCrudSerializer
    search_fields = ("person__name", "registration", "yellow_badge")

    def get_queryset(self):
        # Supervisor só enxerga os colaboradores sob a sua gestão.
        return scope_collaborators(super().get_queryset(), self.request.user)


class TaskViewSet(RegistryViewSet):
    queryset = Task.objects.prefetch_related("project_types").order_by("name")
    serializer_class = TaskCrudSerializer
    search_fields = ("name", "code")

    @action(detail=False, methods=["post"], url_path="bulk-create")
    def bulk_create(self, request):
        names = clean_bulk_names(request.data.get("names"))
        if not names:
            return Response({"detail": "Informe ao menos um nome."}, status=400)
        description = request.data.get("description", "")
        estimated_hours = request.data.get("estimated_hours") or None
        is_active = request.data.get("is_active", True)
        project_types = ProjectType.objects.filter(pk__in=request.data.get("project_types") or [])
        created = 0
        for name in names:
            task = Task.objects.create(
                name=name, description=description, estimated_hours=estimated_hours, is_active=is_active
            )
            task.project_types.set(project_types)
            created += 1
        return Response({"created": created})


class DailyUpdateViewSet(RequireChangePermissionForActions, viewsets.ModelViewSet):
    queryset = (
        DailyUpdate.objects.select_related("created_by")
        .prefetch_related("allocations__project", "allocations__collaborators")
        .order_by("-allocation_date", "-created_at")
    )
    serializer_class = DailyUpdateSerializer
    permission_classes = [ViewAwareModelPermissions]
    change_permission_actions = ("send_email", "pdf", "pdf_consolidado")

    def get_queryset(self):
        from django.utils.dateparse import parse_date
        from rest_framework.exceptions import ValidationError

        queryset = super().get_queryset()
        date_param = self.request.query_params.get("date")
        if date_param:
            queryset = queryset.filter(allocation_date=date_param)
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from and date_to:
            start, end = parse_date(date_from), parse_date(date_to)
            if not start or not end:
                raise ValidationError("date_from/date_to inválidos.")
            if (end - start).days > 6:
                raise ValidationError("O período selecionado não pode ultrapassar 7 dias.")
            queryset = queryset.filter(allocation_date__gte=start, allocation_date__lte=end)
        elif date_from:
            queryset = queryset.filter(allocation_date__gte=date_from)
        elif date_to:
            queryset = queryset.filter(allocation_date__lte=date_to)
        return deny_if_client_scoped(queryset, self.request.user)

    @action(detail=True, methods=["post"], url_path="send-email")
    def send_email(self, request, pk=None):
        daily_update = self.get_object()
        sent, skipped = send_daily_update_emails(daily_update, lang=request.data.get("language"))
        return Response({"sent": sent, "skipped": skipped})

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        daily_update = self.get_object()
        pdf_buffer = build_daily_updates_pdf([daily_update], daily_update.allocation_date)
        filename = f"atualizacao-diaria-{daily_update.allocation_date:%Y-%m-%d}.pdf"
        return FileResponse(pdf_buffer, content_type="application/pdf", filename=filename)

    @action(detail=False, methods=["get"], url_path="pdf-consolidado")
    def pdf_consolidado(self, request):
        from django.utils.dateparse import parse_date as parse_date_str

        allocation_date = parse_date_str(request.query_params.get("date", ""))
        if not allocation_date:
            return Response({"detail": "Informe uma data válida (?date=AAAA-MM-DD) para gerar o PDF."}, status=400)
        updates = (
            DailyUpdate.objects.filter(allocation_date=allocation_date)
            .select_related("created_by")
            .prefetch_related("allocations__project__site", "allocations__collaborators")
        )
        if not updates.exists():
            return Response({"detail": "Não existem Atualizações Diárias para a data selecionada."}, status=404)
        filename = f"atualizacao-diaria-{allocation_date:%Y-%m-%d}.pdf"
        return FileResponse(build_daily_updates_pdf(updates, allocation_date), content_type="application/pdf", filename=filename)


class ProjectDailyUpdateViewSet(RequireChangePermissionForActions, viewsets.ModelViewSet):
    queryset = (
        ProjectDailyUpdate.objects.select_related("project", "project__client", "created_by")
        .prefetch_related("collaborators")
        .order_by("-date", "-created_at")
    )
    permission_classes = [ViewAwareModelPermissions]
    change_permission_actions = ("send_email", "send_weekly", "pdf")

    def get_serializer_class(self):
        if self.action == "create":
            return ProjectDailyUpdateCreateSerializer
        return ProjectDailyUpdateSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        queryset = scope_project_queryset(queryset, self.request.user, field_prefix="project__")
        return scope_supervisor_projects(queryset, self.request.user, field_prefix="project__")

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        instance = ProjectDailyUpdate.objects.get(pk=response.data["id"])
        response.data = ProjectDailyUpdateSerializer(instance).data
        return response

    @staticmethod
    def _extra_recipients(request):
        """Usuários do sistema e e-mails avulsos escolhidos na tela -> ([(nome, e-mail)], inválidos)."""
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.core.validators import validate_email

        from users.models import User

        extra = []
        user_ids = request.data.get("user_ids") or []
        for extra_user in User.objects.filter(pk__in=user_ids, is_active=True).exclude(email=""):
            extra.append((extra_user.get_full_name() or extra_user.username, extra_user.email))

        invalid_emails = []
        for raw in request.data.get("emails") or []:
            candidate = (raw or "").strip()
            if not candidate:
                continue
            try:
                validate_email(candidate)
            except DjangoValidationError:
                invalid_emails.append(candidate)
                continue
            extra.append((candidate, candidate))
        return extra, invalid_emails

    @action(detail=True, methods=["post"], url_path="send-email")
    def send_email(self, request, pk=None):
        project_update = self.get_object()

        extra, invalid_emails = self._extra_recipients(request)
        if invalid_emails:
            return Response({"detail": f"E-mail(s) inválido(s): {', '.join(invalid_emails)}"}, status=400)

        if not project_update.project.client_id and not extra:
            return Response({"detail": "O projeto não possui cliente vinculado."}, status=400)

        sent, skipped = send_project_daily_update_email(project_update, extra_recipients=extra, lang=request.data.get("language"))
        return Response({"sent": sent, "skipped": skipped})

    @action(detail=False, methods=["post"], url_path="send-weekly")
    def send_weekly(self, request):
        """Update Semanal: um e-mail com um bloco por projeto. Para cada projeto usa a
        atualização mais recente da semana (start..end) ou cria uma na data final
        (limitada a hoje) se ainda não existir."""
        from datetime import date as date_cls

        project_ids = request.data.get("project_ids") or []
        try:
            start = date_cls.fromisoformat(str(request.data.get("start") or ""))
            end = date_cls.fromisoformat(str(request.data.get("end") or ""))
        except ValueError:
            return Response({"detail": "Informe o período (início e fim)."}, status=400)
        if end < start or (end - start).days > 31:
            return Response({"detail": "Período inválido."}, status=400)
        if not project_ids:
            return Response({"detail": "Selecione ao menos um projeto."}, status=400)

        extra, invalid_emails = self._extra_recipients(request)
        if invalid_emails:
            return Response({"detail": f"E-mail(s) inválido(s): {', '.join(invalid_emails)}"}, status=400)

        projects = scope_supervisor_projects(
            scope_project_queryset(Project.objects.filter(pk__in=project_ids), request.user), request.user
        ).select_related("client", "site", "responsible_client__person", "responsible_cstr__person")
        projects = sorted(projects, key=lambda p: p.name.lower())
        if not projects:
            return Response({"detail": "Nenhum projeto encontrado."}, status=400)

        no_client = [p.name for p in projects if not p.client_id]
        if no_client and not extra:
            return Response({"detail": f"Projeto(s) sem cliente vinculado: {', '.join(no_client)}"}, status=400)

        reference_day = min(end, timezone.localdate())
        updates = []
        for project in projects:
            update = (
                ProjectDailyUpdate.objects.filter(project=project, date__range=(start, end))
                .select_related("project", "project__client", "project__site")
                .order_by("-date", "-created_at")
                .first()
            )
            if update is None:
                update = ProjectDailyUpdate.objects.create(project=project, date=reference_day, created_by=request.user)
            updates.append(update)

        sent, skipped = send_weekly_update_email(updates, start, end, extra_recipients=extra, lang=request.data.get("language"))
        return Response({"sent": sent, "skipped": skipped, "projects": len(updates)})

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        project_update = self.get_object()
        pdf_buffer = build_project_daily_update_pdf(project_update)
        filename = f"atualizacao-projeto-{project_update.project.code or project_update.project_id}-{project_update.date:%Y-%m-%d}.pdf"
        return FileResponse(pdf_buffer, content_type="application/pdf", filename=filename)


class MyTaskViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Módulo Técnico > Minhas Tarefas: cada usuário só vê e só pode
    atualizar as ProjectTask em que o Colaborador vinculado a ele está
    entre os responsáveis. Usa permissões próprias (technical.view_mytask
    / technical.change_mytask), separadas das permissões gerais de
    projects.ProjectTask.
    """

    queryset = MyTask.objects.select_related(
        "task", "project", "generated_task__activity", "generated_task__path", "generated_task__scope_item", "generated_task__task_template"
    ).prefetch_related("collaborators__person", "rack_positions", "assignments")
    permission_classes = [ViewAwareModelPermissions]

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return MyTaskUpdateSerializer
        return MyTaskSerializer

    def get_queryset(self):
        collaborator = get_collaborator_role(self.request.user)
        if collaborator is None:
            return self.queryset.none()
        return self.queryset.filter(collaborators=collaborator).order_by("planned_start", "order", "id")

    def update(self, request, *args, **kwargs):
        """Andamento do PRÓPRIO técnico: iniciar, pausar, concluir e registrar
        resultado/quantidade gravam no despacho dele (ProjectTaskAssignment). A
        tarefa só muda de status agregado quando os técnicos mudam (ver
        ProjectTask.sync_from_assignments). Horas são sempre do relógio do
        servidor — datas enviadas pelo dispositivo são ignoradas."""
        collaborator = get_collaborator_role(request.user)
        if collaborator is None:
            return Response({"detail": "Usuário sem Técnico vinculado."}, status=403)
        task = self.get_object()
        assignment = task.assignments.filter(collaborator=collaborator).first()
        if assignment is None:
            return Response({"detail": "Esta tarefa não está despachada para você."}, status=404)

        serializer = MyTaskUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        now = timezone.now()

        new_status = data.get("status")
        if new_status and new_status != assignment.status:
            error = self._apply_transition(assignment, new_status, now)
            if error:
                return Response({"detail": error}, status=400)
        if "completion_outcome" in data:
            assignment.completion_outcome = data["completion_outcome"]
        if "quantity_done" in data:
            assignment.quantity_done = data["quantity_done"]
        assignment.save()

        if "notes" in data:
            task.notes = data["notes"]
            task.save(update_fields=["notes", "updated_at"])
        task.sync_from_assignments()

        if new_status:
            self._sync_presence_with_assignment(collaborator, assignment.status)

        instance = self.get_object()
        return Response(MyTaskSerializer(instance, context=self.get_serializer_context()).data)

    @staticmethod
    def _apply_transition(assignment, new_status, now):
        """Aplica a transição de status ao assignment do técnico. Devolve a
        mensagem de erro quando a transição não é permitida."""
        previous = assignment.status
        if new_status == ProjectTask.STATUS_IN_PROGRESS:
            if previous not in (ProjectTask.STATUS_NOT_STARTED, ProjectTask.STATUS_PAUSED):
                return "Não é possível iniciar uma tarefa neste status."
            assignment.record_start(now)
        elif new_status == ProjectTask.STATUS_PAUSED:
            if previous != ProjectTask.STATUS_IN_PROGRESS:
                return "Só é possível pausar uma tarefa em andamento."
            assignment.record_pause(now)
        elif new_status == ProjectTask.STATUS_COMPLETED:
            if previous not in (ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED):
                return "Só é possível concluir uma tarefa em andamento."
            assignment.record_complete(now)
        else:
            return "Status inválido para o técnico."
        assignment.status = new_status
        return None

    def _sync_presence_with_assignment(self, collaborator, assignment_status):
        """Iniciar uma atividade põe o técnico automaticamente 'Em Execução';
        pausar ou finalizar sem ter outra em execução volta pra 'Disponível'
        — o técnico não precisa mexer no dropdown de status pra isso. Olha só
        os despachos DELE: a tarefa de um colega não muda a presença."""
        if assignment_status == ProjectTask.STATUS_IN_PROGRESS:
            new_status = TechnicianDailyPresence.STATUS_IN_PROGRESS
        elif assignment_status in (ProjectTask.STATUS_PAUSED, ProjectTask.STATUS_COMPLETED):
            # Só sai de "Em Execução" (e só sem outra tarefa rodando): um status que
            # o técnico escolheu (Café, Almoço, Fim de Expediente...) não é atropelado.
            release_stuck_execution(collaborator.pk)
            return
        else:
            return

        presence, _ = TechnicianDailyPresence.objects.get_or_create(
            collaborator=collaborator, date=timezone.localdate()
        )
        if presence.status == new_status:
            return
        now = timezone.now()
        presence.status = new_status
        presence.checked_in_at = presence.checked_in_at or now
        presence.checked_out_at = None
        presence.save(update_fields=("status", "checked_in_at", "checked_out_at", "updated_at"))
        TechnicianStatusEvent.objects.create(
            collaborator=collaborator, date=presence.date, status=new_status, changed_at=now
        )


class TechnicianPresenceViewSet(viewsets.GenericViewSet):
    """Módulo Técnico > presença do dia: o próprio técnico marca 'cheguei no
    site' / 'encerrar expediente'. Um registro por (técnico, dia) — ver
    dispatch.models.TechnicianDailyPresence."""

    queryset = TechnicianDailyPresence.objects.none()
    serializer_class = TechnicianDailyPresenceSerializer
    permission_classes = [ViewAwareModelPermissions]

    def _get_or_create_today(self, request):
        collaborator = get_collaborator_role(request.user)
        if collaborator is None:
            return None
        presence, _ = TechnicianDailyPresence.objects.get_or_create(
            collaborator=collaborator, date=timezone.localdate()
        )
        return presence

    def get_queryset(self):
        collaborator = get_collaborator_role(self.request.user)
        if collaborator is None:
            return TechnicianDailyPresence.objects.none()
        return TechnicianDailyPresence.objects.filter(collaborator=collaborator)

    @action(detail=False, methods=["get"])
    def me(self, request):
        presence = self._get_or_create_today(request)
        if presence is None:
            return Response({"detail": "Usuário sem Técnico vinculado."}, status=404)
        # Cura registros que já ficaram presos em "Em Execução" sem tarefa rodando.
        if release_stuck_execution(presence.collaborator_id):
            presence.refresh_from_db()
        return Response(TechnicianDailyPresenceSerializer(presence).data)

    @action(detail=False, methods=["post"], url_path="check-in")
    def check_in(self, request):
        """Mantido por compatibilidade — equivale a set_status com
        status=available (o primeiro 'Disponível' do dia já é o check-in)."""
        return self._apply_status(request, TechnicianDailyPresence.STATUS_AVAILABLE)

    @action(detail=False, methods=["post"], url_path="check-out")
    def check_out(self, request):
        """Mantido por compatibilidade — equivale a set_status com status=off_duty."""
        return self._apply_status(request, TechnicianDailyPresence.STATUS_OFF_DUTY)

    @action(detail=False, methods=["post"], url_path="set-status")
    def set_status(self, request):
        """O técnico escolhe livremente entre Disponível / Almoço / Particular
        / Fim de Expediente. O primeiro status selecionado no dia (qualquer
        um deles) já funciona como o check-in — não existe mais um botão de
        'cheguei no site' separado."""
        status_value = request.data.get("status")
        if status_value not in TechnicianDailyPresence.SELECTABLE_STATUSES:
            return Response({"detail": "Status inválido."}, status=400)
        return self._apply_status(request, status_value)

    def _apply_status(self, request, status_value):
        presence = self._get_or_create_today(request)
        if presence is None:
            return Response({"detail": "Usuário sem Técnico vinculado."}, status=404)
        now = timezone.now()
        presence.status = status_value
        if status_value == TechnicianDailyPresence.STATUS_OFF_DUTY:
            presence.checked_out_at = now
        else:
            presence.checked_in_at = presence.checked_in_at or now
            presence.checked_out_at = None
        presence.save(update_fields=("status", "checked_in_at", "checked_out_at", "updated_at"))
        TechnicianStatusEvent.objects.create(
            collaborator=presence.collaborator, date=presence.date, status=status_value, changed_at=now
        )
        # O status é livre, mas qualquer escolha do técnico tira ele da execução:
        # as tarefas dele em andamento são pausadas (o tempo fora não conta como
        # trabalhado). Retomar é manual, pelo botão Iniciar da tarefa.
        self._pause_active_tasks(presence.collaborator, now)
        return Response(TechnicianDailyPresenceSerializer(presence).data)

    def _pause_active_tasks(self, collaborator, now):
        """Pausa as tarefas EM ANDAMENTO deste técnico (só o despacho dele — os
        colegas da mesma tarefa continuam trabalhando). Chamado quando o técnico
        escolhe um status no dropdown, para que o período fora não conte como
        horas trabalhadas."""
        active = collaborator.task_assignments.select_related("project_task").filter(
            status=ProjectTask.STATUS_IN_PROGRESS
        )
        for assignment in active:
            assignment.record_pause(now)
            assignment.status = ProjectTask.STATUS_PAUSED
            assignment.save(update_fields=["status", "paused_at", "updated_at"])
            assignment.project_task.sync_from_assignments()


class TechnicianAbsenceViewSet(viewsets.ModelViewSet):
    """Ausências planejadas (férias, atestado, folga) cadastradas por um
    administrador — ver dispatch.models.TechnicianAbsence. Diferente de
    TechnicianPresenceViewSet (self-service, só o dia de hoje, o próprio
    técnico), aqui quem cadastra é a operação, com antecedência, pra
    qualquer técnico e período."""

    queryset = TechnicianAbsence.objects.select_related("collaborator__person").order_by("-date_from")
    serializer_class = TechnicianAbsenceSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        queryset = scope_collaborators(super().get_queryset(), self.request.user, field="collaborator_id")
        collaborator_id = self.request.query_params.get("collaborator")
        if collaborator_id:
            queryset = queryset.filter(collaborator_id=collaborator_id)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Log de Auditoria: somente leitura e restrito a superusuário — mesmo
    comportamento do Django Admin (AuditLogAdmin), onde nenhum grupo de
    permissões dá acesso e nenhum registro é editável."""

    queryset = AuditLog.objects.select_related("actor").order_by("-created_at", "-id")
    serializer_class = AuditLogSerializer
    permission_classes = [IsSuperUser]

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        for field, param in (("action", "action"), ("app_label", "app_label"), ("model_name", "model_name")):
            value = params.get(param)
            if value:
                # aceita um valor ou vários separados por vírgula
                queryset = queryset.filter(**{f"{field}__in": [v.strip() for v in value.split(",") if v.strip()]})
        date_from = params.get("date_from")
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        date_to = params.get("date_to")
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        search = params.get("search")
        if search:
            queryset = queryset.filter(
                models.Q(object_repr__icontains=search)
                | models.Q(actor__username__icontains=search)
                | models.Q(actor__email__icontains=search)
            )
        return queryset


class PasswordResetRequestView(APIView):
    """Solicita reset de senha: envia e-mail com link de redefinição."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        import secrets

        from django.contrib.auth.tokens import default_token_generator
        from django.conf import settings
        from django.core.mail import get_connection
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        from core.emailing import branded_subject, build_email, render_html
        from users.models import User

        email = (request.data.get("email") or "").strip().lower()
        if not email:
            return Response({"detail": "Informe o e-mail."}, status=400)

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            # Resposta idêntica para não vazar existência de e-mails
            return Response({"detail": "Se o e-mail estiver cadastrado, você receberá as instruções em breve."})

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        # A página de redefinição é do frontend, que fica em outro host que a API:
        # usa FRONTEND_URL ou o Origin da requisição (só se estiver em CORS_ALLOWED_ORIGINS).
        origin = (request.headers.get("Origin") or "").rstrip("/")
        frontend_url = (
            settings.FRONTEND_URL
            or (origin if origin in settings.CORS_ALLOWED_ORIGINS else "")
            or request.build_absolute_uri("/").rstrip("/")
        )
        reset_link = f"{frontend_url}/redefinir-senha/{uid}/{token}/"

        name = user.get_full_name() or user.username
        nl = chr(10)
        expiry_note = "This link expires in 24 hours. If you did not request this, you can safely ignore this email."
        text = nl.join(
            [
                f"Hello, {name}!",
                "",
                "We received a request to reset the password for your account.",
                "Use the link below to choose a new password:",
                reset_link,
                "",
                expiry_note,
                "",
                "Consultimer",
            ]
        )
        html = render_html(
            title="Reset your password",
            intro=f"Hello, {name}! We received a request to reset the password for your account.",
            button=("Reset password", reset_link),
            note=expiry_note,
            lang="en",
        )
        build_email(
            subject=branded_subject("Password reset"),
            to=[user.email],
            text=text,
            html=html,
            from_email=settings.AUTH_FROM_EMAIL,
            connection=get_connection(
                host=settings.AUTH_EMAIL_HOST,
                port=settings.AUTH_EMAIL_PORT,
                username=settings.AUTH_EMAIL_HOST_USER,
                password=settings.AUTH_EMAIL_HOST_PASSWORD,
                use_tls=settings.AUTH_EMAIL_USE_TLS,
            ),
        ).send(fail_silently=False)
        return Response({"detail": "Se o e-mail estiver cadastrado, você receberá as instruções em breve."})


class PasswordResetConfirmView(APIView):
    """Confirma reset de senha com uid/token e define nova senha."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        from django.contrib.auth.tokens import default_token_generator
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.utils.encoding import force_str
        from django.utils.http import urlsafe_base64_decode

        from users.models import User

        uid = request.data.get("uid") or ""
        token = request.data.get("token") or ""
        new_password = request.data.get("new_password") or ""

        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_id)
        except Exception:
            return Response({"detail": "Link inválido ou expirado."}, status=400)

        if not default_token_generator.check_token(user, token):
            return Response({"detail": "Link inválido ou expirado."}, status=400)

        if not new_password:
            return Response({"detail": "Informe a nova senha."}, status=400)

        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as exc:
            return Response({"detail": " ".join(exc.messages)}, status=400)

        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        return Response({"detail": "Senha redefinida com sucesso."})
        return queryset


class CableImportViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    """Cadastros Mestres > Fluxo Guiado de Cabos. Cria a importação a partir
    de texto (um modelo por linha), gera os rascunhos com conflitos e só grava
    na finalização (ver master_data.services.cable_import). Não há update nem
    delete: o histórico da importação é preservado."""

    permission_classes = [CableImportPermission]
    queryset = CableImport.objects.prefetch_related("items").order_by("-created_at")
    serializer_class = CableImportSerializer

    def create(self, request, *args, **kwargs):
        source_text = request.data.get("source_text") or ""
        if not str(source_text).strip():
            return Response({"detail": "Cole o texto com os modelos de cabo."}, status=drf_status.HTTP_400_BAD_REQUEST)
        cable_import = create_cable_import(
            text=str(source_text),
            title=request.data.get("title") or "",
            user=request.user,
        )
        cable_import = self.get_queryset().get(pk=cable_import.pk)
        return Response(self.get_serializer(cable_import).data, status=drf_status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def finalize(self, request, pk=None):
        cable_import = self.get_object()
        try:
            finalize_cable_import(cable_import, request.user)
        except CableImportError as exc:
            return Response(
                {"detail": str(exc), "blocked": exc.details},
                status=drf_status.HTTP_400_BAD_REQUEST,
            )
        cable_import = self.get_queryset().get(pk=cable_import.pk)
        return Response(self.get_serializer(cable_import).data)


class CableImportItemViewSet(mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Revisão dos itens do fluxo guiado de cabos: edição do cadastro (payload),
    aprovação e rejeição. Itens já gravados (CREATED) não podem mudar."""

    permission_classes = [CableImportPermission]
    queryset = CableImportItem.objects.select_related("cable_import").order_by("cable_import_id", "line_number", "pk")
    serializer_class = CableImportItemSerializer
    http_method_names = ["patch", "post", "head", "options"]

    def _ensure_editable(self, item):
        if item.status == CableImportItem.STATUS_CREATED:
            return Response(
                {"detail": "Este item já foi cadastrado e não pode ser alterado."},
                status=drf_status.HTTP_400_BAD_REQUEST,
            )
        return None

    def partial_update(self, request, *args, **kwargs):
        item = self.get_object()
        blocked = self._ensure_editable(item)
        if blocked is not None:
            return blocked
        serializer = self.get_serializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        item.payload = serializer.validated_data["payload"] if "payload" in serializer.validated_data else item.payload
        item.updated_by = request.user
        if item.status in (CableImportItem.STATUS_APPROVED, CableImportItem.STATUS_REJECTED):
            item.status = CableImportItem.STATUS_PENDING
        item.save(update_fields=("payload", "status", "updated_by", "updated_at"))
        recompute_item_conflicts(item)
        return Response(self.get_serializer(item).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        item = self.get_object()
        blocked = self._ensure_editable(item)
        if blocked is not None:
            return blocked
        recompute_item_conflicts(item)
        if item.conflicts:
            return Response(
                {"detail": "Este item tem conflitos. Corrija os dados ou rejeite o item.", "conflicts": item.conflicts},
                status=drf_status.HTTP_400_BAD_REQUEST,
            )
        item.status = CableImportItem.STATUS_APPROVED
        item.updated_by = request.user
        item.save(update_fields=("status", "updated_by", "updated_at"))
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        item = self.get_object()
        blocked = self._ensure_editable(item)
        if blocked is not None:
            return blocked
        item.status = CableImportItem.STATUS_REJECTED
        item.updated_by = request.user
        item.save(update_fields=("status", "updated_by", "updated_at"))
        return Response(self.get_serializer(item).data)


class CableWizardOptionsView(APIView):
    """GET /api/master-data/cable-wizard/options/ — valores dos seletores do
    passo a passo (conectores, nº de fibras, tipos de fibra etc.)."""

    permission_classes = [CableWizardPermission]

    def get(self, request):
        return Response(cable_wizard_options())


class CableWizardPreviewView(APIView):
    """POST /api/master-data/cable-wizard/preview/ — gera código e nome,
    aponta família equivalente já existente, sugere aliases e mostra
    conflitos. Não grava nada."""

    permission_classes = [CableWizardPermission]
    wizard_action = "preview"

    def post(self, request):
        try:
            return Response(build_cable_wizard_preview(request.data))
        except CableWizardError as exc:
            return Response({"detail": str(exc), "errors": exc.errors}, status=drf_status.HTTP_400_BAD_REQUEST)


class CableWizardCreateView(APIView):
    """POST /api/master-data/cable-wizard/ — cadastra família (ou reaproveita a
    equivalente), aliases e especificação, tudo em uma transação. Código e nome
    são sempre os gerados pelo servidor."""

    permission_classes = [CableWizardPermission]
    wizard_action = "create"

    def post(self, request):
        try:
            result = create_cable_wizard(request.data, request.user)
        except CableWizardError as exc:
            return Response({"detail": str(exc), "errors": exc.errors}, status=drf_status.HTTP_400_BAD_REQUEST)
        return Response(result, status=drf_status.HTTP_201_CREATED)

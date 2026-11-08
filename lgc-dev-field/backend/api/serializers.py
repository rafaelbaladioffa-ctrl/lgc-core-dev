from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from audit.models import AuditLog
from core.access_scope import get_scope_for_user, scope_related_queryset
from core.models import (
    Category,
    Client,
    Collaborator,
    Company,
    JobTitle,
    Notification,
    ConsultimerProjectType,
    ProjectType,
    Region,
    Responsible,
    Site,
    Task,
    get_collaborator_role,
    get_or_create_person,
    update_person,
)
from dispatch.models import TechnicianAbsence, TechnicianDailyPresence, TechnicianStatusEvent
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
    ScopeItemPath,
    SowImport,
    SowParsedItem,
    TaskTemplate,
    TaskTemplateRule,
    TaskTemplateStep,
    Workstream,
    normalize_alias_text,
)
from master_data.models import Site as MasterDataSite
from master_data.services.sow_parser.service import UnsupportedSourceTypeError, extract_text_from_file
from projects.models import Project, ProjectAttachment, ProjectOccurrence, ProjectTask, RackPosition, merged_worked_hours
from updates.models import DailyUpdate, DailyUpdateAllocation, ProjectDailyUpdate
from updates.project_client_mail import build_project_update_body



class ClientScopedRelationsMixin:
    """Limita os IDs aceitos em campos de relação graváveis ao escopo do
    usuário-cliente — sem isso, quem só lê dentro do escopo poderia gravar
    registros apontando para projetos/clientes/sites de terceiros."""

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if request is None or get_scope_for_user(user) is None:
            return fields
        for field in fields.values():
            relation = field.child_relation if isinstance(field, serializers.ManyRelatedField) else field
            if isinstance(relation, serializers.RelatedField) and not relation.read_only and relation.queryset is not None:
                relation.queryset = scope_related_queryset(relation.queryset, user)
        return fields

class ClientSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = ("id", "name", "tax_id", "email", "phone")

    def get_name(self, obj):
        return str(obj)


class RegionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Region
        fields = ("id", "code", "name", "country", "country_display")

    country_display = serializers.CharField(source="get_country_display", read_only=True)


class SiteSerializer(serializers.ModelSerializer):
    region_name = serializers.CharField(source="region.name", read_only=True, default=None)
    region_code = serializers.CharField(source="region.code", read_only=True, default=None)
    country = serializers.CharField(source="region.country", read_only=True, default=None)

    class Meta:
        model = Site
        fields = ("id", "name", "code", "city", "state", "region", "region_name", "region_code", "country")


def _get_or_create_person(*, name="", email="", phone="", company=None):
    return get_or_create_person(name=name, email=email, phone=phone, company=company)


def _update_person_from_data(instance, person_data):
    if not person_data:
        return
    update_person(instance.person, **person_data)


class CollaboratorSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="person.name", read_only=True)
    email = serializers.EmailField(source="person.email", read_only=True)

    class Meta:
        model = Collaborator
        fields = ("id", "name", "registration", "email", "is_active")


class CollaboratorSummarySerializer(serializers.ModelSerializer):
    """Técnico embutido em tarefas/atualizações, que clientes também leem:
    sem e-mail nem matrícula (dados internos)."""

    name = serializers.CharField(source="person.name", read_only=True)

    class Meta:
        model = Collaborator
        fields = ("id", "name", "is_active")


# ---------------------------------------------------------------------------
# Cadastros Gerais (CRUD completo usado pelo módulo Cadastros do frontend)
# ---------------------------------------------------------------------------


class CompanyCrudSerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ("id", "legal_name", "trade_name", "tax_id", "email", "phone", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class CategoryCrudSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "description", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class CableFamilyCrudSerializer(serializers.ModelSerializer):
    # Declarado explicitamente (em vez de deixar o DRF gerar sozinho a
    # partir do model) para forçar "obrigatório" na API mesmo o campo
    # tendo um default no model — o default existe só como rede de
    # segurança no banco, não deve permitir omitir o meio na criação.
    medium = serializers.ChoiceField(choices=CableFamily.MEDIUM_CHOICES)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CableFamily
        fields = (
            "id",
            "code",
            "name",
            "medium",
            "fiber_count",
            "connector_a",
            "connector_b",
            "cable_category",
            "preterminated",
            "work_group",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class CableAliasCrudSerializer(serializers.ModelSerializer):
    # Só leitura: calculado a partir de `alias` no model (clean()/save()),
    # nunca recebido do cliente — evita que a API deixe o front enviar um
    # valor de normalização divergente do que o backend realmente vai usar
    # para checar duplicidade.
    normalized_alias = serializers.CharField(read_only=True)
    cable_family_code = serializers.CharField(source="cable_family.code", read_only=True)
    cable_family_name = serializers.CharField(source="cable_family.name", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CableAlias
        fields = (
            "id",
            "cable_family",
            "cable_family_code",
            "cable_family_name",
            "alias",
            "normalized_alias",
            "alias_type",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None

    def validate(self, attrs):
        # A unicidade de fato é do valor NORMALIZADO (o unique=True do model
        # já protege no banco) — validado aqui explicitamente para devolver
        # um erro de formulário legível em vez de deixar estourar um
        # IntegrityError 500 (mesmo espírito de "detectar conflito e não
        # aceitar silenciosamente" pedido para esta entidade).
        alias = attrs.get("alias", getattr(self.instance, "alias", None))
        if alias:
            normalized = normalize_alias_text(alias)
            conflict = CableAlias.objects.filter(normalized_alias=normalized)
            if self.instance is not None:
                conflict = conflict.exclude(pk=self.instance.pk)
            existing = conflict.first()
            if existing:
                raise serializers.ValidationError(
                    {
                        "alias": (
                            f'Já existe um alias equivalente cadastrado ("{existing.alias}"), '
                            f"apontando para {existing.cable_family.code}."
                        )
                    }
                )
        return attrs


class CableSpecCrudSerializer(serializers.ModelSerializer):
    cable_family_code = serializers.CharField(source="cable_family.code", read_only=True)
    cable_family_name = serializers.CharField(source="cable_family.name", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CableSpec
        fields = (
            "id",
            "cable_family",
            "cable_family_code",
            "cable_family_name",
            "code",
            "name",
            "manufacturer",
            "part_number",
            "fiber_type",
            "jacket_color",
            "polarity",
            "connector_a",
            "connector_b",
            "fiber_count",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None

    def validate(self, attrs):
        # Reaproveita CableSpec.clean() (duplicidade de part number ativo +
        # consistência com CableAlias) em vez de duplicar a regra aqui —
        # monta uma instância transitória com os valores já validados pelo
        # DRF e roda a validação de negócio do model sobre ela.
        instance = self.instance or CableSpec()
        for field, value in attrs.items():
            setattr(instance, field, value)
        try:
            instance.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)
        return attrs


class CertificationTypeCrudSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CertificationType
        fields = (
            "id",
            "code",
            "name",
            "medium",
            "method",
            "requires_report",
            "requires_attachment",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class ActivityCrudSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = (
            "id",
            "code",
            "name",
            "category",
            "execution_type",
            "default_unit",
            "measurable",
            "requires_quantity",
            "requires_evidence",
            "requires_certification",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class NetworkCrudSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Network
        fields = (
            "id",
            "code",
            "name",
            "domain",
            "medium",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class WorkstreamCrudSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Workstream
        fields = (
            "id",
            "code",
            "name",
            "category",
            "default_medium",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class PathCrudSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Path
        fields = (
            "id",
            "code",
            "name",
            "path_group",
            "path_type",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class MasterDataSiteCrudSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MasterDataSite
        fields = (
            "id",
            "code",
            "name",
            "city",
            "state",
            "country",
            "site_type",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class LocationCrudSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source="site.code", read_only=True)
    site_name = serializers.CharField(source="site.name", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Location
        fields = (
            "id",
            "site",
            "site_code",
            "site_name",
            "code",
            "canonical_address",
            "area",
            "room",
            "row",
            "rack",
            "position",
            "ru",
            "location_type",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None

    def validate(self, attrs):
        # Reaproveita Location.clean() (consistência entre o prefixo do
        # endereço e o Site) em vez de duplicar a regra aqui — mesmo
        # padrão de CableSpecCrudSerializer.
        instance = self.instance or Location()
        for field, value in attrs.items():
            setattr(instance, field, value)
        try:
            instance.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)
        return attrs


class DeviceTypeCrudSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DeviceType
        fields = (
            "id",
            "code",
            "name",
            "category",
            "default_medium",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class TaskTemplateCrudSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskTemplate
        fields = (
            "id",
            "code",
            "name",
            "category",
            "medium",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class TaskTemplateStepCrudSerializer(serializers.ModelSerializer):
    task_template_code = serializers.CharField(source="task_template.code", read_only=True)
    task_template_name = serializers.CharField(source="task_template.name", read_only=True)
    activity_code = serializers.CharField(source="activity.code", read_only=True)
    activity_name = serializers.CharField(source="activity.name", read_only=True)
    effective_name = serializers.CharField(read_only=True)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskTemplateStep
        fields = (
            "id",
            "task_template",
            "task_template_code",
            "task_template_name",
            "activity",
            "activity_code",
            "activity_name",
            "effective_name",
            "step_order",
            "name_override",
            "required",
            "repeatable",
            "quantity_source",
            "unit_override",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class TaskTemplateRuleCrudSerializer(serializers.ModelSerializer):
    task_template_code = serializers.CharField(source="task_template.code", read_only=True)
    task_template_name = serializers.CharField(source="task_template.name", read_only=True)
    # cable_family/cable_spec/network/workstream são opcionais — usar
    # SerializerMethodField (em vez de CharField(source="x.code")) porque
    # este último levanta AttributeError/SkipField quando a FK é None,
    # omitindo o campo da resposta em vez de retornar null explicitamente.
    cable_family_code = serializers.SerializerMethodField()
    cable_family_name = serializers.SerializerMethodField()
    cable_spec_code = serializers.SerializerMethodField()
    cable_spec_part_number = serializers.SerializerMethodField()
    network_code = serializers.SerializerMethodField()
    network_name = serializers.SerializerMethodField()
    workstream_code = serializers.SerializerMethodField()
    workstream_name = serializers.SerializerMethodField()
    specificity_score = serializers.IntegerField(read_only=True)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskTemplateRule
        fields = (
            "id",
            "code",
            "name",
            "task_template",
            "task_template_code",
            "task_template_name",
            "cable_family",
            "cable_family_code",
            "cable_family_name",
            "cable_spec",
            "cable_spec_code",
            "cable_spec_part_number",
            "network",
            "network_code",
            "network_name",
            "workstream",
            "workstream_code",
            "workstream_name",
            "medium",
            "preterminated",
            "priority",
            "specificity_score",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_cable_family_code(self, obj):
        return obj.cable_family.code if obj.cable_family_id else None

    def get_cable_family_name(self, obj):
        return obj.cable_family.name if obj.cable_family_id else None

    def get_cable_spec_code(self, obj):
        return obj.cable_spec.code if obj.cable_spec_id else None

    def get_cable_spec_part_number(self, obj):
        return obj.cable_spec.part_number if obj.cable_spec_id else None

    def get_network_code(self, obj):
        return obj.network.code if obj.network_id else None

    def get_network_name(self, obj):
        return obj.network.name if obj.network_id else None

    def get_workstream_code(self, obj):
        return obj.workstream.code if obj.workstream_id else None

    def get_workstream_name(self, obj):
        return obj.workstream.name if obj.workstream_id else None

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None

    def validate(self, attrs):
        # Reaproveita TaskTemplateRule.clean() (consistência cable_spec x
        # cable_family + duplicidade lógica) em vez de duplicar a regra
        # aqui — mesmo padrão de LocationCrudSerializer.
        instance = self.instance or TaskTemplateRule()
        for field, value in attrs.items():
            setattr(instance, field, value)
        try:
            instance.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)
        return attrs


class TaskTemplateRuleSimulateSerializer(serializers.Serializer):
    """Entrada do Simulador de Regras (Cadastros Mestres > Operação >
    Simulador de Regras) — todos os critérios são opcionais, mas ao menos
    um precisa ser informado (não faz sentido simular "sem nenhuma
    característica de escopo"). Não é um ModelSerializer porque não
    representa nenhum model diretamente: é só a entrada do motor de match
    (`master_data.services.task_rule_resolver.resolve_task_template`)."""

    cable_family = serializers.PrimaryKeyRelatedField(queryset=CableFamily.objects.all(), required=False, allow_null=True)
    cable_spec = serializers.PrimaryKeyRelatedField(queryset=CableSpec.objects.all(), required=False, allow_null=True)
    network = serializers.PrimaryKeyRelatedField(queryset=Network.objects.all(), required=False, allow_null=True)
    workstream = serializers.PrimaryKeyRelatedField(queryset=Workstream.objects.all(), required=False, allow_null=True)
    medium = serializers.CharField(required=False, allow_blank=True, default="")
    preterminated = serializers.BooleanField(required=False, allow_null=True, default=None)

    def validate(self, attrs):
        has_criterion = (
            attrs.get("cable_family") is not None
            or attrs.get("cable_spec") is not None
            or attrs.get("network") is not None
            or attrs.get("workstream") is not None
            or bool(attrs.get("medium"))
            or attrs.get("preterminated") is not None
        )
        if not has_criterion:
            raise serializers.ValidationError("Informe ao menos um critério para simular.")
        return attrs


class ScopeItemCrudSerializer(serializers.ModelSerializer):
    """Planejamento > Itens de Escopo. `resolved_rule`/`resolved_template`/
    `rule_resolution_status`/`normalization_metadata` são só leitura —
    nunca escritos pelo formulário normal, só pela action `resolve-template`
    (ScopeItemViewSet.resolve_template), que usa
    master_data.services.task_rule_resolver.apply_resolution_to_scope_item."""

    cable_family_code = serializers.SerializerMethodField()
    cable_family_name = serializers.SerializerMethodField()
    cable_spec_code = serializers.SerializerMethodField()
    cable_spec_part_number = serializers.SerializerMethodField()
    network_code = serializers.SerializerMethodField()
    network_name = serializers.SerializerMethodField()
    workstream_code = serializers.SerializerMethodField()
    workstream_name = serializers.SerializerMethodField()
    path_code = serializers.SerializerMethodField()
    path_name = serializers.SerializerMethodField()
    resolved_rule_code = serializers.SerializerMethodField()
    resolved_rule_name = serializers.SerializerMethodField()
    resolved_template_code = serializers.SerializerMethodField()
    resolved_template_name = serializers.SerializerMethodField()
    rule_resolution_status = serializers.CharField(read_only=True)
    normalization_metadata = serializers.JSONField(read_only=True)
    # tasks_outdated é só leitura de propósito — sinalizado pelo backend
    # (ScopeItem.save()/ScopeItemPath.save()/delete()) quando
    # expansion_mode/paths/resolved_template mudam depois que o item já
    # tem GeneratedTasks; nunca setado diretamente pelo formulário.
    tasks_outdated = serializers.BooleanField(read_only=True)
    # Rotas adicionais (ScopeItemPath) — lido E escrito como uma lista de
    # ids de Path (mesmo formato de um campo multiselect comum no
    # frontend); a sincronização de fato (criar/reativar/desativar
    # ScopeItemPath) acontece em create()/update() via _sync_paths().
    paths = serializers.PrimaryKeyRelatedField(queryset=Path.objects.all(), many=True, required=False)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()
    # Status derivado (não persistido) que resume, num único valor, onde
    # este item está no fluxo SOW -> ScopeItem -> resolução -> Tarefas
    # Geradas — ver get_operational_status(). Usado pela grade de Itens
    # de Escopo (coluna/badge) e para habilitar a ação "Gerar Tarefas".
    operational_status = serializers.SerializerMethodField()
    has_generated_tasks = serializers.SerializerMethodField()

    class Meta:
        model = ScopeItem
        fields = (
            "id",
            "code",
            "name",
            "item_type",
            "cable_family",
            "cable_family_code",
            "cable_family_name",
            "cable_spec",
            "cable_spec_code",
            "cable_spec_part_number",
            "network",
            "network_code",
            "network_name",
            "workstream",
            "workstream_code",
            "workstream_name",
            "path",
            "path_code",
            "path_name",
            "quantity",
            "unit",
            "length_type",
            "length_m",
            "medium",
            "preterminated",
            "color",
            "fiber_count",
            "raw_text",
            "source_type",
            "source_reference",
            "confidence_score",
            "requires_review",
            "description",
            "active",
            "normalization_metadata",
            "resolved_rule_code",
            "resolved_rule_name",
            "resolved_template_code",
            "resolved_template_name",
            "rule_resolution_status",
            "expansion_mode",
            "tasks_outdated",
            "paths",
            "operational_status",
            "has_generated_tasks",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("code", "created_at", "updated_at")

    @staticmethod
    def _has_generated_tasks(obj):
        annotated = getattr(obj, "generated_tasks_exist", None)
        return obj.generated_tasks.exists() if annotated is None else annotated

    def get_has_generated_tasks(self, obj):
        return self._has_generated_tasks(obj)

    def get_operational_status(self, obj):
        # Ordem importa: revisão pendente/sem match têm prioridade sobre
        # "já tem tarefas geradas" (um item pode ter gerado tarefas antes
        # de um dado ficar desatualizado — tasks_outdated cobre esse caso
        # à parte, ver o campo já existente).
        if obj.requires_review:
            return "REQUIRES_REVIEW"
        if obj.rule_resolution_status == "NO_MATCH":
            return "NO_MATCH"
        if obj.rule_resolution_status != "RESOLVED":
            return "AWAITING_RESOLUTION"
        if self._has_generated_tasks(obj):
            return "TASKS_GENERATED"
        return "READY_TO_GENERATE"

    def get_cable_family_code(self, obj):
        return obj.cable_family.code if obj.cable_family_id else None

    def get_cable_family_name(self, obj):
        return obj.cable_family.name if obj.cable_family_id else None

    def get_cable_spec_code(self, obj):
        return obj.cable_spec.code if obj.cable_spec_id else None

    def get_cable_spec_part_number(self, obj):
        return obj.cable_spec.part_number if obj.cable_spec_id else None

    def get_network_code(self, obj):
        return obj.network.code if obj.network_id else None

    def get_network_name(self, obj):
        return obj.network.name if obj.network_id else None

    def get_workstream_code(self, obj):
        return obj.workstream.code if obj.workstream_id else None

    def get_workstream_name(self, obj):
        return obj.workstream.name if obj.workstream_id else None

    def get_path_code(self, obj):
        return obj.path.code if obj.path_id else None

    def get_path_name(self, obj):
        return obj.path.name if obj.path_id else None

    def get_resolved_rule_code(self, obj):
        return obj.resolved_rule.code if obj.resolved_rule_id else None

    def get_resolved_rule_name(self, obj):
        return obj.resolved_rule.name if obj.resolved_rule_id else None

    def get_resolved_template_code(self, obj):
        return obj.resolved_template.code if obj.resolved_template_id else None

    def get_resolved_template_name(self, obj):
        return obj.resolved_template.name if obj.resolved_template_id else None

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None

    def validate(self, attrs):
        # "paths" não é um campo real do model (é uma @property só
        # leitura) — tira do dict antes do setattr genérico abaixo (que
        # quebraria tentando atribuir a uma property sem setter) e devolve
        # depois, para create()/update() sincronizarem via _sync_paths().
        paths = attrs.pop("paths", None)

        # Reaproveita ScopeItem.clean() (que chama
        # master_data.services.scope_item_normalizer.normalize_scope_item)
        # em vez de duplicar a regra aqui — mesmo padrão de
        # LocationCrudSerializer/TaskTemplateRuleCrudSerializer.
        instance = self.instance or ScopeItem()
        for field, value in attrs.items():
            setattr(instance, field, value)
        try:
            instance.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)
        # clean() pode ter preenchido cable_family/medium derivados —
        # refletir de volta em attrs para que o valor derivado seja
        # realmente salvo (attrs, não a instance solta, é o que o
        # ModelSerializer usa para criar/atualizar o registro de verdade).
        attrs["cable_family"] = instance.cable_family
        attrs["medium"] = instance.medium
        attrs["normalization_metadata"] = instance.normalization_metadata
        if paths is not None:
            attrs["paths"] = paths
        return attrs

    def create(self, validated_data):
        paths = validated_data.pop("paths", None)
        instance = super().create(validated_data)
        if paths is not None:
            self._sync_paths(instance, paths)
        return instance

    def update(self, instance, validated_data):
        paths = validated_data.pop("paths", None)
        instance = super().update(instance, validated_data)
        if paths is not None:
            self._sync_paths(instance, paths)
        return instance

    def _sync_paths(self, instance, paths):
        """Cria/reativa/desativa ScopeItemPath conforme a lista de Path
        submetida — nunca deleta fisicamente (mesmo padrão "sem hard
        delete" do resto do módulo). Desativar/reativar aqui já dispara
        ScopeItemPath.save()/delete(), que marcam tasks_outdated quando o
        item já tem GeneratedTasks."""
        request = self.context.get("request")
        user = getattr(request, "user", None)
        existing = {sip.path_id: sip for sip in instance.scope_item_paths.all()}
        desired_ids = {path.pk for path in paths}
        for path in paths:
            sip = existing.get(path.pk)
            if sip is None:
                ScopeItemPath.objects.create(scope_item=instance, path=path, created_by=user, updated_by=user)
            elif not sip.active:
                sip.active = True
                sip.updated_by = user
                sip.save(update_fields=("active", "updated_by", "updated_at"))
        for path_id, sip in existing.items():
            if path_id not in desired_ids and sip.active:
                sip.active = False
                sip.updated_by = user
                sip.save(update_fields=("active", "updated_by", "updated_at"))


class GeneratedTaskCrudSerializer(serializers.ModelSerializer):
    """Planejamento > Tarefas Geradas. `scope_item`/`task_template`/
    `task_template_step`/`activity` (e o snapshot `step_order`/`required`/
    `repeatable`/`generation_source`) são só leitura — uma GeneratedTask
    criada por TEMPLATE não deve ter esse vínculo de rastreabilidade
    editado; só `name`/`quantity`/`unit`/`status`/`description`/`active`
    são editáveis (ver GeneratedTaskViewSet.create, que bloqueia criação
    manual nesta primeira versão)."""

    scope_item_code = serializers.CharField(source="scope_item.code", read_only=True)
    scope_item_raw_text = serializers.CharField(source="scope_item.raw_text", read_only=True)
    # "" (não "" -> texto vazio na tela) quando o item de escopo não veio
    # de uma importação de SOW — usado para a tela Tarefas Geradas poder
    # ser filtrada/pesquisada pelo código da importação de origem (ver
    # também GeneratedTaskViewSet.get_queryset ?sow_import=).
    scope_item_source_reference = serializers.CharField(source="scope_item.source_reference", read_only=True)
    task_template_code = serializers.CharField(source="task_template.code", read_only=True)
    task_template_name = serializers.CharField(source="task_template.name", read_only=True)
    activity_code = serializers.CharField(source="activity.code", read_only=True)
    activity_name = serializers.CharField(source="activity.name", read_only=True)
    path_code = serializers.SerializerMethodField()
    path_name = serializers.SerializerMethodField()
    expansion_key = serializers.CharField(read_only=True)
    step_order = serializers.IntegerField(read_only=True)
    required = serializers.BooleanField(read_only=True)
    repeatable = serializers.BooleanField(read_only=True)
    generation_source = serializers.CharField(read_only=True)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = GeneratedTask
        fields = (
            "id",
            "code",
            "scope_item_code",
            "scope_item_raw_text",
            "scope_item_source_reference",
            "task_template_code",
            "task_template_name",
            "activity_code",
            "activity_name",
            "path_code",
            "path_name",
            "expansion_key",
            "step_order",
            "name",
            "quantity",
            "unit",
            "required",
            "repeatable",
            "generation_source",
            "status",
            "description",
            "active",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = ("code", "created_at", "updated_at")

    def get_path_code(self, obj):
        return obj.path.code if obj.path_id else None

    def get_path_name(self, obj):
        return obj.path.name if obj.path_id else None

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None


class GeneratedTaskDependencyCrudSerializer(serializers.ModelSerializer):
    """Dependências entre GeneratedTasks — gerada automaticamente por
    master_data.services.task_dependency_generator (nunca manualmente
    nesta primeira versão, ver GeneratedTaskDependencyViewSet, que é
    somente leitura). Usado tanto para listar todas as dependências de um
    ScopeItem quanto para as seções "Predecessoras"/"Sucessoras" de uma
    GeneratedTask específica."""

    predecessor_task_code = serializers.CharField(source="predecessor_task.code", read_only=True)
    predecessor_task_name = serializers.CharField(source="predecessor_task.name", read_only=True)
    successor_task_code = serializers.CharField(source="successor_task.code", read_only=True)
    successor_task_name = serializers.CharField(source="successor_task.name", read_only=True)

    class Meta:
        model = GeneratedTaskDependency
        fields = (
            "id",
            "predecessor_task",
            "predecessor_task_code",
            "predecessor_task_name",
            "successor_task",
            "successor_task_code",
            "successor_task_name",
            "dependency_type",
            "lag_value",
            "lag_unit",
            "description",
            "active",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class SowImportSerializer(serializers.ModelSerializer):
    """Planejamento > Importar SOW. `source_file` é write-only (aceita
    multipart no create); a leitura usa `source_file_url`. Campos de
    processamento (status/parser_version/ai_*/total_*/error_message) só
    são gravados pelo service layer (master_data.services.sow_parser.
    service), nunca diretamente pelo formulário — ver
    SowImportViewSet.process/reprocess."""

    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()
    source_file_url = serializers.SerializerMethodField()

    class Meta:
        model = SowImport
        fields = (
            "id",
            "code",
            "title",
            "source_type",
            "source_file",
            "source_file_url",
            "source_text",
            "original_filename",
            "mime_type",
            "status",
            "parser_version",
            "ai_provider",
            "ai_model",
            "ai_mode",
            "processing_started_at",
            "processing_finished_at",
            "total_items_detected",
            "total_items_approved",
            "total_items_rejected",
            "total_warnings",
            "error_message",
            "created_at",
            "updated_at",
            "created_by_name",
            "updated_by_name",
        )
        read_only_fields = (
            "id",
            "code",
            "original_filename",
            "mime_type",
            "status",
            "parser_version",
            "ai_provider",
            "ai_model",
            "ai_mode",
            "processing_started_at",
            "processing_finished_at",
            "total_items_detected",
            "total_items_approved",
            "total_items_rejected",
            "total_warnings",
            "error_message",
            "created_at",
            "updated_at",
        )
        extra_kwargs = {"source_file": {"write_only": True, "required": False}}

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.get_username() if obj.created_by_id else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() or obj.updated_by.get_username() if obj.updated_by_id else None

    def get_source_file_url(self, obj):
        if not obj.source_file:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.source_file.url) if request else obj.source_file.url

    def validate(self, attrs):
        if self.instance is None:
            source_file = attrs.get("source_file")
            source_text = (attrs.get("source_text") or "").strip()
            if not source_file and not source_text:
                raise serializers.ValidationError(
                    {"source_text": "Informe o texto do SOW ou envie um arquivo."}
                )
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        source_file = validated_data.pop("source_file", None)
        instance = SowImport(created_by=user, updated_by=user, **validated_data)
        if source_file is not None:
            instance.source_file = source_file
            instance.original_filename = source_file.name
            instance.mime_type = getattr(source_file, "content_type", "") or ""
            if not instance.source_text:
                try:
                    instance.source_text = extract_text_from_file(source_file)
                except UnsupportedSourceTypeError as exc:
                    instance.status = "FAILED"
                    instance.error_message = str(exc)
        instance.save()
        return instance


class SowParsedItemSerializer(serializers.ModelSerializer):
    """Preview revisável de um item extraído de um SowImport (ver
    docstring de SowParsedItem). `raw_text` nunca é editável (evidência de
    auditoria); `review_status`/`approved_scope_item`/`reviewed_by`/
    `reviewed_at` só são gravados pelas actions approve/reject (nunca por
    PATCH direto — ver validate() abaixo, que também bloqueia qualquer
    edição depois de aprovado)."""

    sow_import_code = serializers.CharField(source="sow_import.code", read_only=True)
    suggested_cable_family_code = serializers.SerializerMethodField()
    suggested_cable_family_name = serializers.SerializerMethodField()
    suggested_cable_spec_code = serializers.SerializerMethodField()
    suggested_network_code = serializers.SerializerMethodField()
    suggested_workstream_code = serializers.SerializerMethodField()
    suggested_paths = serializers.PrimaryKeyRelatedField(queryset=Path.objects.all(), many=True, required=False)
    suggested_path_codes = serializers.SerializerMethodField()
    approved_scope_item_id = serializers.IntegerField(read_only=True)
    approved_scope_item_code = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    confidence_band = serializers.SerializerMethodField()

    class Meta:
        model = SowParsedItem
        fields = (
            "id",
            "sow_import",
            "sow_import_code",
            "sequence",
            "raw_text",
            "item_type",
            "suggested_cable_family",
            "suggested_cable_family_code",
            "suggested_cable_family_name",
            "suggested_cable_spec",
            "suggested_cable_spec_code",
            "suggested_network",
            "suggested_network_code",
            "suggested_workstream",
            "suggested_workstream_code",
            "suggested_paths",
            "suggested_path_codes",
            "quantity",
            "unit",
            "length_type",
            "length_m",
            "medium",
            "preterminated",
            "color",
            "fiber_count",
            "confidence_score",
            "confidence_band",
            "review_status",
            "requires_review",
            "warnings",
            "ai_raw_payload",
            "normalization_metadata",
            "approved_scope_item_id",
            "approved_scope_item_code",
            "reviewed_by_name",
            "reviewed_at",
            "active",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "sow_import",
            "sequence",
            "raw_text",
            "confidence_score",
            "review_status",
            "requires_review",
            "warnings",
            "ai_raw_payload",
            "normalization_metadata",
            "approved_scope_item_id",
            "reviewed_at",
            "created_at",
            "updated_at",
        )

    def get_suggested_cable_family_code(self, obj):
        return obj.suggested_cable_family.code if obj.suggested_cable_family_id else None

    def get_suggested_cable_family_name(self, obj):
        return obj.suggested_cable_family.name if obj.suggested_cable_family_id else None

    def get_suggested_cable_spec_code(self, obj):
        return obj.suggested_cable_spec.code if obj.suggested_cable_spec_id else None

    def get_suggested_network_code(self, obj):
        return obj.suggested_network.code if obj.suggested_network_id else None

    def get_suggested_workstream_code(self, obj):
        return obj.suggested_workstream.code if obj.suggested_workstream_id else None

    def get_suggested_path_codes(self, obj):
        return [path.code for path in obj.suggested_paths.all()]

    def get_approved_scope_item_code(self, obj):
        return obj.approved_scope_item.code if obj.approved_scope_item_id else None

    def get_reviewed_by_name(self, obj):
        return obj.reviewed_by.get_full_name() or obj.reviewed_by.get_username() if obj.reviewed_by_id else None

    def get_confidence_band(self, obj):
        if obj.confidence_score is None:
            return None
        if obj.confidence_score >= 0.95:
            return "HIGH"
        if obj.confidence_score >= 0.80:
            return "MEDIUM"
        return "LOW"

    def validate(self, attrs):
        if self.instance is not None and self.instance.approved_scope_item_id:
            raise serializers.ValidationError("Este item já foi aprovado e não pode mais ser editado.")
        return attrs


class ProjectTypeCrudSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectType
        fields = ("id", "name", "description", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class ConsultimerProjectTypeCrudSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsultimerProjectType
        fields = ("id", "name", "code", "description", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")

    def validate_code(self, value):
        value = value.strip().upper()
        queryset = ConsultimerProjectType.objects.filter(code=value)
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("Já existe um tipo com esta sigla.")
        return value


class JobTitleCrudSerializer(serializers.ModelSerializer):
    company_name = serializers.SerializerMethodField()

    class Meta:
        model = JobTitle
        fields = ("id", "company", "company_name", "name", "description", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")

    def get_company_name(self, obj):
        return str(obj.company) if obj.company_id else None


class SiteCrudSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    region_name = serializers.SerializerMethodField()
    region_code = serializers.CharField(source="region.code", read_only=True, default=None)
    country = serializers.CharField(source="region.country", read_only=True, default=None)

    class Meta:
        model = Site
        fields = (
            "id", "client", "client_name", "name", "code", "address", "city", "state",
            "region", "region_name", "region_code", "country",
            "manual_coordinates", "latitude", "longitude", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_client_name(self, obj):
        return str(obj.client) if obj.client_id else None

    def get_region_name(self, obj):
        return str(obj.region) if obj.region_id else None


class ClientCrudSerializer(serializers.ModelSerializer):
    company_name = serializers.SerializerMethodField()
    number_code = serializers.CharField(read_only=True)

    class Meta:
        model = Client
        fields = (
            "id", "number", "number_code", "company", "company_name", "person_type", "legal_name", "trade_name", "tax_id",
            "email", "phone", "address", "city", "state", "notes", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("number", "created_at", "updated_at")

    def get_company_name(self, obj):
        return str(obj.company) if obj.company_id else None


class ResponsibleCrudSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    """Responsável unificado — Tipo (`kind`) define se é CSTR (usa
    `company`, via Person) ou Cliente (usa `client` + `job_title`)."""

    name = serializers.CharField(source="person.name", required=False, allow_blank=True)
    email = serializers.EmailField(source="person.email", required=False, allow_blank=True)
    phone = serializers.CharField(source="person.phone", required=False, allow_blank=True)
    company = serializers.PrimaryKeyRelatedField(source="person.company", queryset=Company.objects.all(), required=False, allow_null=True)
    company_name = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = Responsible
        fields = (
            "id", "kind", "company", "company_name", "client", "client_name",
            "name", "email", "phone", "job_title", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_company_name(self, obj):
        return str(obj.person.company) if obj.person_id and obj.person.company_id else None

    def get_client_name(self, obj):
        return str(obj.client) if obj.client_id else None

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", Responsible.KIND_CSTR))
        client = attrs.get("client", getattr(self.instance, "client", None))
        if kind == Responsible.KIND_CLIENT and not client:
            raise serializers.ValidationError({"client": "Obrigatório para Responsável do Cliente."})
        if kind == Responsible.KIND_CSTR and client:
            raise serializers.ValidationError({"client": "Deve ficar em branco para Responsável CSTR."})
        return attrs

    def create(self, validated_data):
        person_data = validated_data.pop("person")
        validated_data["person"] = _get_or_create_person(**person_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        _update_person_from_data(instance, validated_data.pop("person", None))
        return super().update(instance, validated_data)


class CollaboratorCrudSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="person.name", required=False, allow_blank=True)
    email = serializers.EmailField(source="person.email", required=False, allow_blank=True)
    phone = serializers.CharField(source="person.phone", required=False, allow_blank=True)
    company = serializers.PrimaryKeyRelatedField(source="person.company", queryset=Company.objects.all())
    company_name = serializers.SerializerMethodField()
    job_title_name = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()

    class Meta:
        model = Collaborator
        fields = (
            "id", "company", "company_name", "name", "registration", "yellow_badge", "job_title",
            "job_title_name", "email", "phone", "sites", "manager", "manager_name", "is_active",
            "created_at", "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_company_name(self, obj):
        return str(obj.person.company) if obj.person_id and obj.person.company_id else None

    def create(self, validated_data):
        person_data = validated_data.pop("person")
        validated_data["person"] = _get_or_create_person(**person_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        _update_person_from_data(instance, validated_data.pop("person", None))
        return super().update(instance, validated_data)

    def validate_manager(self, value):
        """O gestor precisa ter cargo de Supervisor, Coordenador ou Gerente.
        Só valida quando o gestor muda, para não travar a edição de quem já
        tinha um gestor cadastrado antes desta regra."""
        import re

        if value is None or value.pk == getattr(self.instance, "manager_id", None):
            return value
        title = value.job_title.name if value.job_title_id else ""
        if not re.search(r"supervisor|coordenador|gerente", title, re.IGNORECASE):
            raise serializers.ValidationError("O gestor precisa ter cargo de Supervisor, Coordenador ou Gerente.")
        return value

    def get_job_title_name(self, obj):
        return str(obj.job_title) if obj.job_title_id else None

    def get_manager_name(self, obj):
        return str(obj.manager) if obj.manager_id else None


class TaskCrudSerializer(serializers.ModelSerializer):
    project_type_names = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = (
            "id", "code", "name", "description", "estimated_hours", "project_types",
            "project_type_names", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("code", "created_at", "updated_at")

    def get_project_type_names(self, obj):
        return [str(pt) for pt in obj.project_types.all()]


class ProjectSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    site_name = serializers.SerializerMethodField()
    category_name = serializers.SerializerMethodField()
    consultimer_type_name = serializers.SerializerMethodField()
    responsible_cstr_name = serializers.SerializerMethodField()
    responsible_client_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    total_tasks = serializers.SerializerMethodField()
    completed_tasks = serializers.SerializerMethodField()
    worked_hours = serializers.SerializerMethodField()
    real_man_hours = serializers.SerializerMethodField()
    historical_hours = serializers.SerializerMethodField()
    untracked_tasks_count = serializers.SerializerMethodField()
    tracking_rate = serializers.SerializerMethodField()
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = (
            "id",
            "code",
            "company",
            "name",
            "po",
            "link_count",
            "has_rack_positions",
            "client",
            "client_name",
            "site",
            "site_name",
            "category",
            "category_name",
            "project_type",
            "consultimer_type",
            "consultimer_type_name",
            "responsible_cstr",
            "responsible_cstr_name",
            "responsible_client",
            "responsible_client_name",
            "description",
            "notes",
            "status",
            "status_display",
            "planned_start",
            "planned_end",
            "actual_start",
            "actual_end",
            "is_active",
            "total_tasks",
            "completed_tasks",
            "worked_hours",
            "real_man_hours",
            "historical_hours",
            "untracked_tasks_count",
            "tracking_rate",
            "progress_percent",
        )

    def get_client_name(self, obj):
        return str(obj.client) if obj.client_id else None

    def get_site_name(self, obj):
        return str(obj.site) if obj.site_id else None

    def get_category_name(self, obj):
        return str(obj.category) if obj.category_id else None

    def get_consultimer_type_name(self, obj):
        return str(obj.consultimer_type) if obj.consultimer_type_id else None

    def get_responsible_cstr_name(self, obj):
        return str(obj.responsible_cstr) if obj.responsible_cstr_id else None

    def get_responsible_client_name(self, obj):
        return str(obj.responsible_client) if obj.responsible_client_id else None

    def _tasks(self, obj):
        if not hasattr(obj, "_serializer_tasks_cache"):
            # Reaproveita o prefetch da view (project_tasks__assignments) quando existe.
            if "project_tasks" in getattr(obj, "_prefetched_objects_cache", {}):
                tasks = obj.project_tasks.all()
            else:
                tasks = obj.project_tasks.prefetch_related("assignments").all()
            obj._serializer_tasks_cache = list(tasks)
        return obj._serializer_tasks_cache

    def get_total_tasks(self, obj):
        return len(self._tasks(obj))

    def get_completed_tasks(self, obj):
        return len([t for t in self._tasks(obj) if t.status == "completed"])

    def get_worked_hours(self, obj):
        return merged_worked_hours(self._tasks(obj))

    def get_real_man_hours(self, obj):
        return round(sum(t.real_man_hours for t in self._tasks(obj)), 2)

    def get_historical_hours(self, obj):
        """Horas históricas (planilhas) do projeto — só total do projeto."""
        total = getattr(obj, "historical_hours_total", None)
        if total is None:
            from django.db.models import Sum

            total = obj.hour_entries.aggregate(total=Sum("total_hours"))["total"]
        return float(total or 0)

    def get_untracked_tasks_count(self, obj):
        return sum(
            1 for t in self._tasks(obj)
            if t.status == "completed" and not t.has_real_time_tracking
        )

    def get_tracking_rate(self, obj):
        tasks = self._tasks(obj)
        completed = [t for t in tasks if t.status == "completed"]
        if not completed:
            return 0
        tracked = sum(1 for t in completed if t.has_real_time_tracking)
        return round((tracked / len(completed)) * 100)

    def get_progress_percent(self, obj):
        tasks = self._tasks(obj)
        if not tasks:
            return 0
        completed = len([t for t in tasks if t.status == "completed"])
        return round((completed / len(tasks)) * 100)

    def _run_model_clean(self, instance):
        from django.core.exceptions import ValidationError as DjangoValidationError

        try:
            instance.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)

    def create(self, validated_data):
        instance = Project(**validated_data)
        self._run_model_clean(instance)
        instance.save()
        return instance

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        self._run_model_clean(instance)
        instance.save()
        return instance


class RackPositionSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    class Meta:
        model = RackPosition
        fields = ("id", "project", "position", "dh", "links", "utp", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class ProjectTaskSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    task_name = serializers.CharField(source="display_name", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    priority_display = serializers.CharField(source="get_priority_display", read_only=True)
    worked_hours = serializers.SerializerMethodField()
    rack_position_labels = serializers.SerializerMethodField()
    collaborators = CollaboratorSummarySerializer(many=True, read_only=True)
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        source="collaborators", queryset=Collaborator.objects.filter(is_active=True), many=True, write_only=True, required=False
    )
    queue_order = serializers.SerializerMethodField()
    # Rastreabilidade até o SOW/ScopeItem/Template de origem — tudo
    # derivado de `generated_task` (nunca duplicado como coluna própria),
    # ver ProjectTask.generated_task e
    # projects.services.create_project_tasks_from_generated_tasks.
    generated_task_code = serializers.CharField(source="generated_task.code", read_only=True, default=None)
    scope_item_code = serializers.CharField(source="generated_task.scope_item.code", read_only=True, default=None)
    sow_import_code = serializers.CharField(
        source="generated_task.scope_item.source_reference", read_only=True, default=None
    )
    task_template_code = serializers.CharField(source="generated_task.task_template.code", read_only=True, default=None)
    activity_code = serializers.CharField(source="generated_task.activity.code", read_only=True, default=None)
    activity_name = serializers.CharField(source="generated_task.activity.name", read_only=True, default=None)
    work_group = serializers.CharField(source="generated_task.scope_item.cable_family.work_group", read_only=True, default=None)
    work_group_label = serializers.SerializerMethodField()
    path_code = serializers.SerializerMethodField()
    expansion_key = serializers.CharField(source="generated_task.expansion_key", read_only=True, default=None)
    step_order = serializers.IntegerField(source="generated_task.step_order", read_only=True, default=None)

    class Meta:
        model = ProjectTask
        fields = (
            "id",
            "project",
            "project_name",
            "project_code",
            "task",
            "task_name",
            "custom_name",
            "rack_positions",
            "rack_position_labels",
            "collaborators",
            "collaborator_ids",
            "status",
            "status_display",
            "priority",
            "priority_display",
            "order",
            "queue_order",
            "planned_start",
            "planned_end",
            "actual_start",
            "actual_end",
            "estimated_hours",
            "actual_hours",
            "worked_hours",
            "completion_outcome",
            "quantity_done",
            "quantity_planned",
            "unit",
            "requires_evidence",
            "requires_qaqc",
            "instructions",
            "notes",
            "origin",
            "generated_task",
            "generated_task_code",
            "scope_item_code",
            "sow_import_code",
            "task_template_code",
            "activity_code",
            "activity_name",
            "work_group",
            "work_group_label",
            "path_code",
            "expansion_key",
            "step_order",
        )
        read_only_fields = ("origin", "generated_task")

    def get_work_group_label(self, obj):
        family = obj.generated_task.scope_item.cable_family if obj.generated_task_id else None
        return family.get_work_group_display() if family and family.work_group else None

    def get_rack_position_labels(self, obj):
        return [rp.position for rp in obj.rack_positions.all()]

    def get_path_code(self, obj):
        if not obj.generated_task_id or not obj.generated_task.path_id:
            return None
        return obj.generated_task.path.code

    def get_worked_hours(self, obj):
        return obj.worked_hours

    def get_queue_order(self, obj):
        """Posição desta tarefa na fila do técnico logado (não faz sentido
        fora do contexto de /my-tasks/, onde há um único técnico óbvio;
        em outros contextos retorna None)."""
        request = self.context.get("request")
        if request is None:
            return None
        collaborator = get_collaborator_role(request.user)
        if collaborator is None:
            return None
        assignment = next((a for a in obj.assignments.all() if a.collaborator_id == collaborator.id), None)
        return assignment.queue_order if assignment else None

    def validate(self, attrs):
        rack_positions = attrs.get("rack_positions")
        project = attrs.get("project") or getattr(self.instance, "project", None)
        task = attrs.get("task") if "task" in attrs else getattr(self.instance, "task", None)
        custom_name = attrs.get("custom_name") if "custom_name" in attrs else getattr(self.instance, "custom_name", "")
        if not task and not (custom_name or "").strip():
            raise serializers.ValidationError({"custom_name": "Informe uma Tarefa do catálogo ou um nome avulso."})
        if rack_positions:
            invalid = [rp for rp in rack_positions if rp.project_id != project.pk]
            if invalid:
                names = ", ".join(rp.position for rp in invalid)
                raise serializers.ValidationError({"rack_positions": f"Rack Position(s) que não pertencem a este projeto: {names}."})
        if project and task:
            probe = self.instance or ProjectTask(project_id=project.pk, task_id=task.pk)
            try:
                probe.validate_unique_for_rack_positions(rack_positions or [])
            except DjangoValidationError as exc:
                raise serializers.ValidationError(getattr(exc, "message_dict", None) or {"non_field_errors": exc.messages})
        return attrs


class ProjectOccurrenceSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    responsible_name = serializers.CharField(source="responsible.person.name", read_only=True, default=None)
    severity_display = serializers.CharField(source="get_severity_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ProjectOccurrence
        fields = (
            "id",
            "project",
            "title",
            "description",
            "responsible",
            "responsible_name",
            "severity",
            "severity_display",
            "status",
            "status_display",
            "occurred_at",
            "resolved_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("resolved_at", "created_at", "updated_at")


class ProjectAttachmentSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectAttachment
        fields = (
            "id",
            "project",
            "file",
            "file_name",
            "file_size",
            "description",
            "uploaded_by",
            "uploaded_by_name",
            "created_at",
        )
        read_only_fields = ("uploaded_by", "created_at")

    def get_file_name(self, obj):
        return obj.file.name.rsplit("/", 1)[-1] if obj.file else ""

    def get_file_size(self, obj):
        try:
            return obj.file.size
        except (ValueError, FileNotFoundError, OSError):
            return None

    def get_uploaded_by_name(self, obj):
        if not obj.uploaded_by_id:
            return None
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.get_username()


class ProjectTaskCreateSerializer(serializers.Serializer):
    """Cria uma ProjectTask a partir de uma Tarefa do catálogo — uma por
    Rack Position em `rack_position_ids` (ver services.create_task_instances),
    ou uma única sem Rack Position se vier vazio. Usado pelo formulário
    'Nova Tarefa' do frontend, que permite selecionar vários Rack Positions
    de uma vez."""

    task = serializers.PrimaryKeyRelatedField(queryset=Task.objects.filter(is_active=True))
    rack_position_ids = serializers.PrimaryKeyRelatedField(queryset=RackPosition.objects.all(), many=True, required=False, default=list)
    status = serializers.ChoiceField(choices=ProjectTask.STATUS_CHOICES, required=False, default=ProjectTask.STATUS_NOT_STARTED)
    planned_start = serializers.DateTimeField(required=False, allow_null=True, default=None)
    planned_end = serializers.DateTimeField(required=False, allow_null=True, default=None)
    estimated_hours = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None)
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        queryset=Collaborator.objects.filter(is_active=True), many=True, required=False, default=list
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs.get("planned_start") and attrs.get("planned_end") and attrs["planned_end"] < attrs["planned_start"]:
            raise serializers.ValidationError({"planned_end": "O término não pode ser anterior ao início."})
        return attrs


class ProjectTaskBulkActionSerializer(serializers.Serializer):
    ACTION_UPDATE = "update"
    ACTION_DELETE = "delete"
    ACTION_ADD = "add"

    action = serializers.ChoiceField(choices=(ACTION_UPDATE, ACTION_DELETE, ACTION_ADD))
    task_ids = serializers.PrimaryKeyRelatedField(queryset=ProjectTask.objects.all(), many=True, required=False, default=list)
    add_task_ids = serializers.PrimaryKeyRelatedField(queryset=Task.objects.filter(is_active=True), many=True, required=False, default=list)
    status = serializers.ChoiceField(choices=ProjectTask.STATUS_CHOICES, required=False, allow_blank=True, default="")
    planned_start = serializers.DateTimeField(required=False, allow_null=True, default=None)
    planned_end = serializers.DateTimeField(required=False, allow_null=True, default=None)
    estimated_hours = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None)
    priority = serializers.ChoiceField(choices=ProjectTask.PRIORITY_CHOICES, required=False, allow_blank=True, default="")
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        queryset=Collaborator.objects.filter(is_active=True), many=True, required=False, default=list
    )
    rack_position_ids = serializers.PrimaryKeyRelatedField(queryset=RackPosition.objects.all(), many=True, required=False, default=list)

    def validate(self, attrs):
        if attrs.get("planned_start") and attrs.get("planned_end") and attrs["planned_end"] < attrs["planned_start"]:
            raise serializers.ValidationError({"planned_end": "O término não pode ser anterior ao início."})
        return attrs


class RackPositionBulkCreateSerializer(serializers.Serializer):
    text = serializers.CharField(allow_blank=False)


class MyTaskSerializer(ProjectTaskSerializer):
    """Visão do técnico logado em /api/my-tasks/. Status, horas, resultado e
    quantidade são do PRÓPRIO despacho dele; o status da tarefa inteira
    continua em task_status (só fica concluída quando todos concluírem)."""

    task_status = serializers.CharField(source="status", read_only=True)
    status = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()
    actual_start = serializers.SerializerMethodField()
    actual_end = serializers.SerializerMethodField()
    actual_hours = serializers.SerializerMethodField()
    completion_outcome = serializers.SerializerMethodField()
    quantity_done = serializers.SerializerMethodField()

    class Meta(ProjectTaskSerializer.Meta):
        fields = ProjectTaskSerializer.Meta.fields + ("task_status",)

    def _own_assignment(self, obj):
        request = self.context.get("request")
        collaborator = get_collaborator_role(request.user) if request else None
        if collaborator is None:
            return None
        return next((a for a in obj.assignments.all() if a.collaborator_id == collaborator.id), None)

    def get_status(self, obj):
        assignment = self._own_assignment(obj)
        return assignment.status if assignment else obj.status

    def get_status_display(self, obj):
        return dict(ProjectTask.STATUS_CHOICES).get(self.get_status(obj), obj.status)

    def get_actual_start(self, obj):
        assignment = self._own_assignment(obj)
        return assignment.assignment_start if assignment else None

    def get_actual_end(self, obj):
        assignment = self._own_assignment(obj)
        return assignment.assignment_end if assignment else None

    def get_actual_hours(self, obj):
        assignment = self._own_assignment(obj)
        return assignment.actual_hours if assignment else None

    def get_completion_outcome(self, obj):
        assignment = self._own_assignment(obj)
        return assignment.completion_outcome if assignment else ""

    def get_quantity_done(self, obj):
        assignment = self._own_assignment(obj)
        return assignment.quantity_done if assignment else ""


class MyTaskUpdateSerializer(serializers.Serializer):
    """Entrada de /api/my-tasks/<id>/ (PATCH). O técnico só informa o andamento
    do próprio despacho. Datas e horas não entram aqui de propósito: o
    apontamento usa o relógio do servidor (ver MyTaskViewSet.update)."""

    status = serializers.ChoiceField(
        choices=(ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED, ProjectTask.STATUS_COMPLETED),
        required=False,
    )
    completion_outcome = serializers.ChoiceField(
        choices=ProjectTask.COMPLETION_OUTCOME_CHOICES, required=False, allow_blank=True
    )
    quantity_done = serializers.CharField(max_length=100, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class TechnicianDailyPresenceSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    status_since = serializers.SerializerMethodField()

    class Meta:
        model = TechnicianDailyPresence
        fields = ("id", "collaborator", "date", "status", "status_display", "status_since", "checked_in_at", "checked_out_at")
        read_only_fields = ("collaborator", "date", "status", "status_since", "checked_in_at", "checked_out_at")

    def get_status_since(self, obj):
        """Desde quando o status ATUAL vale. checked_in_at é gravado só uma vez
        por dia (no primeiro status), então não serve pra isso: aqui pega o
        início da sequência final de eventos com o status atual (reselecionar
        o mesmo status não reinicia o horário)."""
        events = TechnicianStatusEvent.objects.filter(
            collaborator_id=obj.collaborator_id, date=obj.date
        ).order_by("-changed_at", "-id").values_list("status", "changed_at")
        since = None
        for status, changed_at in events:
            if status != obj.status:
                break
            since = changed_at
        return since or obj.checked_in_at


class TechnicianAbsenceSerializer(serializers.ModelSerializer):
    collaborator_name = serializers.CharField(source="collaborator.person.name", read_only=True, default="")

    class Meta:
        model = TechnicianAbsence
        fields = ("id", "collaborator", "collaborator_name", "date_from", "date_to", "reason", "created_by", "created_at")
        read_only_fields = ("created_by", "created_at")

    def validate(self, attrs):
        date_from = attrs.get("date_from", getattr(self.instance, "date_from", None))
        date_to = attrs.get("date_to", getattr(self.instance, "date_to", None))
        if date_from and date_to and date_to < date_from:
            raise serializers.ValidationError({"date_to": "A data final não pode ser anterior à data inicial."})
        return attrs


class DailyUpdateAllocationSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        source="collaborators", queryset=Collaborator.objects.filter(is_active=True), many=True
    )
    collaborators = CollaboratorSummarySerializer(many=True, read_only=True)

    class Meta:
        model = DailyUpdateAllocation
        fields = ("id", "project", "project_name", "collaborators", "collaborator_ids")


class DailyUpdateSerializer(serializers.ModelSerializer):
    allocations = DailyUpdateAllocationSerializer(many=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DailyUpdate
        fields = (
            "id",
            "allocation_date",
            "description",
            "created_by",
            "created_by_name",
            "allocations",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("description", "created_by", "created_at", "updated_at")

    def get_created_by_name(self, obj):
        if not obj.created_by_id:
            return None
        return obj.created_by.get_full_name() or obj.created_by.get_username()

    def create(self, validated_data):
        allocations_data = validated_data.pop("allocations")
        request = self.context["request"]
        daily_update = DailyUpdate.objects.create(created_by=request.user, **validated_data)
        for allocation_data in allocations_data:
            collaborators = allocation_data.pop("collaborators")
            allocation = DailyUpdateAllocation.objects.create(daily_update=daily_update, **allocation_data)
            allocation.collaborators.set(collaborators)
        daily_update.refresh_description()
        return daily_update

    def update(self, instance, validated_data):
        allocations_data = validated_data.pop("allocations", None)
        instance = super().update(instance, validated_data)
        if allocations_data is not None:
            instance.allocations.all().delete()
            for allocation_data in allocations_data:
                collaborators = allocation_data.pop("collaborators")
                allocation = DailyUpdateAllocation.objects.create(daily_update=instance, **allocation_data)
                allocation.collaborators.set(collaborators)
        instance.refresh_description()
        return instance


class ProjectDailyUpdateSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    client_name = serializers.SerializerMethodField()
    collaborators = CollaboratorSummarySerializer(many=True, read_only=True)
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        source="collaborators", queryset=Collaborator.objects.filter(is_active=True), many=True, required=False
    )
    is_sent = serializers.BooleanField(read_only=True)
    preview = serializers.SerializerMethodField()

    class Meta:
        model = ProjectDailyUpdate
        fields = (
            "id",
            "project",
            "project_name",
            "project_code",
            "client_name",
            "date",
            "collaborators",
            "collaborator_ids",
            "completion_percent",
            "activities_text",
            "certification_done",
            "project_finished",
            "summary",
            "preview",
            "is_sent",
            "sent_at",
            "created_by",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("sent_at", "created_by", "created_at", "updated_at")

    def get_client_name(self, obj):
        client = obj.project.client if obj.project_id else None
        return str(client) if client else None

    def get_preview(self, obj):
        # Montar o e-mail é caro; a lista não exibe a prévia (o editor busca o detalhe).
        view = self.context.get("view")
        if not obj.pk or getattr(view, "action", None) == "list":
            return None
        return build_project_update_body(obj)

    def to_representation(self, instance):
        # Recalcula percentual/atividades/certificação/finalização a partir
        # das ProjectTask sempre que a Atualização é lida (lista, detalhe ou
        # resposta de update), em vez de mostrar o valor congelado desde a
        # criação do registro.
        instance.refresh_from_tasks()
        return super().to_representation(instance)


class ProjectDailyUpdateCreateSerializer(ClientScopedRelationsMixin, serializers.ModelSerializer):
    """Usado apenas na criação: os demais campos são calculados
    automaticamente a partir do projeto (ver ProjectDailyUpdate.save())."""

    class Meta:
        model = ProjectDailyUpdate
        fields = ("id", "project", "date", "summary")

    def validate_project(self, project):
        from core.collaborator_scope import scope_supervisor_projects

        request = self.context["request"]
        allowed = scope_supervisor_projects(type(project).objects.filter(pk=project.pk), request.user)
        if not allowed.exists():
            raise serializers.ValidationError("Você só pode gerar atualizações dos projetos pelos quais é responsável.")
        return project

    def create(self, validated_data):
        request = self.context["request"]
        return ProjectDailyUpdate.objects.create(created_by=request.user, **validated_data)


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = AuditLog
        fields = (
            "id", "created_at", "actor", "actor_name", "app_label", "model_name", "object_pk", "object_repr",
            "action", "action_display", "field_name", "old_value", "new_value", "origin", "path", "ip_address",
        )

    def get_actor_name(self, obj):
        return str(obj.actor) if obj.actor_id else None


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ("id", "title", "message", "url", "project_id", "project_code", "is_read", "created_at")
        read_only_fields = fields


class CableImportItemSerializer(serializers.ModelSerializer):
    """Item do fluxo guiado de cabos. Só o `payload` é editável; o restante é
    calculado pelo serviço (master_data.services.cable_import)."""

    class Meta:
        model = CableImportItem
        fields = (
            "id",
            "line_number",
            "raw_line",
            "payload",
            "conflicts",
            "status",
            "created_family",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "line_number",
            "raw_line",
            "conflicts",
            "status",
            "created_family",
            "created_at",
            "updated_at",
        )

    def validate_payload(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Envie os dados do cadastro como objeto.")
        code = str(value.get("code") or "").strip()
        name = str(value.get("name") or "").strip()
        if not code:
            raise serializers.ValidationError("Código é obrigatório.")
        if not name:
            raise serializers.ValidationError("Nome é obrigatório.")
        medium = str(value.get("medium") or CableFamily.MEDIUM_FIBER).strip().upper()
        if medium not in (CableFamily.MEDIUM_FIBER, CableFamily.MEDIUM_COPPER):
            raise serializers.ValidationError("Meio inválido (use FIBER ou COPPER).")
        fiber_count = value.get("fiber_count")
        if fiber_count in ("", None):
            fiber_count = None
        else:
            try:
                fiber_count = int(fiber_count)
            except (TypeError, ValueError) as exc:
                raise serializers.ValidationError("Nº de fibras deve ser um número inteiro.") from exc
            if fiber_count <= 0:
                raise serializers.ValidationError("Nº de fibras deve ser maior que zero.")
        aliases = value.get("aliases") or []
        if isinstance(aliases, str):
            aliases = [alias for alias in aliases.split(";")]
        aliases = [str(alias).strip() for alias in aliases if str(alias).strip()]
        return {
            "code": code,
            "name": name,
            "medium": medium,
            "fiber_count": fiber_count,
            "connector_a": str(value.get("connector_a") or "").strip(),
            "connector_b": str(value.get("connector_b") or "").strip(),
            "manufacturer": str(value.get("manufacturer") or "").strip(),
            "part_number": str(value.get("part_number") or "").strip(),
            "aliases": aliases,
        }


class CableImportSerializer(serializers.ModelSerializer):
    items = CableImportItemSerializer(many=True, read_only=True)

    class Meta:
        model = CableImport
        fields = (
            "id",
            "title",
            "source_text",
            "status",
            "total_models",
            "total_created",
            "items",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "status", "total_models", "total_created", "items", "created_at", "updated_at")

import json

from django import forms
from django.contrib import admin
from django.contrib.admin.widgets import AutocompleteSelect
from django.db import models
from django.template.response import TemplateResponse
from django.urls import path, reverse
from unfold.admin import ModelAdmin, TabularInline
from .access_scope import (
    deny_if_client_scoped,
    get_scope_for_user,
    is_client_scoped,
    scope_category_queryset,
    scope_client_queryset,
    scope_site_queryset,
    user_can_access_category,
)
from .admin_mixins import CSVImportExportMixin, SelectablePageSizeAdminMixin
from .models import (
    Category,
    Client,
    Collaborator,
    Company,
    JobTitle,
    Notification,
    Person,
    ConsultimerProjectType,
    ProjectType,
    Region,
    Responsible,
    Site,
    Task,
    get_or_create_person,
    update_person,
)


def _person_user_field(help_text=""):
    """Campo 'Usuário vinculado' com autocomplete, reaproveitado nos
    formulários de Colaborador/Responsável — edita Person.user por baixo,
    sem expor o cadastro de Pessoa separadamente. Precisa ser declarado no
    corpo da classe do form (não dentro de __init__): o Django Admin valida
    os campos de `fields`/`fieldsets` contra `form.base_fields`, que só é
    montado a partir dos atributos definidos na hora da classe ser criada."""
    from users.models import User

    return forms.ModelChoiceField(
        label="Usuário vinculado",
        queryset=User.objects.all(),
        required=False,
        help_text=help_text,
        widget=AutocompleteSelect(Person._meta.get_field("user"), admin.site),
    )


class PhoneMaskAdminMixin:
    class Media:
        js = ("core/js/phone-mask.js",)


class DenyClientScopedAdminMixin:
    """Nega acesso total no Admin a um usuário-cliente (User.client
    preenchido) — para cadastros internos (Empresas, Colaboradores, Cargos,
    Responsáveis, Tipos de Projeto, Tarefas do catálogo) que não fazem
    sentido para o portal do cliente. Mesma regra de core/access_scope.py
    aplicada pela API (ver deny_if_client_scoped)."""

    def get_queryset(self, request):
        return deny_if_client_scoped(super().get_queryset(request), request.user)

    def _client_scoped(self, request):
        return is_client_scoped(request.user)

    def has_view_permission(self, request, obj=None):
        return super().has_view_permission(request, obj) and not self._client_scoped(request)

    def has_change_permission(self, request, obj=None):
        return super().has_change_permission(request, obj) and not self._client_scoped(request)

    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and not self._client_scoped(request)

    def has_add_permission(self, request):
        return super().has_add_permission(request) and not self._client_scoped(request)


@admin.register(Company)
class CompanyAdmin(DenyClientScopedAdminMixin, CSVImportExportMixin, PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("legal_name", "trade_name", "tax_id", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("legal_name", "trade_name", "tax_id")
    readonly_fields = ("created_at", "updated_at")


class CompanyScopedAdmin(CSVImportExportMixin, PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_filter = ("company", "is_active")
    readonly_fields = ("created_at", "updated_at")


@admin.register(Region)
class RegionAdmin(ModelAdmin):
    list_display = ("code", "name", "country", "is_active")
    list_filter = ("country", "is_active")
    search_fields = ("code", "name")


@admin.register(Site)
class SiteAdmin(CSVImportExportMixin, PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    change_list_template = "admin/core/site/change_list.html"

    def get_queryset(self, request):
        return scope_site_queryset(super().get_queryset(request), request.user)

    def _site_accessible(self, request, obj):
        if obj is None:
            return True
        scope = get_scope_for_user(request.user)
        if scope is None:
            return True
        if scope["clients"] is not None and obj.client_id not in scope["clients"]:
            return False
        if scope["sites"] is not None and obj.id not in scope["sites"]:
            return False
        return True

    def has_view_permission(self, request, obj=None):
        return super().has_view_permission(request, obj) and self._site_accessible(request, obj)

    def has_change_permission(self, request, obj=None):
        return super().has_change_permission(request, obj) and self._site_accessible(request, obj)

    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and self._site_accessible(request, obj)
    list_display = ("code", "name", "client", "city", "state", "region", "geocode_status", "is_active")
    list_filter = ("client", "region", "is_active")
    search_fields = ("code", "name", "city")
    autocomplete_fields = ("client", "region")
    readonly_fields = ("created_at", "updated_at")
    actions = ("regeocode_selected",)
    fieldsets = (
        (None, {"fields": ("client", "name", "code", "is_active")}),
        ("Endereço", {"fields": ("address", "city", "state")}),
        (
            "Geolocalização",
            {
                "fields": ("manual_coordinates", "latitude", "longitude"),
                "description": (
                    "Por padrão, latitude/longitude são preenchidas automaticamente a partir do endereço "
                    "(via OpenStreetMap/Nominatim) ao salvar. Marque \"coordenadas manuais\" para digitar "
                    "os valores você mesmo — nesse caso a geocodificação automática não roda."
                ),
            },
        ),
        ("Auditoria", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    @admin.display(description="Geolocalização")
    def geocode_status(self, obj):
        if obj.latitude is None or obj.longitude is None:
            return "Sem coordenadas"
        return "Manual" if obj.manual_coordinates else "Localizado"

    def get_search_results(self, request, queryset, search_term):
        queryset, use_distinct = super().get_search_results(request, queryset, search_term)
        if request.GET.get("field_name") == "site":
            client_id = request.GET.get("client_id")
            queryset = queryset.filter(client_id=client_id) if client_id else queryset.none()
        return queryset, use_distinct

    @admin.action(description="Reprocessar geocodificação (endereço → coordenadas)")
    def regeocode_selected(self, request, queryset):
        import time

        updated = 0
        skipped_manual = 0
        failed = 0
        candidates = list(queryset.exclude(manual_coordinates=True))
        skipped_manual = queryset.filter(manual_coordinates=True).count()
        for index, site in enumerate(candidates):
            if index:
                time.sleep(1)  # respeita o limite de 1 req/s do Nominatim
            site.geocoded_address = ""
            site.save()
            site.refresh_from_db()
            if site.latitude is not None and site.longitude is not None:
                updated += 1
            else:
                failed += 1
        message = f"{updated} site(s) geocodificado(s) com sucesso."
        if failed:
            message += f" {failed} não foram encontrados pelo serviço de geocodificação."
        if skipped_manual:
            message += f" {skipped_manual} ignorado(s) por ter coordenadas manuais."
        self.message_user(request, message)

    def get_urls(self):
        return [
            path(
                "mapa/",
                self.admin_site.admin_view(self.map_view),
                name="core_site_map",
            )
        ] + super().get_urls()

    def map_view(self, request):
        from projects.models import Project

        sites = (
            self.get_queryset(request)
            .filter(is_active=True, latitude__isnull=False, longitude__isnull=False)
            .select_related("client")
        )
        active_projects = (
            Project.objects.filter(site__in=sites, status=Project.STATUS_IN_PROGRESS)
            .select_related("client", "site")
            .order_by("name")
        )
        projects_by_site = {}
        for project in active_projects:
            projects_by_site.setdefault(project.site_id, []).append(
                {
                    "code": project.code,
                    "name": project.name,
                    "client": str(project.client) if project.client_id else "",
                    "url": reverse("admin:projects_project_change", args=[project.pk]),
                }
            )

        points = [
            {
                "name": str(site),
                "client": str(site.client) if site.client_id else "",
                "address": site.full_address,
                "lat": float(site.latitude),
                "lng": float(site.longitude),
                "projects": projects_by_site.get(site.pk, []),
            }
            for site in sites
        ]
        without_coords = self.get_queryset(request).filter(is_active=True).filter(
            models.Q(latitude__isnull=True) | models.Q(longitude__isnull=True)
        ).count()
        context = {
            **self.admin_site.each_context(request),
            "title": "Mapa de Sites",
            "points_json": json.dumps(points),
            "points_count": len(points),
            "without_coords": without_coords,
            "opts": self.model._meta,
        }
        return TemplateResponse(request, "admin/core/site/map.html", context)


class CollaboratorAdminForm(forms.ModelForm):
    name = forms.CharField(label="Nome", required=False)
    email = forms.EmailField(label="E-mail", required=False)
    phone = forms.CharField(label="Telefone", required=False)
    company = forms.ModelChoiceField(label="Empresa", queryset=Company.objects.all())
    user = _person_user_field("Vincule um usuário para este técnico acessar Minhas Tarefas.")

    class Meta:
        model = Collaborator
        fields = ("registration", "yellow_badge", "job_title", "manager", "sites", "is_active")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk and self.instance.person_id:
            person = self.instance.person
            self.fields["name"].initial = person.name
            self.fields["email"].initial = person.email
            self.fields["phone"].initial = person.phone
            self.fields["company"].initial = person.company_id
            self.fields["user"].initial = person.user_id

    def save(self, commit=True):
        instance = super().save(commit=False)
        data = self.cleaned_data
        if instance.person_id:
            update_person(
                instance.person,
                name=data.get("name"), email=data.get("email"), phone=data.get("phone"),
                company=data.get("company"), user=data.get("user"), has_user=True,
            )
        else:
            instance.person = get_or_create_person(
                name=data.get("name"), email=data.get("email"),
                phone=data.get("phone"), company=data.get("company"),
            )
            if data.get("user"):
                update_person(instance.person, user=data.get("user"), has_user=True)
        if commit:
            instance.save()
            self.save_m2m()
        return instance


@admin.register(Collaborator)
class CollaboratorAdmin(DenyClientScopedAdminMixin, CSVImportExportMixin, PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    form = CollaboratorAdminForm
    list_display = ("registration", "yellow_badge", "person_name", "job_title", "manager", "person_company", "person_email", "is_active")
    list_filter = ("person__company", "is_active")
    search_fields = (
        "registration",
        "yellow_badge",
        "person__name",
        "job_title__name",
        "manager__person__name",
        "person__email",
        "person__user__username",
        "person__user__email",
    )
    autocomplete_fields = ("job_title", "manager")
    filter_horizontal = ("sites",)
    fields = ("name", "email", "phone", "company", "user", "registration", "yellow_badge", "job_title", "manager", "sites", "is_active", "created_at", "updated_at")
    readonly_fields = ("created_at", "updated_at")

    class Media:
        js = ("core/js/phone-mask.js", "core/js/collaborator-manager-filter.js")

    @admin.display(description="Nome", ordering="person__name")
    def person_name(self, obj):
        return obj.person.name if obj.person_id else "—"

    @admin.display(description="E-mail", ordering="person__email")
    def person_email(self, obj):
        return obj.person.email if obj.person_id else "—"

    @admin.display(description="Empresa", ordering="person__company")
    def person_company(self, obj):
        return obj.person.company if obj.person_id else None

    def get_search_results(self, request, queryset, search_term):
        queryset, use_distinct = super().get_search_results(request, queryset, search_term)
        if request.GET.get("field_name") == "manager":
            company_id = request.GET.get("company_id")
            queryset = queryset.filter(person__company_id=company_id) if company_id else queryset.none()
        return queryset, use_distinct


@admin.register(JobTitle)
class JobTitleAdmin(DenyClientScopedAdminMixin, CompanyScopedAdmin):
    list_display = ("name", "company", "is_active", "updated_at")
    search_fields = ("name", "description")


class ResponsibleAdminForm(forms.ModelForm):
    name = forms.CharField(label="Nome", required=False)
    email = forms.EmailField(label="E-mail", required=False)
    phone = forms.CharField(label="Telefone", required=False)
    company = forms.ModelChoiceField(
        label="Empresa (CSTR)", queryset=Company.objects.all(), required=False,
        help_text="Obrigatório quando Tipo = CSTR.",
    )
    user = _person_user_field("Vincule um usuário a este responsável, se fizer sentido.")

    class Meta:
        model = Responsible
        fields = ("kind", "client", "job_title", "is_active")
        help_texts = {"client": "Obrigatório quando Tipo = Cliente."}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk and self.instance.person_id:
            person = self.instance.person
            self.fields["name"].initial = person.name
            self.fields["email"].initial = person.email
            self.fields["phone"].initial = person.phone
            self.fields["company"].initial = person.company_id
            self.fields["user"].initial = person.user_id

    def save(self, commit=True):
        instance = super().save(commit=False)
        data = self.cleaned_data
        if instance.person_id:
            update_person(
                instance.person,
                name=data.get("name"), email=data.get("email"), phone=data.get("phone"),
                company=data.get("company"), user=data.get("user"), has_user=True,
            )
        else:
            instance.person = get_or_create_person(
                name=data.get("name"), email=data.get("email"),
                phone=data.get("phone"), company=data.get("company"),
            )
            if data.get("user"):
                update_person(instance.person, user=data.get("user"), has_user=True)
        if commit:
            instance.save()
        return instance


@admin.register(Responsible)
class ResponsibleAdmin(CSVImportExportMixin, PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    """Responsável unificado — o campo Tipo decide se é CSTR (usa Empresa)
    ou Cliente (usa Cliente + Cargo). Substitui os antigos cadastros
    separados 'Responsáveis' e 'Responsáveis do Cliente'."""

    form = ResponsibleAdminForm
    list_display = ("person_name", "kind", "person_company", "client", "person_email", "is_active")
    list_filter = ("kind", "person__company", "client", "is_active")
    search_fields = (
        "person__name",
        "person__email",
        "person__phone",
        "person__user__username",
        "person__user__email",
        "client__legal_name",
        "client__trade_name",
        "job_title",
    )
    autocomplete_fields = ("client",)
    readonly_fields = ("created_at", "updated_at")
    fields = ("kind", "name", "email", "phone", "company", "client", "job_title", "user", "is_active", "created_at", "updated_at")

    class Media:
        js = ("core/js/phone-mask.js", "core/js/collaborator-manager-filter.js")

    @admin.display(description="Nome", ordering="person__name")
    def person_name(self, obj):
        return obj.person.name if obj.person_id else "—"

    @admin.display(description="Empresa", ordering="person__company")
    def person_company(self, obj):
        return obj.person.company if obj.person_id else None

    @admin.display(description="E-mail", ordering="person__email")
    def person_email(self, obj):
        return obj.person.email if obj.person_id else "—"

    def get_queryset(self, request):
        return scope_client_queryset(super().get_queryset(request), request.user, client_field="client_id")

    def _accessible(self, request, obj):
        """Usuário-cliente só acessa Responsáveis (kind=client) do próprio
        Cliente — os de kind=cstr têm client_id nulo, então nunca batem no
        escopo. Equipe interna (scope None) acessa tudo normalmente.
        Gestores com escopo de site (clients=None) são equipe interna —
        acessam todos os Responsáveis."""
        if obj is None:
            return True
        scope = get_scope_for_user(request.user)
        if scope is None:
            return True
        if scope["clients"] is None:
            return True
        return obj.client_id in scope["clients"]

    def has_view_permission(self, request, obj=None):
        return super().has_view_permission(request, obj) and self._accessible(request, obj)

    def has_change_permission(self, request, obj=None):
        return super().has_change_permission(request, obj) and self._accessible(request, obj)

    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and self._accessible(request, obj)

    def get_search_results(self, request, queryset, search_term):
        queryset, use_distinct = super().get_search_results(request, queryset, search_term)
        if request.GET.get("field_name") == "responsible_client":
            client_id = request.GET.get("client_id")
            queryset = queryset.filter(client_id=client_id, is_active=True) if client_id else queryset.none()
        if request.GET.get("field_name") == "responsible_cstr":
            queryset = queryset.filter(kind=Responsible.KIND_CSTR)
        return queryset, use_distinct


@admin.register(Category)
class CategoryAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("name", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "description")
    readonly_fields = ("created_at", "updated_at")

    def get_queryset(self, request):
        return scope_category_queryset(super().get_queryset(request), request.user)

    def has_view_permission(self, request, obj=None):
        return super().has_view_permission(request, obj) and user_can_access_category(request.user, obj)

    def has_change_permission(self, request, obj=None):
        return super().has_change_permission(request, obj) and user_can_access_category(request.user, obj)

    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and user_can_access_category(request.user, obj)


class ProjectTypeAdminForm(forms.ModelForm):
    bulk_names = forms.CharField(
        label="Adicionar Vários",
        required=False,
        widget=forms.Textarea(attrs={"rows": 8, "placeholder": "Digite ou cole um nome por linha"}),
        help_text="Cada linha será cadastrada como um Tipo de Projeto separado, usando a mesma descrição.",
    )

    class Meta:
        model = ProjectType
        fields = "__all__"

    def clean(self):
        cleaned_data = super().clean()
        names = list(dict.fromkeys(line.strip() for line in cleaned_data.get("bulk_names", "").splitlines() if line.strip()))
        current_name = cleaned_data.get("name", "").strip()
        if names and not current_name:
            current_name = names.pop(0)
            cleaned_data["name"] = current_name
            self.instance.name = current_name
        self.additional_names = [name for name in names if name != current_name]
        return cleaned_data


@admin.register(ConsultimerProjectType)
class ConsultimerProjectTypeAdmin(DenyClientScopedAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("name", "code", "is_active")
    list_display_links = ("name",)
    list_filter = ("is_active",)
    search_fields = ("name", "code", "description")
    readonly_fields = ("created_at", "updated_at")


@admin.register(ProjectType)
class ProjectTypeAdmin(DenyClientScopedAdminMixin, CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    form = ProjectTypeAdminForm
    list_display = ("name", "is_active")
    list_display_links = ("name",)
    list_filter = ("is_active",)
    search_fields = ("name", "description")
    readonly_fields = ("created_at", "updated_at")
    fields = ("name", "bulk_names", "description", "is_active", "created_at", "updated_at")

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        created = 0
        for name in getattr(form, "additional_names", []):
            _, was_created = ProjectType.objects.get_or_create(
                name=name,
                defaults={
                    "description": obj.description,
                    "is_active": obj.is_active,
                },
            )
            created += int(was_created)
        if created:
            self.message_user(request, f"{created} tipo(s) de projeto adicional(is) cadastrado(s).")


class TaskAdminForm(forms.ModelForm):
    bulk_names = forms.CharField(
        label="Adicionar Várias",
        required=False,
        widget=forms.Textarea(attrs={"rows": 8, "placeholder": "Digite ou cole o nome de uma tarefa por linha"}),
        help_text="Cada linha será cadastrada como uma Tarefa separada, com código automático e os mesmos dados complementares.",
    )

    class Meta:
        model = Task
        fields = "__all__"

    def clean(self):
        cleaned_data = super().clean()
        names = list(dict.fromkeys(line.strip() for line in cleaned_data.get("bulk_names", "").splitlines() if line.strip()))
        current_name = cleaned_data.get("name", "").strip()
        if names and not current_name:
            current_name = names.pop(0)
            cleaned_data["name"] = current_name
            self.instance.name = current_name
        self.additional_names = [name for name in names if name != current_name]
        return cleaned_data


@admin.register(Task)
class TaskAdmin(DenyClientScopedAdminMixin, CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    form = TaskAdminForm
    list_display = ("code", "name", "project_types_display", "estimated_hours", "is_active")
    list_display_links = ("code", "name")
    list_filter = ("is_active", "project_types")
    search_fields = ("code", "name", "description", "project_types__name")
    filter_horizontal = ("project_types",)
    readonly_fields = ("code", "created_at", "updated_at")
    fields = ("code", "name", "bulk_names", "description", "estimated_hours", "project_types", "is_active", "created_at", "updated_at")

    @admin.display(description="Tipos de Projeto")
    def project_types_display(self, obj):
        names = [project_type.name for project_type in obj.project_types.all()]
        return ", ".join(names) if names else "-"

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("project_types")

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        created = 0
        project_types = form.cleaned_data.get("project_types", [])
        for name in getattr(form, "additional_names", []):
            task = Task.objects.create(
                name=name,
                description=form.instance.description,
                estimated_hours=form.instance.estimated_hours,
                is_active=form.instance.is_active,
            )
            task.project_types.set(project_types)
            created += 1
        if created:
            self.message_user(request, f"{created} tarefa(s) adicional(is) cadastrada(s) com códigos automáticos.")


@admin.register(Client)
class ClientAdmin(CompanyScopedAdmin):
    list_display = ("legal_name", "trade_name", "tax_id", "company", "city", "state", "is_active")
    list_filter = ("company", "person_type", "state", "is_active")
    search_fields = ("legal_name", "trade_name", "tax_id", "email", "phone")
    inlines = ()

    def get_queryset(self, request):
        return scope_client_queryset(super().get_queryset(request), request.user)

    def _client_accessible(self, request, obj):
        if obj is None:
            return True
        scope = get_scope_for_user(request.user)
        if scope is None:
            return True
        if scope["clients"] is None:
            return True
        return obj.id in scope["clients"]

    def has_view_permission(self, request, obj=None):
        return super().has_view_permission(request, obj) and self._client_accessible(request, obj)

    def has_change_permission(self, request, obj=None):
        return super().has_change_permission(request, obj) and self._client_accessible(request, obj)

    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and self._client_accessible(request, obj)


class ResponsibleClientInlineForm(forms.ModelForm):
    """Inline de Responsável (Tipo=Cliente) dentro da tela de Cliente —
    'client' e 'kind' vêm implícitos do contexto, não aparecem no form."""

    name = forms.CharField(label="Nome", required=False)
    email = forms.EmailField(label="E-mail", required=False)
    phone = forms.CharField(label="Telefone", required=False)

    class Meta:
        model = Responsible
        fields = ("job_title", "is_active")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk and self.instance.person_id:
            person = self.instance.person
            self.fields["name"].initial = person.name
            self.fields["email"].initial = person.email
            self.fields["phone"].initial = person.phone

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.kind = Responsible.KIND_CLIENT
        data = self.cleaned_data
        if instance.person_id:
            update_person(instance.person, name=data.get("name"), email=data.get("email"), phone=data.get("phone"))
        else:
            instance.person = get_or_create_person(name=data.get("name"), email=data.get("email"), phone=data.get("phone"))
        if commit:
            instance.save()
        return instance


class ResponsibleClientInline(TabularInline):
    model = Responsible
    fk_name = "client"
    form = ResponsibleClientInlineForm
    extra = 0
    fields = ("name", "email", "phone", "job_title", "is_active")
    verbose_name = "Responsável do Cliente"
    verbose_name_plural = "Responsáveis do Cliente"

    def get_queryset(self, request):
        return super().get_queryset(request).filter(kind=Responsible.KIND_CLIENT)

    class Media:
        js = ("core/js/phone-mask.js",)


ClientAdmin.inlines = (ResponsibleClientInline,)


@admin.register(Notification)
class NotificationAdmin(ModelAdmin):
    list_display = ("user", "title", "project_code", "is_read", "created_at")
    list_filter = ("is_read",)
    search_fields = ("user__username", "title", "message", "project_code")
    readonly_fields = ("user", "title", "message", "url", "project_id", "project_code", "is_read", "created_at", "updated_at")

    def has_add_permission(self, request):
        return False

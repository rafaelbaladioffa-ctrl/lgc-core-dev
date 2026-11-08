from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin_mixins import CSVImportExportMixin, SelectablePageSizeAdminMixin

from .models import (
    Activity,
    CableAlias,
    CableFamily,
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
    Site,
    SowImport,
    SowParsedItem,
    TaskTemplate,
    TaskTemplateRule,
    TaskTemplateStep,
    Workstream,
)


class CableAliasInline(admin.TabularInline):
    model = CableAlias
    extra = 1
    fields = ("alias", "alias_type", "active")


class CableSpecInline(admin.TabularInline):
    model = CableSpec
    extra = 0
    fields = ("code", "name", "manufacturer", "part_number", "active")
    show_change_link = True


@admin.register(CableFamily)
class CableFamilyAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "medium", "fiber_count", "cable_category", "active", "updated_at")
    list_filter = ("medium", "active", "preterminated")
    search_fields = ("code", "name", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")
    inlines = [CableAliasInline, CableSpecInline]

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(CableSpec)
class CableSpecAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "cable_family", "part_number", "manufacturer", "active", "updated_at")
    list_filter = ("fiber_type", "polarity", "active")
    search_fields = ("code", "name", "part_number", "manufacturer", "cable_family__code", "cable_family__name")
    autocomplete_fields = ("cable_family",)
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(CableAlias)
class CableAliasAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("alias", "cable_family", "alias_type", "active", "updated_at")
    list_filter = ("alias_type", "active")
    search_fields = ("alias", "normalized_alias", "cable_family__code", "cable_family__name")
    autocomplete_fields = ("cable_family",)
    readonly_fields = ("normalized_alias", "created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(CertificationType)
class CertificationTypeAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "medium", "method", "requires_report", "requires_attachment", "active", "updated_at")
    list_filter = ("medium", "active", "requires_report", "requires_attachment")
    search_fields = ("code", "name", "method", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(Activity)
class ActivityAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "category", "execution_type", "default_unit", "measurable", "active", "updated_at")
    list_filter = ("category", "execution_type", "measurable", "active")
    search_fields = ("code", "name", "category", "execution_type", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(Network)
class NetworkAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "domain", "medium", "active", "updated_at")
    list_filter = ("domain", "medium", "active")
    search_fields = ("code", "name", "domain", "medium", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(Workstream)
class WorkstreamAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "category", "default_medium", "active", "updated_at")
    list_filter = ("category", "default_medium", "active")
    search_fields = ("code", "name", "category", "default_medium", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(Path)
class PathAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "path_group", "path_type", "active", "updated_at")
    list_filter = ("path_group", "path_type", "active")
    search_fields = ("code", "name", "path_group", "path_type", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(Site)
class MasterDataSiteAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "city", "state", "country", "site_type", "active", "updated_at")
    list_filter = ("site_type", "country", "state", "active")
    search_fields = ("code", "name", "city", "state", "country", "site_type", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(Location)
class LocationAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "canonical_address", "site", "location_type", "room", "row", "active", "updated_at")
    list_filter = ("location_type", "room", "active")
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
    autocomplete_fields = ("site",)
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(DeviceType)
class DeviceTypeAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "category", "default_medium", "active", "updated_at")
    list_filter = ("category", "default_medium", "active")
    search_fields = ("code", "name", "category", "default_medium", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


class TaskTemplateStepInline(admin.TabularInline):
    model = TaskTemplateStep
    fk_name = "task_template"
    extra = 0
    fields = ("step_order", "activity", "name_override", "required", "repeatable", "quantity_source", "unit_override", "active")
    autocomplete_fields = ("activity",)
    ordering = ("step_order",)


@admin.register(TaskTemplate)
class TaskTemplateAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "category", "medium", "active", "updated_at")
    list_filter = ("category", "medium", "active")
    search_fields = ("code", "name", "category", "medium", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")
    inlines = [TaskTemplateStepInline]

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(TaskTemplateStep)
class TaskTemplateStepAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("task_template", "step_order", "activity", "effective_name_display", "required", "repeatable", "active", "updated_at")
    list_filter = ("required", "repeatable", "active")
    search_fields = (
        "activity__code",
        "activity__name",
        "task_template__code",
        "task_template__name",
        "name_override",
        "description",
    )
    autocomplete_fields = ("task_template", "activity")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def effective_name_display(self, obj):
        return obj.effective_name

    effective_name_display.short_description = "nome efetivo"

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(GeneratedTask)
class GeneratedTaskAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "code",
        "scope_item",
        "step_order",
        "activity",
        "name",
        "path",
        "expansion_key",
        "quantity",
        "unit",
        "status",
        "generation_source",
        "active",
        "updated_at",
    )
    list_filter = ("status", "generation_source", "expansion_key", "active")
    search_fields = (
        "code",
        "name",
        "scope_item__code",
        "scope_item__raw_text",
        "activity__code",
        "activity__name",
        "task_template__code",
    )
    autocomplete_fields = ("scope_item", "task_template", "task_template_step", "activity", "path")
    readonly_fields = (
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "scope_item",
        "task_template",
        "task_template_step",
        "activity",
        "path",
        "step_order",
        "required",
        "repeatable",
        "generation_source",
        "expansion_key",
    )

    def has_add_permission(self, request):
        # Mesma decisão da API (ScopeItemViewSet.create bloqueado): nesta
        # primeira versão, GeneratedTask só é criada pelo service
        # (via "Gerar Tarefas"), nunca manualmente.
        return False

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(ScopeItemPath)
class ScopeItemPathAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("scope_item", "path", "sequence", "active", "updated_at")
    list_filter = ("active",)
    search_fields = ("scope_item__code", "path__code", "path__name")
    autocomplete_fields = ("scope_item", "path")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(GeneratedTaskDependency)
class GeneratedTaskDependencyAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "predecessor_task",
        "successor_task",
        "dependency_type",
        "lag_value",
        "lag_unit",
        "active",
        "updated_at",
    )
    list_filter = ("dependency_type", "active")
    search_fields = (
        "predecessor_task__code",
        "predecessor_task__name",
        "successor_task__code",
        "successor_task__name",
    )
    autocomplete_fields = ("predecessor_task", "successor_task")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(TaskTemplateRule)
class TaskTemplateRuleAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "code",
        "name",
        "task_template",
        "cable_family",
        "network",
        "workstream",
        "medium",
        "preterminated",
        "priority",
        "specificity_score_display",
        "active",
        "updated_at",
    )
    list_filter = ("medium", "preterminated", "active")
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
    autocomplete_fields = ("task_template", "cable_family", "cable_spec", "network", "workstream")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def specificity_score_display(self, obj):
        return obj.specificity_score

    specificity_score_display.short_description = "especificidade"

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(ScopeItem)
class ScopeItemAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "code",
        "item_type",
        "cable_family",
        "quantity",
        "length_m",
        "medium",
        "rule_resolution_status",
        "requires_review",
        "active",
        "updated_at",
    )
    list_filter = ("item_type", "medium", "rule_resolution_status", "requires_review", "active")
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
    autocomplete_fields = ("cable_family", "cable_spec", "network", "workstream", "path")
    readonly_fields = (
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "normalization_metadata",
        "resolved_rule",
        "resolved_template",
        "rule_resolution_status",
    )

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(SowImport)
class SowImportAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "code",
        "title",
        "source_type",
        "status",
        "total_items_detected",
        "total_items_approved",
        "total_items_rejected",
        "total_warnings",
        "updated_at",
    )
    list_filter = ("source_type", "status")
    search_fields = ("code", "title", "source_text")
    readonly_fields = (
        "code",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "processing_started_at",
        "processing_finished_at",
        "total_items_detected",
        "total_items_approved",
        "total_items_rejected",
        "total_warnings",
        "error_message",
    )

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(SowParsedItem)
class SowParsedItemAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "sow_import",
        "sequence",
        "item_type",
        "suggested_cable_family",
        "quantity",
        "confidence_score",
        "review_status",
        "requires_review",
        "active",
    )
    list_filter = ("item_type", "review_status", "requires_review", "active")
    search_fields = ("sow_import__code", "raw_text")
    autocomplete_fields = (
        "sow_import",
        "suggested_cable_family",
        "suggested_cable_spec",
        "suggested_network",
        "suggested_workstream",
        "suggested_paths",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "raw_text",
        "ai_raw_payload",
        "normalization_metadata",
        "approved_scope_item",
        "reviewed_by",
        "reviewed_at",
    )

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)

from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin_mixins import SelectablePageSizeAdminMixin
from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "created_at",
        "actor",
        "app_label",
        "model_name",
        "object_repr",
        "action",
        "field_name",
        "origin",
    )
    list_filter = ("action", "origin", "app_label", "model_name", "created_at")
    search_fields = ("actor__username", "actor__email", "object_repr", "object_pk", "field_name", "old_value", "new_value")
    readonly_fields = (
        "created_at",
        "actor",
        "app_label",
        "model_name",
        "object_pk",
        "object_repr",
        "action",
        "field_name",
        "old_value",
        "new_value",
        "origin",
        "path",
        "ip_address",
    )
    fieldsets = (
        ("Evento", {"fields": (("created_at", "actor"), ("action", "origin"), ("app_label", "model_name"))}),
        ("Registro", {"fields": ("object_pk", "object_repr", "field_name")}),
        ("Alteração", {"fields": (("old_value", "new_value"),)}),
        ("Requisição", {"fields": ("path", "ip_address"), "classes": ("collapse",)}),
    )
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser if obj is None else False

    def has_delete_permission(self, request, obj=None):
        return False

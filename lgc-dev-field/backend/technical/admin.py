from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin_mixins import SelectablePageSizeAdminMixin
from core.models import get_collaborator_role

from .models import MyTask


@admin.register(MyTask)
class MyTaskAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "project",
        "task",
        "status",
        "planned_start",
        "planned_end",
        "actual_start",
        "actual_end",
    )
    list_filter = ("status",)
    search_fields = ("project__code", "project__name", "task__name", "custom_name")
    readonly_fields = ("project", "task", "planned_start", "planned_end", "estimated_hours")
    fields = (
        "project",
        "task",
        "planned_start",
        "planned_end",
        "status",
        "actual_start",
        "actual_end",
        "estimated_hours",
        "actual_hours",
        "notes",
    )

    def get_queryset(self, request):
        queryset = super().get_queryset(request).select_related("project", "task")
        collaborator = get_collaborator_role(request.user)
        if collaborator is None:
            return queryset.none()
        return queryset.filter(collaborators=collaborator)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        if obj is None:
            return super().has_change_permission(request, obj)
        collaborator = get_collaborator_role(request.user)
        if collaborator is None:
            return False
        return obj.collaborators.filter(pk=collaborator.pk).exists() and super().has_change_permission(request, obj)

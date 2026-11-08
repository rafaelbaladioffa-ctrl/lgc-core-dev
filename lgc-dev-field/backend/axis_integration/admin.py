from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import AxisInboxEvent, AxisMasterRecord


class ReadOnlyAdmin(ModelAdmin):
    """Só consulta: estes registros são escritos pela integração, nunca à mão."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AxisInboxEvent)
class AxisInboxEventAdmin(ReadOnlyAdmin):
    list_display = ("event_type", "status", "occurred_at", "received_at", "attempts", "note")
    list_filter = ("status", "event_type")
    search_fields = ("event_id", "event_type")


@admin.register(AxisMasterRecord)
class AxisMasterRecordAdmin(ReadOnlyAdmin):
    list_display = ("kind", "code", "name", "active", "axis_id", "synced_at")
    list_filter = ("kind", "active")
    search_fields = ("axis_id", "code", "name")

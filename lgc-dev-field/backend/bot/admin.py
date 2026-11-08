from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin import PhoneMaskAdminMixin
from core.admin_mixins import SelectablePageSizeAdminMixin

from .models import BotMessageTemplate, BotSubscriber


@admin.register(BotSubscriber)
class BotSubscriberAdmin(PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "name",
        "phone",
        "group_jid",
        "receives_daily_tasks",
        "receives_project_updates",
        "receives_daily_project_report",
        "receives_operations_print",
        "is_active",
    )
    list_filter = (
        "is_active",
        "receives_daily_tasks",
        "receives_project_updates",
        "receives_daily_project_report",
        "receives_operations_print",
    )
    search_fields = ("name", "phone")


@admin.register(BotMessageTemplate)
class BotMessageTemplateAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("message_type", "title", "is_active", "updated_at")
    list_filter = ("message_type", "is_active")
    search_fields = ("title", "intro_text", "footer_text")

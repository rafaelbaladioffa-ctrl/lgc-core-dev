from django.urls import include, path
from rest_framework.routers import SimpleRouter

from . import views
from .operations_print import OperationsPrintView
from .project_report_print import ProjectReportPrintView
from .rules import BotBroadcastRuleViewSet, BotRuleBroadcastView, BotMenuTestView, BotRulesScheduleView, BotSubscriberViewSet

router = SimpleRouter()
router.register("broadcast-rules", BotBroadcastRuleViewSet, basename="bot-broadcast-rule")
router.register("subscribers", BotSubscriberViewSet, basename="bot-subscriber")

urlpatterns = [
    path("message-templates/test-menu/", BotMenuTestView.as_view(), name="bot-menu-test"),
    path("", include(router.urls)),
    path("broadcasts/rules/", BotRulesScheduleView.as_view(), name="bot-broadcast-rules-schedule"),
    path("broadcasts/rule/<int:pk>/", BotRuleBroadcastView.as_view(), name="bot-broadcast-rule"),
    path("operations-print/", OperationsPrintView.as_view(), name="bot-operations-print"),
    path("daily-project-report-print/", ProjectReportPrintView.as_view(), name="bot-daily-project-report-print"),
    path("allocation/", views.BotAllocationView.as_view(), name="bot-allocation"),
    path("daily-broadcast/", views.BotDailyBroadcastView.as_view(), name="bot-daily-broadcast"),
    path("my-tasks/", views.BotMyTasksView.as_view(), name="bot-my-tasks"),
    path("sites/", views.BotSitesView.as_view(), name="bot-sites"),
    path("tech-status/sites/", views.BotTechStatusSitesView.as_view(), name="bot-tech-status-sites"),
    path("tech-status/", views.BotTechStatusView.as_view(), name="bot-tech-status"),
    path("projects/", views.BotProjectsView.as_view(), name="bot-projects"),
    path("project-update/", views.BotProjectUpdateView.as_view(), name="bot-project-update"),
    path("message-templates/", views.BotMessageTemplatesView.as_view(), name="bot-message-templates"),
    path("message-templates/preview/", views.BotMessageTemplatePreviewView.as_view(), name="bot-message-template-preview"),
    path("message-template/", views.BotMessageTemplateRuntimeView.as_view(), name="bot-message-template-runtime"),
    path(
        "broadcasts/daily-tasks/",
        views.BotDailyTasksBroadcastView.as_view(),
        name="bot-broadcast-daily-tasks",
    ),
    path(
        "broadcasts/project-updates/",
        views.BotProjectUpdatesBroadcastView.as_view(),
        name="bot-broadcast-project-updates",
    ),
    path(
        "broadcasts/operations-print-recipients/",
        views.BotOperationsPrintRecipientsView.as_view(),
        name="bot-broadcast-operations-print-recipients",
    ),
    path(
        "broadcasts/daily-project-report/",
        views.BotDailyProjectReportBroadcastView.as_view(),
        name="bot-broadcast-daily-project-report",
    ),
]

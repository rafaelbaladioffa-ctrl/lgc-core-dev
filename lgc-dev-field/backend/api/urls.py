from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views
from .auth_views import LogoutView, ThrottledTokenObtainPairView, ThrottledTokenRefreshView
from .dashboard import ProjectsPerformanceView, TechnicalPerformanceView
from .adjustments import (
    AdjustmentHistoryView,
    AdjustmentTasksView,
    ExecutionAdjustmentView,
    ExecutionRemovalView,
    StatusEventsAdjustmentView,
    StatusWindowAdjustmentView,
)
from .work_blocks import WorkBlockSuggestionView, WorkBlockView
from .operations import (
    OperationsBlockTimesView,
    OperationsBoardView,
    OperationsManagementReportView,
    OperationsReportsView,
    OperationsTimelineView,
)
from .indicators import IndicatorsBreakdownView, IndicatorsProductionView, IndicatorsTrendsView
from .sites_panel import SitesPanelView

router = DefaultRouter()
router.register("projects", views.ProjectViewSet, basename="project")
router.register("project-tasks", views.ProjectTaskViewSet, basename="project-task")
router.register("rack-positions", views.RackPositionViewSet, basename="rack-position")
router.register("project-occurrences", views.ProjectOccurrenceViewSet, basename="project-occurrence")
router.register("project-attachments", views.ProjectAttachmentViewSet, basename="project-attachment")
router.register("notifications", views.NotificationViewSet, basename="notification")
router.register("push-subscriptions", views.PushSubscriptionViewSet, basename="push-subscription")
router.register("regions", views.RegionViewSet, basename="region")
router.register("clients", views.ClientViewSet, basename="client")
router.register("sites", views.SiteViewSet, basename="site")
router.register("collaborators", views.CollaboratorViewSet, basename="collaborator")
router.register("daily-updates", views.DailyUpdateViewSet, basename="daily-update")
router.register("project-updates", views.ProjectDailyUpdateViewSet, basename="project-update")
router.register("my-tasks", views.MyTaskViewSet, basename="my-task")
router.register("technician-presence", views.TechnicianPresenceViewSet, basename="technician-presence")
router.register("technician-absences", views.TechnicianAbsenceViewSet, basename="technician-absence")
router.register("audit-logs", views.AuditLogViewSet, basename="audit-log")
router.register("registry/companies", views.CompanyViewSet, basename="registry-company")
router.register("registry/categories", views.CategoryViewSet, basename="registry-category")
router.register("registry/project-types", views.ProjectTypeViewSet, basename="registry-project-type")
router.register("registry/consultimer-project-types", views.ConsultimerProjectTypeViewSet, basename="registry-consultimer-project-type")
router.register("registry/job-titles", views.JobTitleViewSet, basename="registry-job-title")
router.register("registry/sites", views.SiteRegistryViewSet, basename="registry-site")
router.register("registry/clients", views.ClientRegistryViewSet, basename="registry-client")
router.register("registry/responsibles", views.ResponsibleViewSet, basename="registry-responsible")
router.register("registry/collaborators", views.CollaboratorRegistryViewSet, basename="registry-collaborator")
router.register("registry/tasks", views.TaskViewSet, basename="registry-task")
router.register("master-data/cable-families", views.CableFamilyViewSet, basename="master-data-cable-family")
router.register("master-data/cable-aliases", views.CableAliasViewSet, basename="master-data-cable-alias")
router.register("master-data/cable-specs", views.CableSpecViewSet, basename="master-data-cable-spec")
router.register("master-data/certification-types", views.CertificationTypeViewSet, basename="master-data-certification-type")
router.register("master-data/activities", views.ActivityViewSet, basename="master-data-activity")
router.register("master-data/networks", views.NetworkViewSet, basename="master-data-network")
router.register("master-data/workstreams", views.WorkstreamViewSet, basename="master-data-workstream")
router.register("master-data/paths", views.PathViewSet, basename="master-data-path")
router.register("master-data/sites", views.MasterDataSiteViewSet, basename="master-data-site")
router.register("master-data/locations", views.LocationViewSet, basename="master-data-location")
router.register("master-data/device-types", views.DeviceTypeViewSet, basename="master-data-device-type")
router.register("master-data/task-templates", views.TaskTemplateViewSet, basename="master-data-task-template")
router.register("master-data/task-template-steps", views.TaskTemplateStepViewSet, basename="master-data-task-template-step")
router.register("master-data/task-template-rules", views.TaskTemplateRuleViewSet, basename="master-data-task-template-rule")
router.register("master-data/scope-items", views.ScopeItemViewSet, basename="master-data-scope-item")
router.register("master-data/generated-tasks", views.GeneratedTaskViewSet, basename="master-data-generated-task")
router.register("master-data/cable-imports", views.CableImportViewSet, basename="master-data-cable-import")
router.register("master-data/cable-import-items", views.CableImportItemViewSet, basename="master-data-cable-import-item")
router.register(
    "master-data/generated-task-dependencies",
    views.GeneratedTaskDependencyViewSet,
    basename="master-data-generated-task-dependency",
)
router.register("planning/sow-imports", views.SowImportViewSet, basename="planning-sow-import")
router.register("planning/sow-parsed-items", views.SowParsedItemViewSet, basename="planning-sow-parsed-item")

urlpatterns = [
    path("token/", ThrottledTokenObtainPairView.as_view(), name="token-obtain-pair"),
    path("token/refresh/", ThrottledTokenRefreshView.as_view(), name="token-refresh"),
    path("token/logout/", LogoutView.as_view(), name="token-logout"),
    path("me/", views.MeView.as_view(), name="me"),
    path("user-options/", views.UserOptionsView.as_view(), name="user-options"),
    path("me/change-password/", views.ChangePasswordView.as_view(), name="change-password"),
    path("password-reset/request/", views.PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("password-reset/confirm/", views.PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("search/", views.GlobalSearchView.as_view(), name="global-search"),
    path("planning/ai/status/", views.AiStatusView.as_view(), name="planning-ai-status"),
    path("planning/ai/test/", views.AiTestView.as_view(), name="planning-ai-test"),
    path("planning/project-plan/", views.ProjectPlanView.as_view(), name="planning-project-plan"),
    path(
        "planning/project-plan/create-tasks/",
        views.ProjectPlanCreateTasksView.as_view(),
        name="planning-project-plan-create-tasks",
    ),
    path("dashboard/projects/", ProjectsPerformanceView.as_view(), name="dashboard-projects"),
    path("dashboard/technical/", TechnicalPerformanceView.as_view(), name="dashboard-technical"),
    path("dashboard/sites/", SitesPanelView.as_view(), name="dashboard-sites"),
    path("my-tasks/block/suggestion/", WorkBlockSuggestionView.as_view(), name="my-tasks-block-suggestion"),
    path("my-tasks/block/", WorkBlockView.as_view(), name="my-tasks-block"),
    path("operations/board/", OperationsBoardView.as_view(), name="operations-board"),
    path("operations/timeline/", OperationsTimelineView.as_view(), name="operations-timeline"),
    path("operations/reports/", OperationsReportsView.as_view(), name="operations-reports"),
    path("operations/reports/block-times/", OperationsBlockTimesView.as_view(), name="operations-block-times"),
    path(
        "operations/reports/management/",
        OperationsManagementReportView.as_view(),
        name="operations-management-report",
    ),
    path("indicators/trends/", IndicatorsTrendsView.as_view(), name="indicators-trends"),
    path("indicators/trends/breakdown/", IndicatorsBreakdownView.as_view(), name="indicators-trends-breakdown"),
    path("indicators/trends/production/", IndicatorsProductionView.as_view(), name="indicators-trends-production"),
    path("operations/adjustments/", AdjustmentHistoryView.as_view(), name="operations-adjustments"),
    path("operations/adjustments/tasks/", AdjustmentTasksView.as_view(), name="operations-adjustments-tasks"),
    path("operations/adjustments/execution/", ExecutionAdjustmentView.as_view(), name="operations-adjustments-execution"),
    path("operations/adjustments/execution/remove/", ExecutionRemovalView.as_view(), name="operations-adjustments-execution-remove"),
    path("operations/adjustments/status-events/", StatusEventsAdjustmentView.as_view(), name="operations-adjustments-status-events"),
    path("operations/adjustments/status-window/", StatusWindowAdjustmentView.as_view(), name="operations-adjustments-status-window"),
    path("push/vapid-public-key/", views.VapidPublicKeyView.as_view(), name="vapid-public-key"),
    path("master-data/cable-wizard/options/", views.CableWizardOptionsView.as_view(), name="master-data-cable-wizard-options"),
    path("master-data/cable-wizard/preview/", views.CableWizardPreviewView.as_view(), name="master-data-cable-wizard-preview"),
    path("master-data/cable-wizard/", views.CableWizardCreateView.as_view(), name="master-data-cable-wizard"),
    path("bot/", include("bot.urls")),
    path("", include(router.urls)),
]

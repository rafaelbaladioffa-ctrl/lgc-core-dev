from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path, re_path

from axis_integration.labor_hours import labor_hours
from axis_integration.webhook import axis_webhook


def health_check(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health-check"),
    re_path(r"^api/v1/webhooks/axis/?$", axis_webhook, name="axis-webhook"),
    re_path(r"^api/integration/labor-hours/?$", labor_hours, name="integration-labor-hours"),
    path("api/", include("api.urls")),
]

admin.site.site_header = "ERP CSTR"
admin.site.site_title = "ERP CSTR"
admin.site.index_title = "Administração"
admin.site.login_template = "core/admin_login.html"

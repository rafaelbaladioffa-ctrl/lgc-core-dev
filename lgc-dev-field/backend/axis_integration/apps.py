from django.apps import AppConfig


class AxisIntegrationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "axis_integration"
    verbose_name = "Integração Axis"

    def ready(self):
        from . import signals  # noqa: F401 — registra os receivers

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0035_client_number_consultimer_project_type"),
        ("dispatch", "0013_alter_status_support"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="technicianstatusevent",
            name="is_adjusted",
            field=models.BooleanField(default=False, verbose_name="ajustado pelo administrador"),
        ),
        migrations.CreateModel(
            name="TimelineAdjustment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField(verbose_name="data do ajuste")),
                (
                    "kind",
                    models.CharField(
                        choices=[("execution", "Execução de tarefa"), ("status_window", "Trecho de status")],
                        max_length=20,
                        verbose_name="tipo",
                    ),
                ),
                ("reason", models.TextField(verbose_name="motivo")),
                ("before", models.JSONField(blank=True, default=dict, verbose_name="antes")),
                ("after", models.JSONField(blank=True, default=dict, verbose_name="depois")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="ajustado em")),
                (
                    "collaborator",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="timeline_adjustments",
                        to="core.collaborator",
                        verbose_name="técnico",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="ajustado por",
                    ),
                ),
            ],
            options={
                "verbose_name": "Ajuste da Timeline",
                "verbose_name_plural": "Ajustes da Timeline",
                "ordering": ("-created_at",),
            },
        ),
    ]

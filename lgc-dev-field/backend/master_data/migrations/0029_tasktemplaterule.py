import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0028_seed_task_template_steps"),
    ]

    operations = [
        migrations.CreateModel(
            name="TaskTemplateRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("code", models.CharField(max_length=50, unique=True, verbose_name="código")),
                ("name", models.CharField(max_length=150, verbose_name="nome")),
                ("medium", models.CharField(blank=True, max_length=50, verbose_name="meio")),
                ("preterminated", models.BooleanField(blank=True, default=None, null=True, verbose_name="pré-terminado")),
                ("priority", models.PositiveIntegerField(default=100, verbose_name="prioridade")),
                ("description", models.TextField(blank=True, verbose_name="descrição")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
                (
                    "cable_family",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="task_template_rules",
                        to="master_data.cablefamily",
                        verbose_name="família de cabo",
                    ),
                ),
                (
                    "cable_spec",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="task_template_rules",
                        to="master_data.cablespec",
                        verbose_name="especificação de cabo",
                    ),
                ),
                (
                    "network",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="task_template_rules",
                        to="master_data.network",
                        verbose_name="rede",
                    ),
                ),
                (
                    "task_template",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="rules",
                        to="master_data.tasktemplate",
                        verbose_name="template",
                    ),
                ),
                (
                    "workstream",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="task_template_rules",
                        to="master_data.workstream",
                        verbose_name="workstream",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="criado por",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="atualizado por",
                    ),
                ),
            ],
            options={
                "verbose_name": "Regra de Template de Tarefa",
                "verbose_name_plural": "Regras de Template de Tarefa",
                "ordering": ("priority", "code"),
            },
        ),
    ]

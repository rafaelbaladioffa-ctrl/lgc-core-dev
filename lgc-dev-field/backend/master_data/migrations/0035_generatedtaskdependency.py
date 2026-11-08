import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0034_scope_item_path_expansion"),
    ]

    operations = [
        migrations.CreateModel(
            name="GeneratedTaskDependency",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                (
                    "dependency_type",
                    models.CharField(default="FS", max_length=10, verbose_name="tipo de dependência"),
                ),
                ("lag_value", models.DecimalField(decimal_places=2, default=0, max_digits=9, verbose_name="lag")),
                ("lag_unit", models.CharField(blank=True, max_length=20, verbose_name="unidade do lag")),
                ("description", models.TextField(blank=True, verbose_name="descrição")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
                (
                    "predecessor_task",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="successor_dependencies",
                        to="master_data.generatedtask",
                        verbose_name="tarefa predecessora",
                    ),
                ),
                (
                    "successor_task",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="predecessor_dependencies",
                        to="master_data.generatedtask",
                        verbose_name="tarefa sucessora",
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
                "verbose_name": "Dependência entre Tarefas Geradas",
                "verbose_name_plural": "Dependências entre Tarefas Geradas",
                "ordering": ("predecessor_task", "successor_task"),
            },
        ),
        migrations.AddConstraint(
            model_name="generatedtaskdependency",
            constraint=models.UniqueConstraint(
                fields=("predecessor_task", "successor_task", "dependency_type"),
                name="unique_generated_task_dependency",
            ),
        ),
    ]

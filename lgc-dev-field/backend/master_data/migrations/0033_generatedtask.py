import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0032_seed_scope_items"),
    ]

    operations = [
        migrations.CreateModel(
            name="GeneratedTaskSequence",
            fields=[
                (
                    "id",
                    models.PositiveIntegerField(default=1, editable=False, primary_key=True, serialize=False),
                ),
                ("last_number", models.PositiveIntegerField(default=0, verbose_name="último número")),
            ],
            options={
                "verbose_name": "sequência de tarefas geradas",
                "verbose_name_plural": "sequências de tarefas geradas",
            },
        ),
        migrations.CreateModel(
            name="GeneratedTask",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                (
                    "code",
                    models.CharField(blank=True, editable=False, max_length=30, unique=True, verbose_name="código"),
                ),
                ("step_order", models.PositiveIntegerField(verbose_name="ordem")),
                ("name", models.CharField(max_length=200, verbose_name="nome")),
                (
                    "quantity",
                    models.DecimalField(
                        blank=True, decimal_places=2, max_digits=9, null=True, verbose_name="quantidade"
                    ),
                ),
                ("unit", models.CharField(blank=True, max_length=50, verbose_name="unidade")),
                ("required", models.BooleanField(default=True, verbose_name="obrigatória")),
                ("repeatable", models.BooleanField(default=False, verbose_name="repetível")),
                (
                    "generation_source",
                    models.CharField(default="TEMPLATE", max_length=50, verbose_name="origem da geração"),
                ),
                ("status", models.CharField(default="PENDING", max_length=30, verbose_name="status")),
                ("description", models.TextField(blank=True, verbose_name="descrição")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
                (
                    "activity",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="generated_tasks",
                        to="master_data.activity",
                        verbose_name="atividade",
                    ),
                ),
                (
                    "scope_item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="generated_tasks",
                        to="master_data.scopeitem",
                        verbose_name="item de escopo",
                    ),
                ),
                (
                    "task_template",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="generated_tasks",
                        to="master_data.tasktemplate",
                        verbose_name="template",
                    ),
                ),
                (
                    "task_template_step",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="generated_tasks",
                        to="master_data.tasktemplatestep",
                        verbose_name="etapa do template",
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
                "verbose_name": "Tarefa Gerada",
                "verbose_name_plural": "Tarefas Geradas",
                "ordering": ("scope_item", "step_order"),
            },
        ),
        migrations.AddConstraint(
            model_name="generatedtask",
            constraint=models.UniqueConstraint(
                fields=("scope_item", "task_template_step"), name="unique_generated_task_per_scope_item_step"
            ),
        ),
    ]

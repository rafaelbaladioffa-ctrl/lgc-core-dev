import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0026_seed_task_templates"),
    ]

    operations = [
        migrations.CreateModel(
            name="TaskTemplateStep",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                (
                    "step_order",
                    models.PositiveIntegerField(
                        validators=[django.core.validators.MinValueValidator(1)], verbose_name="ordem"
                    ),
                ),
                ("name_override", models.CharField(blank=True, max_length=150, verbose_name="nome personalizado")),
                ("required", models.BooleanField(default=True, verbose_name="obrigatória")),
                ("repeatable", models.BooleanField(default=False, verbose_name="repetível")),
                ("quantity_source", models.CharField(blank=True, max_length=50, verbose_name="origem da quantidade")),
                ("unit_override", models.CharField(blank=True, max_length=50, verbose_name="unidade sobrescrita")),
                ("description", models.TextField(blank=True, verbose_name="descrição")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
                (
                    "activity",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="template_steps",
                        to="master_data.activity",
                        verbose_name="atividade",
                    ),
                ),
                (
                    "task_template",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="steps",
                        to="master_data.tasktemplate",
                        verbose_name="template",
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
                "verbose_name": "Etapa de Template de Tarefa",
                "verbose_name_plural": "Etapas de Template de Tarefa",
                "ordering": ("task_template", "step_order"),
            },
        ),
        migrations.AddConstraint(
            model_name="tasktemplatestep",
            constraint=models.UniqueConstraint(
                fields=("task_template", "step_order"), name="unique_step_order_per_template"
            ),
        ),
    ]

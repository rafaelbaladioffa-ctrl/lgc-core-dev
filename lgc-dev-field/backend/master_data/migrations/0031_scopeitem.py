import decimal

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0030_seed_task_template_rules"),
    ]

    operations = [
        migrations.CreateModel(
            name="ScopeItemSequence",
            fields=[
                (
                    "id",
                    models.PositiveIntegerField(default=1, editable=False, primary_key=True, serialize=False),
                ),
                ("last_number", models.PositiveIntegerField(default=0, verbose_name="último número")),
            ],
            options={
                "verbose_name": "sequência de itens de escopo",
                "verbose_name_plural": "sequências de itens de escopo",
            },
        ),
        migrations.CreateModel(
            name="ScopeItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                (
                    "code",
                    models.CharField(blank=True, editable=False, max_length=30, unique=True, verbose_name="código"),
                ),
                ("name", models.CharField(blank=True, max_length=200, verbose_name="nome")),
                ("item_type", models.CharField(max_length=50, verbose_name="tipo")),
                (
                    "quantity",
                    models.PositiveIntegerField(
                        default=1, validators=[django.core.validators.MinValueValidator(1)], verbose_name="quantidade"
                    ),
                ),
                ("unit", models.CharField(blank=True, max_length=50, verbose_name="unidade")),
                ("length_type", models.CharField(blank=True, max_length=50, verbose_name="tipo de metragem")),
                (
                    "length_m",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        max_digits=9,
                        null=True,
                        validators=[django.core.validators.MinValueValidator(decimal.Decimal("0"))],
                        verbose_name="metragem (m)",
                    ),
                ),
                ("medium", models.CharField(blank=True, max_length=50, verbose_name="meio")),
                ("preterminated", models.BooleanField(blank=True, default=None, null=True, verbose_name="pré-terminado")),
                ("color", models.CharField(blank=True, max_length=50, verbose_name="cor")),
                ("fiber_count", models.PositiveIntegerField(blank=True, null=True, verbose_name="nº de fibras")),
                ("raw_text", models.TextField(verbose_name="texto original")),
                ("source_type", models.CharField(blank=True, max_length=50, verbose_name="tipo de fonte")),
                ("source_reference", models.CharField(blank=True, max_length=255, verbose_name="referência da fonte")),
                (
                    "confidence_score",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        max_digits=3,
                        null=True,
                        validators=[
                            django.core.validators.MinValueValidator(decimal.Decimal("0")),
                            django.core.validators.MaxValueValidator(decimal.Decimal("1")),
                        ],
                        verbose_name="confiança",
                    ),
                ),
                ("requires_review", models.BooleanField(default=False, verbose_name="exige revisão")),
                ("description", models.TextField(blank=True, verbose_name="descrição")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
                (
                    "normalization_metadata",
                    models.JSONField(blank=True, default=dict, editable=False, verbose_name="metadados de normalização"),
                ),
                (
                    "rule_resolution_status",
                    models.CharField(
                        default="NOT_RESOLVED", editable=False, max_length=30, verbose_name="status da resolução"
                    ),
                ),
                (
                    "cable_family",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="scope_items",
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
                        related_name="scope_items",
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
                        related_name="scope_items",
                        to="master_data.network",
                        verbose_name="rede",
                    ),
                ),
                (
                    "path",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="scope_items",
                        to="master_data.path",
                        verbose_name="rota/caminho",
                    ),
                ),
                (
                    "resolved_rule",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="resolved_scope_items",
                        to="master_data.tasktemplaterule",
                        verbose_name="regra resolvida",
                    ),
                ),
                (
                    "resolved_template",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="resolved_scope_items",
                        to="master_data.tasktemplate",
                        verbose_name="template resolvido",
                    ),
                ),
                (
                    "workstream",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="scope_items",
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
                "verbose_name": "Item de Escopo",
                "verbose_name_plural": "Itens de Escopo",
                "ordering": ("code",),
            },
        ),
    ]

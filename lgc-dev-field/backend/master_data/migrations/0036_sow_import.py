import django.core.validators
import django.db.models.deletion
import master_data.models
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0035_generatedtaskdependency"),
    ]

    operations = [
        migrations.CreateModel(
            name="SowImportSequence",
            fields=[
                (
                    "id",
                    models.PositiveIntegerField(default=1, editable=False, primary_key=True, serialize=False),
                ),
                ("last_number", models.PositiveIntegerField(default=0, verbose_name="último número")),
            ],
            options={
                "verbose_name": "sequência de importações de SOW",
                "verbose_name_plural": "sequências de importações de SOW",
            },
        ),
        migrations.CreateModel(
            name="SowImport",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("code", models.CharField(blank=True, editable=False, max_length=30, unique=True, verbose_name="código")),
                ("title", models.CharField(blank=True, max_length=200, verbose_name="título")),
                ("source_type", models.CharField(default="TEXT", max_length=20, verbose_name="tipo de origem")),
                (
                    "source_file",
                    models.FileField(
                        blank=True,
                        null=True,
                        upload_to=master_data.models.sow_import_upload_to,
                        verbose_name="arquivo de origem",
                    ),
                ),
                ("source_text", models.TextField(blank=True, verbose_name="texto de origem")),
                ("original_filename", models.CharField(blank=True, max_length=255, verbose_name="nome do arquivo original")),
                ("mime_type", models.CharField(blank=True, max_length=100, verbose_name="tipo MIME")),
                ("status", models.CharField(default="DRAFT", max_length=30, verbose_name="status")),
                ("parser_version", models.CharField(blank=True, max_length=20, verbose_name="versão do parser")),
                ("ai_provider", models.CharField(blank=True, max_length=50, verbose_name="provedor de IA")),
                ("ai_model", models.CharField(blank=True, max_length=100, verbose_name="modelo de IA")),
                (
                    "processing_started_at",
                    models.DateTimeField(blank=True, null=True, verbose_name="início do processamento"),
                ),
                (
                    "processing_finished_at",
                    models.DateTimeField(blank=True, null=True, verbose_name="fim do processamento"),
                ),
                ("total_items_detected", models.PositiveIntegerField(default=0, verbose_name="itens detectados")),
                ("total_items_approved", models.PositiveIntegerField(default=0, verbose_name="itens aprovados")),
                ("total_items_rejected", models.PositiveIntegerField(default=0, verbose_name="itens rejeitados")),
                ("total_warnings", models.PositiveIntegerField(default=0, verbose_name="total de warnings")),
                ("error_message", models.TextField(blank=True, verbose_name="mensagem de erro")),
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
                "verbose_name": "Importação de SOW",
                "verbose_name_plural": "Importações de SOW",
                "ordering": ("-created_at",),
            },
        ),
        migrations.CreateModel(
            name="SowParsedItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("sequence", models.PositiveIntegerField(default=0, verbose_name="sequência")),
                ("raw_text", models.TextField(editable=False, verbose_name="texto original")),
                ("item_type", models.CharField(blank=True, max_length=50, verbose_name="tipo")),
                ("quantity", models.PositiveIntegerField(blank=True, null=True, verbose_name="quantidade")),
                ("unit", models.CharField(blank=True, max_length=50, verbose_name="unidade")),
                ("length_type", models.CharField(blank=True, max_length=50, verbose_name="tipo de metragem")),
                (
                    "length_m",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        max_digits=9,
                        null=True,
                        validators=[django.core.validators.MinValueValidator(0)],
                        verbose_name="metragem (m)",
                    ),
                ),
                ("medium", models.CharField(blank=True, max_length=50, verbose_name="meio")),
                ("preterminated", models.BooleanField(blank=True, default=None, null=True, verbose_name="pré-terminado")),
                ("color", models.CharField(blank=True, max_length=50, verbose_name="cor")),
                ("fiber_count", models.PositiveIntegerField(blank=True, null=True, verbose_name="nº de fibras")),
                (
                    "confidence_score",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        max_digits=3,
                        null=True,
                        validators=[
                            django.core.validators.MinValueValidator(0),
                            django.core.validators.MaxValueValidator(1),
                        ],
                        verbose_name="confiança",
                    ),
                ),
                ("review_status", models.CharField(default="PENDING", max_length=20, verbose_name="status de revisão")),
                ("requires_review", models.BooleanField(default=False, verbose_name="exige revisão")),
                ("warnings", models.JSONField(blank=True, default=list, verbose_name="warnings")),
                (
                    "ai_raw_payload",
                    models.JSONField(blank=True, default=dict, editable=False, verbose_name="payload bruto da IA"),
                ),
                (
                    "normalization_metadata",
                    models.JSONField(blank=True, default=dict, editable=False, verbose_name="metadados de normalização"),
                ),
                ("reviewed_at", models.DateTimeField(blank=True, editable=False, null=True, verbose_name="revisado em")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
                (
                    "approved_scope_item",
                    models.OneToOneField(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="sow_parsed_item",
                        to="master_data.scopeitem",
                        verbose_name="item de escopo aprovado",
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="revisado por",
                    ),
                ),
                (
                    "sow_import",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="parsed_items",
                        to="master_data.sowimport",
                        verbose_name="importação de SOW",
                    ),
                ),
                (
                    "suggested_cable_family",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="sow_parsed_items",
                        to="master_data.cablefamily",
                        verbose_name="família de cabo sugerida",
                    ),
                ),
                (
                    "suggested_cable_spec",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="sow_parsed_items",
                        to="master_data.cablespec",
                        verbose_name="especificação sugerida",
                    ),
                ),
                (
                    "suggested_network",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="sow_parsed_items",
                        to="master_data.network",
                        verbose_name="rede sugerida",
                    ),
                ),
                (
                    "suggested_paths",
                    models.ManyToManyField(
                        blank=True, related_name="sow_parsed_items", to="master_data.path", verbose_name="rotas sugeridas"
                    ),
                ),
                (
                    "suggested_workstream",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="sow_parsed_items",
                        to="master_data.workstream",
                        verbose_name="workstream sugerido",
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
                "verbose_name": "Item Extraído de SOW",
                "verbose_name_plural": "Itens Extraídos de SOW",
                "ordering": ("sow_import", "sequence"),
            },
        ),
        migrations.AddConstraint(
            model_name="sowparseditem",
            constraint=models.UniqueConstraint(fields=("sow_import", "sequence"), name="unique_sow_parsed_item_sequence"),
        ),
    ]

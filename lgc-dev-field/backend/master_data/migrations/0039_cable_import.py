import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0038_cablefamily_work_group"),
    ]

    operations = [
        migrations.CreateModel(
            name="CableImport",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
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
                ("title", models.CharField(blank=True, max_length=200, verbose_name="título")),
                ("source_text", models.TextField(blank=True, verbose_name="texto de origem")),
                ("status", models.CharField(default="DRAFT", max_length=20, verbose_name="status")),
                ("total_models", models.PositiveIntegerField(default=0, verbose_name="linhas detectadas")),
                ("total_created", models.PositiveIntegerField(default=0, verbose_name="famílias cadastradas")),
            ],
            options={
                "verbose_name": "Importação de Cabos",
                "verbose_name_plural": "Importações de Cabos",
                "ordering": ("-created_at",),
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="CableImportItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
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
                ("line_number", models.PositiveIntegerField(default=1, verbose_name="linha")),
                ("raw_line", models.TextField(blank=True, verbose_name="linha original")),
                ("payload", models.JSONField(blank=True, default=dict, verbose_name="dados do cadastro")),
                ("conflicts", models.JSONField(blank=True, default=list, verbose_name="conflitos")),
                ("status", models.CharField(default="PENDING", max_length=20, verbose_name="status")),
                (
                    "cable_import",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="master_data.cableimport",
                    ),
                ),
                (
                    "created_family",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="master_data.cablefamily",
                        verbose_name="família criada",
                    ),
                ),
            ],
            options={
                "verbose_name": "Item de Importação de Cabos",
                "verbose_name_plural": "Itens de Importação de Cabos",
                "ordering": ("line_number", "pk"),
            },
        ),
    ]

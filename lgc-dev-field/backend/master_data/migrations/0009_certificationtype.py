import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0008_seed_cable_specs"),
    ]

    operations = [
        migrations.CreateModel(
            name="CertificationType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("code", models.CharField(max_length=50, unique=True, verbose_name="código")),
                ("name", models.CharField(max_length=150, verbose_name="nome")),
                (
                    "medium",
                    models.CharField(
                        blank=True,
                        choices=[("FIBER", "Fibra"), ("COPPER", "Cobre"), ("GENERAL", "Geral")],
                        max_length=10,
                        verbose_name="meio",
                    ),
                ),
                ("method", models.CharField(max_length=50, verbose_name="método")),
                ("requires_report", models.BooleanField(default=False, verbose_name="exige relatório")),
                ("requires_attachment", models.BooleanField(default=False, verbose_name="exige anexo")),
                ("description", models.TextField(blank=True, verbose_name="descrição")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
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
                "verbose_name": "Tipo de Certificação",
                "verbose_name_plural": "Tipos de Certificação",
                "ordering": ("code",),
            },
        ),
    ]

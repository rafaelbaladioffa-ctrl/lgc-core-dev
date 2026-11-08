import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0010_seed_certification_types"),
    ]

    operations = [
        migrations.CreateModel(
            name="Activity",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("code", models.CharField(max_length=50, unique=True, verbose_name="código")),
                ("name", models.CharField(max_length=150, verbose_name="nome")),
                ("category", models.CharField(max_length=50, verbose_name="categoria")),
                ("execution_type", models.CharField(blank=True, max_length=50, verbose_name="tipo de execução")),
                ("default_unit", models.CharField(blank=True, max_length=50, verbose_name="unidade padrão")),
                ("measurable", models.BooleanField(default=False, verbose_name="mensurável")),
                ("requires_quantity", models.BooleanField(default=False, verbose_name="exige quantidade")),
                ("requires_evidence", models.BooleanField(default=False, verbose_name="exige evidência")),
                ("requires_certification", models.BooleanField(default=False, verbose_name="exige certificação")),
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
                "verbose_name": "Atividade",
                "verbose_name_plural": "Atividades",
                "ordering": ("code",),
            },
        ),
    ]

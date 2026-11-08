import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0006_seed_cable_aliases"),
    ]

    operations = [
        migrations.CreateModel(
            name="CableSpec",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("code", models.CharField(max_length=100, unique=True, verbose_name="código")),
                ("name", models.CharField(max_length=200, verbose_name="nome")),
                ("manufacturer", models.CharField(blank=True, max_length=150, verbose_name="fabricante")),
                ("part_number", models.CharField(blank=True, max_length=150, verbose_name="part number")),
                ("fiber_type", models.CharField(blank=True, max_length=50, verbose_name="tipo de fibra")),
                ("jacket_color", models.CharField(blank=True, max_length=50, verbose_name="cor da capa")),
                ("polarity", models.CharField(blank=True, max_length=50, verbose_name="polaridade")),
                ("connector_a", models.CharField(blank=True, max_length=50, verbose_name="conector A")),
                ("connector_b", models.CharField(blank=True, max_length=50, verbose_name="conector B")),
                ("fiber_count", models.PositiveIntegerField(blank=True, null=True, verbose_name="nº de fibras")),
                ("description", models.TextField(blank=True, verbose_name="descrição")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
                (
                    "cable_family",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="specs",
                        to="master_data.cablefamily",
                        verbose_name="família de cabo",
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
                "verbose_name": "Especificação de Cabo",
                "verbose_name_plural": "Especificações de Cabo",
                "ordering": ("code",),
            },
        ),
        migrations.AddConstraint(
            model_name="cablespec",
            constraint=models.UniqueConstraint(
                condition=models.Q(("active", True), models.Q(("part_number", ""), _negated=True)),
                fields=("part_number",),
                name="unique_active_part_number",
            ),
        ),
    ]

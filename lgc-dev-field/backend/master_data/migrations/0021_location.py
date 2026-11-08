import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0020_seed_sites"),
    ]

    operations = [
        migrations.CreateModel(
            name="Location",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("code", models.CharField(max_length=100, unique=True, verbose_name="código")),
                ("canonical_address", models.CharField(max_length=255, unique=True, verbose_name="endereço canônico")),
                ("area", models.CharField(blank=True, max_length=50, verbose_name="área")),
                ("room", models.CharField(blank=True, max_length=50, verbose_name="room")),
                ("row", models.CharField(blank=True, max_length=50, verbose_name="row")),
                ("rack", models.CharField(blank=True, max_length=50, verbose_name="rack")),
                ("position", models.CharField(blank=True, max_length=50, verbose_name="posição")),
                ("ru", models.CharField(blank=True, max_length=50, verbose_name="RU")),
                ("location_type", models.CharField(blank=True, max_length=50, verbose_name="tipo de localização")),
                ("description", models.TextField(blank=True, verbose_name="descrição")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="locations",
                        to="master_data.site",
                        verbose_name="site",
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
                "verbose_name": "Localização",
                "verbose_name_plural": "Localizações",
                "ordering": ("code",),
            },
        ),
    ]

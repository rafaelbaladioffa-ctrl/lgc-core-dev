import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0018_seed_paths"),
    ]

    operations = [
        migrations.CreateModel(
            name="Site",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("code", models.CharField(max_length=50, unique=True, verbose_name="código")),
                ("name", models.CharField(max_length=150, verbose_name="nome")),
                ("city", models.CharField(blank=True, max_length=100, verbose_name="cidade")),
                ("state", models.CharField(blank=True, max_length=100, verbose_name="estado")),
                ("country", models.CharField(blank=True, max_length=100, verbose_name="país")),
                ("site_type", models.CharField(blank=True, max_length=50, verbose_name="tipo de site")),
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
                "verbose_name": "Site",
                "verbose_name_plural": "Sites",
                "ordering": ("code",),
            },
        ),
    ]

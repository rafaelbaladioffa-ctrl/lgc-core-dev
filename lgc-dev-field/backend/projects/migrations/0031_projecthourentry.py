import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0030_projecttaskassignment_per_tech_timing"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectHourEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("work_date", models.DateField(verbose_name="data")),
                ("person_name", models.CharField(blank=True, max_length=150, verbose_name="pessoa")),
                ("hours_normal", models.DecimalField(decimal_places=2, default=0, max_digits=6, verbose_name="horas normais")),
                ("hours_50", models.DecimalField(decimal_places=2, default=0, max_digits=6, verbose_name="horas 50%")),
                ("hours_100", models.DecimalField(decimal_places=2, default=0, max_digits=6, verbose_name="horas 100%")),
                ("total_hours", models.DecimalField(decimal_places=2, default=0, max_digits=6, verbose_name="total de horas")),
                ("work_location", models.CharField(blank=True, max_length=50, verbose_name="local")),
                ("comments", models.TextField(blank=True, verbose_name="comentários")),
                ("source", models.CharField(default="PLANILHA_SUPERVISOR", max_length=50, verbose_name="origem")),
                ("source_reference", models.CharField(blank=True, max_length=200, verbose_name="referência na origem")),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="hour_entries",
                        to="projects.project",
                        verbose_name="projeto",
                    ),
                ),
            ],
            options={
                "verbose_name": "Hora histórica do projeto",
                "verbose_name_plural": "Horas históricas dos projetos",
                "ordering": ("-work_date", "id"),
                "indexes": [models.Index(fields=["project", "work_date"], name="proj_hourentry_proj_date_idx")],
            },
        ),
    ]

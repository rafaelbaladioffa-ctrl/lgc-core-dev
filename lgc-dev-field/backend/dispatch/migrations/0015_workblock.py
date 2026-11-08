import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0035_client_number_consultimer_project_type"),
        ("master_data", "0038_cablefamily_work_group"),
        ("dispatch", "0014_timeline_adjustments"),
    ]

    operations = [
        migrations.CreateModel(
            name="WorkBlock",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField(verbose_name="data")),
                ("start", models.DateTimeField(verbose_name="início")),
                ("end", models.DateTimeField(verbose_name="fim")),
                ("work_group", models.CharField(blank=True, max_length=30, verbose_name="grupo de trabalho")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="registrado em")),
                (
                    "activity",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="master_data.activity",
                        verbose_name="atividade",
                    ),
                ),
                (
                    "collaborator",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="work_blocks",
                        to="core.collaborator",
                        verbose_name="técnico",
                    ),
                ),
            ],
            options={
                "verbose_name": "Bloco de Trabalho",
                "verbose_name_plural": "Blocos de Trabalho",
                "ordering": ("-start",),
            },
        ),
    ]

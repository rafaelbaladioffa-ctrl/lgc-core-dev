import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Certificação deixa de ser um campo manual: passa a ser derivada da
    existência de anexo no projeto (ver bot.views.
    BotDailyProjectReportBroadcastView). Some o certification_status, entra o
    retrato diário de avanço, usado para o "avanço no dia"."""

    dependencies = [
        ("projects", "0028_project_certification_status"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="project",
            name="certification_status",
        ),
        migrations.CreateModel(
            name="ProjectProgressSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("date", models.DateField(verbose_name="data")),
                ("percent", models.PositiveIntegerField(default=0, verbose_name="avanço (%)")),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="progress_snapshots",
                        to="projects.project",
                        verbose_name="projeto",
                    ),
                ),
            ],
            options={
                "verbose_name": "Retrato de Avanço do Projeto",
                "verbose_name_plural": "Retratos de Avanço do Projeto",
                "ordering": ("-date", "project"),
            },
        ),
        migrations.AddConstraint(
            model_name="projectprogresssnapshot",
            constraint=models.UniqueConstraint(fields=("project", "date"), name="unique_progress_snapshot_per_day"),
        ),
    ]

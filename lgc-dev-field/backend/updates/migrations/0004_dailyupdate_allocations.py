from django.db import migrations, models
import django.db.models.deletion


def split_projects_and_collaborators(apps, schema_editor):
    DailyUpdate = apps.get_model("updates", "DailyUpdate")
    DailyUpdateAllocation = apps.get_model("updates", "DailyUpdateAllocation")
    for update in DailyUpdate.objects.prefetch_related("projects", "collaborators"):
        collaborator_ids = list(update.collaborators.values_list("pk", flat=True))
        for project in update.projects.all():
            allocation = DailyUpdateAllocation.objects.create(daily_update=update, project=project)
            allocation.collaborators.add(*collaborator_ids)


class Migration(migrations.Migration):
    dependencies = [("updates", "0003_dailyupdate_multiple_projects")]

    operations = [
        migrations.CreateModel(
            name="DailyUpdateAllocation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "daily_update",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="allocations",
                        to="updates.dailyupdate",
                        verbose_name="atualização diária",
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="daily_update_allocations",
                        to="projects.project",
                        verbose_name="projeto",
                    ),
                ),
                (
                    "collaborators",
                    models.ManyToManyField(
                        related_name="daily_update_allocations",
                        to="core.collaborator",
                        verbose_name="colaboradores",
                    ),
                ),
            ],
            options={
                "verbose_name": "Alocação de Projeto",
                "verbose_name_plural": "Alocações de Projetos",
                "ordering": ("project__name", "pk"),
            },
        ),
        migrations.RunPython(split_projects_and_collaborators, migrations.RunPython.noop),
        migrations.RemoveField(model_name="dailyupdate", name="collaborators"),
        migrations.RemoveField(model_name="dailyupdate", name="projects"),
        migrations.AddConstraint(
            model_name="dailyupdateallocation",
            constraint=models.UniqueConstraint(
                fields=("daily_update", "project"),
                name="unique_project_per_daily_update",
            ),
        ),
    ]

from django.db import migrations, models


def copy_existing_projects(apps, schema_editor):
    DailyUpdate = apps.get_model("updates", "DailyUpdate")
    for update in DailyUpdate.objects.exclude(project_id=None).iterator():
        update.projects.add(update.project_id)


class Migration(migrations.Migration):
    dependencies = [("updates", "0002_dailyupdate_description")]

    operations = [
        migrations.AddField(
            model_name="dailyupdate",
            name="projects",
            field=models.ManyToManyField(related_name="daily_updates", to="projects.project", verbose_name="projetos"),
        ),
        migrations.RunPython(copy_existing_projects, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="dailyupdate",
            name="unique_daily_update_per_project_and_date",
        ),
        migrations.RemoveField(model_name="dailyupdate", name="project"),
        migrations.AlterModelOptions(
            name="dailyupdate",
            options={
                "ordering": ("-allocation_date", "-created_at"),
                "verbose_name": "Atualização Diária",
                "verbose_name_plural": "Atualizações Diárias",
            },
        ),
    ]

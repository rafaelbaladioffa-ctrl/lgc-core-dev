from django.db import migrations, models


def copy_existing_collaborators(apps, schema_editor):
    ProjectTask = apps.get_model("projects", "ProjectTask")
    through = ProjectTask.collaborators.through
    rows = []
    for project_task in ProjectTask.objects.exclude(collaborator_id=None).iterator():
        rows.append(
            through(
                projecttask_id=project_task.pk,
                collaborator_id=project_task.collaborator_id,
            )
        )
    through.objects.bulk_create(rows, ignore_conflicts=True)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0015_clientresponsible"),
        ("projects", "0003_projecttask_exact_start_and_end"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttask",
            name="collaborators",
            field=models.ManyToManyField(blank=True, related_name="project_tasks", to="core.collaborator", verbose_name="responsáveis"),
        ),
        migrations.RunPython(copy_existing_collaborators, migrations.RunPython.noop),
        migrations.RemoveField(model_name="projecttask", name="collaborator"),
    ]

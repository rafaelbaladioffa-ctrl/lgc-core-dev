# Copia as linhas da tabela M2M implícita antiga de ProjectTask.collaborators
# (ainda em uso neste ponto da migração) para a nova ProjectTaskAssignment,
# antes da migração seguinte trocar o M2M pra usar esse through model.

from django.db import migrations


def copy_assignments(apps, schema_editor):
    ProjectTask = apps.get_model("projects", "ProjectTask")
    ProjectTaskAssignment = apps.get_model("projects", "ProjectTaskAssignment")
    old_through = ProjectTask.collaborators.through
    for row in old_through.objects.all().iterator():
        ProjectTaskAssignment.objects.get_or_create(
            project_task_id=row.projecttask_id,
            collaborator_id=row.collaborator_id,
            defaults={"queue_order": 0},
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0023_projecttaskassignment_and_more'),
    ]

    operations = [
        migrations.RunPython(copy_assignments, noop_reverse),
    ]

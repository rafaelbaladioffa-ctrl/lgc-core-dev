"""Status, resultado, quantidade e pausas por técnico em ProjectTaskAssignment.

Até aqui o status ficava só na ProjectTask: quando um técnico iniciava,
pausava ou concluía, a tarefa inteira mudava para todos os técnicos
despachados. Agora cada técnico tem o seu status; a ProjectTask.status passa
a ser o agregado deles (ver ProjectTask.sync_from_assignments).

Migração aditiva: campos novos com default. O backfill copia o estado atual da
tarefa para cada despacho (registros históricos continuam válidos; não há como
saber quem concluiu de fato quando a tarefa tinha vários técnicos).
"""
from django.db import migrations, models


def copy_task_state_to_assignments(apps, schema_editor):
    ProjectTaskAssignment = apps.get_model("projects", "ProjectTaskAssignment")
    for assignment in ProjectTaskAssignment.objects.select_related("project_task").iterator():
        task = assignment.project_task
        assignment.status = task.status
        assignment.completion_outcome = task.completion_outcome
        assignment.quantity_done = task.quantity_done
        fields = ["status", "completion_outcome", "quantity_done"]
        # Registro legado (anterior ao rastreamento por técnico): o horário era
        # da própria tarefa e era atribuído a cada técnico. Copiar mantém o
        # histórico nos indicadores, que contam conclusão com horário do técnico.
        if (
            task.status == "completed"
            and assignment.assignment_end is None
            and task.actual_start
            and task.actual_end
            and task.actual_hours is not None
        ):
            assignment.assignment_start = assignment.assignment_start or task.actual_start
            assignment.assignment_end = task.actual_end
            assignment.actual_hours = task.actual_hours
            fields += ["assignment_start", "assignment_end", "actual_hours"]
        assignment.save(update_fields=fields)


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0034_projecttask_manage_permission"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttaskassignment",
            name="status",
            field=models.CharField(
                choices=[
                    ("not_started", "Não Iniciada"),
                    ("in_progress", "Em Andamento"),
                    ("paused", "Pausada"),
                    ("waiting_qaqc", "Aguardando QA/QC"),
                    ("completed", "Concluída"),
                    ("canceled", "Cancelada"),
                ],
                default="not_started",
                max_length=20,
                verbose_name="status do técnico",
            ),
        ),
        migrations.AddField(
            model_name="projecttaskassignment",
            name="completion_outcome",
            field=models.CharField(
                blank=True,
                choices=[("completed", "Concluída"), ("partial", "Parcial"), ("blocked", "Bloqueada")],
                max_length=20,
                verbose_name="resultado da finalização (técnico)",
            ),
        ),
        migrations.AddField(
            model_name="projecttaskassignment",
            name="quantity_done",
            field=models.CharField(blank=True, max_length=100, verbose_name="quantidade executada (técnico)"),
        ),
        migrations.AddField(
            model_name="projecttaskassignment",
            name="pause_log",
            field=models.JSONField(blank=True, default=list, verbose_name="pausas do técnico"),
        ),
        migrations.RunPython(copy_task_state_to_assignments, migrations.RunPython.noop),
    ]

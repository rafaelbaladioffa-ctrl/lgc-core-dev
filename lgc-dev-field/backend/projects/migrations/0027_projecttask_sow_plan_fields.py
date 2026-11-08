import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0037_sowimport_ai_mode"),
        ("projects", "0026_alter_projecttaskassignment_collaborator"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttask",
            name="origin",
            field=models.CharField(blank=True, default="MANUAL", editable=False, max_length=30, verbose_name="origem"),
        ),
        migrations.AddField(
            model_name="projecttask",
            name="priority",
            field=models.CharField(
                choices=[("low", "Baixa"), ("medium", "Média"), ("high", "Alta"), ("urgent", "Urgente")],
                default="medium",
                max_length=20,
                verbose_name="prioridade",
            ),
        ),
        migrations.AddField(
            model_name="projecttask",
            name="instructions",
            field=models.TextField(
                blank=True,
                help_text="Instrução para o técnico — diferente de 'observações', que é preenchido durante a execução.",
                verbose_name="instrução operacional",
            ),
        ),
        migrations.AddField(
            model_name="projecttask",
            name="quantity_planned",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=9, null=True, verbose_name="quantidade planejada"),
        ),
        migrations.AddField(
            model_name="projecttask",
            name="unit",
            field=models.CharField(blank=True, max_length=50, verbose_name="unidade"),
        ),
        migrations.AddField(
            model_name="projecttask",
            name="requires_evidence",
            field=models.BooleanField(default=False, verbose_name="exige evidência"),
        ),
        migrations.AddField(
            model_name="projecttask",
            name="requires_qaqc",
            field=models.BooleanField(default=False, verbose_name="exige QA/QC"),
        ),
        migrations.AlterField(
            model_name="projecttask",
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
                verbose_name="status",
            ),
        ),
        migrations.AddField(
            model_name="projecttask",
            name="generated_task",
            field=models.ForeignKey(
                blank=True,
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="project_tasks",
                to="master_data.generatedtask",
                verbose_name="tarefa gerada de origem",
            ),
        ),
        migrations.AddConstraint(
            model_name="projecttask",
            constraint=models.UniqueConstraint(
                condition=models.Q(("generated_task__isnull", False)),
                fields=("project", "generated_task"),
                name="unique_project_task_per_generated_task",
            ),
        ),
    ]

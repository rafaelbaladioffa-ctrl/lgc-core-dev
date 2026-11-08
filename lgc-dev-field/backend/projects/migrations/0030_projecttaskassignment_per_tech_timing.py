"""Adiciona rastreamento de tempo por técnico em ProjectTaskAssignment.

Antes, start/end/paused ficavam na ProjectTask (compartilhados entre todos os
técnicos despachados para ela). Com esses campos cada técnico tem seu próprio
intervalo: contabiliza a partir de quando ELE iniciou/concluiu.

Todos os campos são nullable para não quebrar registros históricos.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0029_project_progress_snapshot"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttaskassignment",
            name="assignment_start",
            field=models.DateTimeField(blank=True, null=True, verbose_name="início do técnico"),
        ),
        migrations.AddField(
            model_name="projecttaskassignment",
            name="assignment_end",
            field=models.DateTimeField(blank=True, null=True, verbose_name="fim do técnico"),
        ),
        migrations.AddField(
            model_name="projecttaskassignment",
            name="paused_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="pausado em"),
        ),
        migrations.AddField(
            model_name="projecttaskassignment",
            name="paused_seconds",
            field=models.FloatField(default=0, verbose_name="segundos pausado"),
        ),
        migrations.AddField(
            model_name="projecttaskassignment",
            name="actual_hours",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=8,
                null=True,
                verbose_name="horas reais do técnico",
            ),
        ),
    ]

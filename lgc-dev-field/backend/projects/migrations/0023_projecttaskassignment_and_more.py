# Generated manually (see docs/plan em C:\Users\rafae\.claude\plans\synchronous-hugging-lemur.md)

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('projects', '0022_projecttask_custom_name'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectTaskAssignment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='criado em')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='atualizado em')),
                ('dispatched_at', models.DateTimeField(auto_now_add=True, verbose_name='despachado em')),
                ('queue_order', models.PositiveIntegerField(default=0, verbose_name='posição na fila')),
                ('collaborator', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='task_assignments', to='core.collaborator', verbose_name='técnico')),
                ('dispatched_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL, verbose_name='despachado por')),
                ('project_task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='assignments', to='projects.projecttask')),
            ],
            options={
                'verbose_name': 'Despacho de Tarefa',
                'verbose_name_plural': 'Despachos de Tarefa',
                'ordering': ('queue_order', 'dispatched_at'),
            },
        ),
        migrations.AddField(
            model_name='projecttask',
            name='completion_outcome',
            field=models.CharField(
                blank=True,
                choices=[('completed', 'Concluída'), ('partial', 'Parcial'), ('blocked', 'Bloqueada')],
                max_length=20,
                verbose_name='resultado da finalização',
            ),
        ),
        migrations.AddField(
            model_name='projecttask',
            name='quantity_done',
            field=models.CharField(blank=True, max_length=100, verbose_name='quantidade executada'),
        ),
        migrations.AddConstraint(
            model_name='projecttaskassignment',
            constraint=models.UniqueConstraint(fields=('project_task', 'collaborator'), name='unique_assignment_per_task_collaborator'),
        ),
    ]

# Generated manually (see docs/plan em C:\Users\rafae\.claude\plans\synchronous-hugging-lemur.md)

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('core', '0030_notification'),
    ]

    operations = [
        migrations.CreateModel(
            name='TechnicianDailyPresence',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='criado em')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='atualizado em')),
                ('date', models.DateField(default=django.utils.timezone.localdate, verbose_name='data')),
                ('status', models.CharField(
                    choices=[('not_started', 'Não chegou'), ('available', 'Disponível'), ('off_duty', 'Encerrou expediente')],
                    default='not_started',
                    max_length=20,
                    verbose_name='status',
                )),
                ('checked_in_at', models.DateTimeField(blank=True, null=True, verbose_name='check-in em')),
                ('checked_out_at', models.DateTimeField(blank=True, null=True, verbose_name='encerrado em')),
                ('collaborator', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='daily_presences',
                    to='core.collaborator',
                    verbose_name='técnico',
                )),
            ],
            options={
                'verbose_name': 'Presença do Técnico',
                'verbose_name_plural': 'Presenças dos Técnicos',
                'ordering': ('-date', 'collaborator__person__name'),
            },
        ),
        migrations.AddConstraint(
            model_name='techniciandailypresence',
            constraint=models.UniqueConstraint(fields=('collaborator', 'date'), name='unique_presence_per_day'),
        ),
    ]

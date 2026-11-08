from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('dispatch', '0012_alter_status_meal_label_cafe'),
    ]

    operations = [
        migrations.AlterField(
            model_name='techniciandailypresence',
            name='status',
            field=models.CharField(choices=[('not_started', 'Indisponível'), ('available', 'Disponível'), ('in_progress', 'Em Execução'), ('lunch', 'Horário de Almoço'), ('personal', 'Particular'), ('meal', 'Café'), ('meeting', 'Reunião'), ('traveling', 'Em Deslocamento'), ('support', 'Apoio a outro técnico'), ('site_blocked', 'Sem Acesso ao Site'), ('awaiting_release', 'Aguardando Liberações'), ('off_duty', 'Fim de Expediente')], default='not_started', max_length=20, verbose_name='status'),
        ),
        migrations.AlterField(
            model_name='technicianstatusevent',
            name='status',
            field=models.CharField(choices=[('not_started', 'Indisponível'), ('available', 'Disponível'), ('in_progress', 'Em Execução'), ('lunch', 'Horário de Almoço'), ('personal', 'Particular'), ('meal', 'Café'), ('meeting', 'Reunião'), ('traveling', 'Em Deslocamento'), ('support', 'Apoio a outro técnico'), ('site_blocked', 'Sem Acesso ao Site'), ('awaiting_release', 'Aguardando Liberações'), ('off_duty', 'Fim de Expediente')], max_length=20, verbose_name='status'),
        ),
    ]

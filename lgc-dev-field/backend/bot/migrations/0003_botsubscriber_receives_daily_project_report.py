from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bot', '0002_botsubscriber_receives_operations_print'),
    ]

    operations = [
        migrations.AddField(
            model_name='botsubscriber',
            name='receives_daily_project_report',
            field=models.BooleanField(default=True, help_text='Envio automático às 15h com o relatório completo de cada projeto ativo (uma mensagem por projeto).', verbose_name='recebe atualização diária de projeto (15h)'),
        ),
    ]

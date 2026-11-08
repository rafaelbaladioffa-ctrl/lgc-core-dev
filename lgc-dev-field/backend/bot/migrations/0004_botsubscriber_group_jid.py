from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bot", "0003_botsubscriber_receives_daily_project_report"),
    ]

    operations = [
        migrations.AddField(
            model_name="botsubscriber",
            name="group_jid",
            field=models.CharField(
                blank=True,
                help_text='Identificador do grupo (termina em "@g.us"). Quando preenchido, o telefone é '
                "ignorado e o envio vai para o grupo. O bot precisa ser membro do grupo.",
                max_length=100,
                verbose_name="ID do grupo do WhatsApp",
            ),
        ),
        migrations.AlterField(
            model_name="botsubscriber",
            name="phone",
            field=models.CharField(
                blank=True,
                help_text="Com DDD, ex: +55 (11) 99999-9999. Deixe em branco se for um grupo.",
                max_length=20,
                verbose_name="telefone",
            ),
        ),
    ]

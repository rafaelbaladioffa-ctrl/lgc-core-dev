from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bot", "0009_botbroadcastrule_responsibles"),
        ("core", "0035_client_number_consultimer_project_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="botbroadcastrule",
            name="managers",
            field=models.ManyToManyField(
                blank=True,
                help_text="Alocação: só entram os técnicos desses gestores (e de quem está abaixo deles). Vazio = todos.",
                related_name="+",
                to="core.collaborator",
                verbose_name="gestores",
            ),
        ),
    ]

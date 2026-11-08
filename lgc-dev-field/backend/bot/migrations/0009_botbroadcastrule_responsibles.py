from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bot", "0008_rules_all_message_types"),
        ("core", "0035_client_number_consultimer_project_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="botbroadcastrule",
            name="responsibles",
            field=models.ManyToManyField(
                blank=True, related_name="+", to="core.responsible", verbose_name="responsáveis CSTR"
            ),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0027_projecttask_sow_plan_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="certification_status",
            field=models.CharField(
                choices=[("pending", "Pendente"), ("finished", "Finalizada")],
                default="pending",
                max_length=20,
                verbose_name="status de certificação",
            ),
        ),
    ]

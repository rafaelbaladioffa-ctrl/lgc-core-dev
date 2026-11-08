from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0006_alter_project_status"),
    ]

    operations = [
        migrations.AlterField(
            model_name="projecttask",
            name="actual_start",
            field=models.DateTimeField(blank=True, null=True, verbose_name="início real"),
        ),
        migrations.AlterField(
            model_name="projecttask",
            name="actual_end",
            field=models.DateTimeField(blank=True, null=True, verbose_name="término real"),
        ),
    ]

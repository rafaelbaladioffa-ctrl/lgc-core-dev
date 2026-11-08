from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0007_projecttask_actual_datetime"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttask",
            name="paused_seconds",
            field=models.FloatField(default=0, editable=False, verbose_name="segundos pausados"),
        ),
        migrations.AddField(
            model_name="projecttask",
            name="paused_at",
            field=models.DateTimeField(blank=True, editable=False, null=True, verbose_name="pausado em"),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0036_assignment_is_adjusted"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttaskassignment",
            name="time_allocated",
            field=models.BooleanField(default=False, verbose_name="horas alocadas de um bloco"),
        ),
    ]

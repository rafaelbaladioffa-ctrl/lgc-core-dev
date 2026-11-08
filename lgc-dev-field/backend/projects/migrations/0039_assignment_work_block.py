import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("dispatch", "0015_workblock"),
        ("projects", "0038_projecttask_exclude_from_reports"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttaskassignment",
            name="work_block",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assignments",
                to="dispatch.workblock",
                verbose_name="bloco de trabalho",
            ),
        ),
    ]

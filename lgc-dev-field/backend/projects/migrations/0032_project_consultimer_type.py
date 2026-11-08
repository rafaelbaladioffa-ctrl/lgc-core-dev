import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0035_client_number_consultimer_project_type"),
        ("projects", "0031_projecthourentry"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="consultimer_type",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="projects", to="core.consultimerprojecttype", verbose_name="Tipo Consultimer"),
        ),
    ]

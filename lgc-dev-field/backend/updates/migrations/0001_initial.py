import django.db.models.deletion
import updates.models
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("core", "0015_clientresponsible"),
        ("projects", "0006_alter_project_status"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name="DailyUpdate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("allocation_date", models.DateField(db_index=True, default=updates.models.tomorrow, verbose_name="data da alocação")),
                ("collaborators", models.ManyToManyField(related_name="daily_updates", to="core.collaborator", verbose_name="colaboradores")),
                ("created_by", models.ForeignKey(blank=True, editable=False, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_daily_updates", to=settings.AUTH_USER_MODEL, verbose_name="enviado por")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="daily_updates", to="projects.project", verbose_name="projeto")),
            ],
            options={"verbose_name": "Atualização Diária", "verbose_name_plural": "Atualizações Diárias", "ordering": ("-allocation_date", "project__name")},
        ),
        migrations.AddConstraint(
            model_name="dailyupdate",
            constraint=models.UniqueConstraint(fields=("project", "allocation_date"), name="unique_daily_update_per_project_and_date"),
        ),
    ]

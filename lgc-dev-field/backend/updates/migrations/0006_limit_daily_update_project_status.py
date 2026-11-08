from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("updates", "0005_refresh_allocation_descriptions")]

    operations = [
        migrations.AlterField(
            model_name="dailyupdateallocation",
            name="project",
            field=models.ForeignKey(
                limit_choices_to={"status__in": ("in_progress", "planning")},
                on_delete=django.db.models.deletion.PROTECT,
                related_name="daily_update_allocations",
                to="projects.project",
                verbose_name="projeto",
            ),
        ),
    ]

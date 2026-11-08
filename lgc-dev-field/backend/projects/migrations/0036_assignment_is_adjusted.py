from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0035_projecttaskassignment_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttaskassignment",
            name="is_adjusted",
            field=models.BooleanField(default=False, verbose_name="ajustado pelo administrador"),
        ),
    ]

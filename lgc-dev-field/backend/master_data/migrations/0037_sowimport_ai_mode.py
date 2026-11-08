from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0036_sow_import"),
    ]

    operations = [
        migrations.AddField(
            model_name="sowimport",
            name="ai_mode",
            field=models.CharField(blank=True, default="DETERMINISTIC_ONLY", max_length=20, verbose_name="modo do parser"),
        ),
        migrations.AlterField(
            model_name="sowimport",
            name="ai_model",
            field=models.CharField(blank=True, max_length=100, verbose_name="modelo de IA utilizado"),
        ),
    ]

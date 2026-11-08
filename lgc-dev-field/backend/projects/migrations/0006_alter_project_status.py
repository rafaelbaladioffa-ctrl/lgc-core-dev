from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0005_projecthistory"),
    ]

    operations = [
        migrations.AlterField(
            model_name="project",
            name="status",
            field=models.CharField(
                choices=[
                    ("planning", "Planejamento"),
                    ("not_started", "Não Iniciado"),
                    ("in_progress", "Ativo"),
                    ("paused", "Pausado"),
                    ("completed", "Concluído"),
                    ("canceled", "Cancelado"),
                ],
                default="planning",
                max_length=20,
                verbose_name="status",
            ),
        ),
    ]

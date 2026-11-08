from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0032_project_consultimer_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectCodeSequence",
            fields=[
                ("year", models.PositiveIntegerField(primary_key=True, serialize=False, verbose_name="ano")),
                ("last_number", models.PositiveIntegerField(default=0, verbose_name="último número")),
            ],
            options={
                "verbose_name": "Sequência de Código de Projeto",
                "verbose_name_plural": "Sequências de Código de Projeto",
            },
        ),
        migrations.AlterField(
            model_name="project",
            name="code",
            field=models.CharField(editable=False, max_length=50, unique=True, verbose_name="código"),
        ),
    ]

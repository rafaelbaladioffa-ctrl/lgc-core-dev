from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0004_projecttask_multiple_collaborators"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectHistory",
            fields=[],
            options={
                "verbose_name": "Histórico de Projeto",
                "verbose_name_plural": "Histórico de Projetos",
                "proxy": True,
                "indexes": [],
                "constraints": [],
            },
            bases=("projects.project",),
        ),
    ]

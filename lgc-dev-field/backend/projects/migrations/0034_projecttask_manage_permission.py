from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0033_project_code_sequence"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="projecttask",
            options={
                "ordering": ("order", "id"),
                "permissions": [("manage_project_tasks", "Pode gerenciar tarefas do projeto (status, datas, colaboradores e despacho)")],
                "verbose_name": "Tarefa do Projeto",
                "verbose_name_plural": "Tarefas do Projeto",
            },
        ),
    ]

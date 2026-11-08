# Troca o M2M ProjectTask.collaborators pra usar o through model
# ProjectTaskAssignment (dados já copiados na migração anterior). Django não
# permite AlterField pra adicionar through= a um M2M existente (a tabela
# implícita antiga e a nova ProjectTaskAssignment são tabelas diferentes) —
# o caminho suportado é remover o campo antigo e recriá-lo apontando pro
# through model novo (a tabela nova já existe desde a 0023, então isso não
# perde os dados já copiados na 0024).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0024_copy_collaborator_assignments'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='projecttask',
            name='collaborators',
        ),
        migrations.AddField(
            model_name='projecttask',
            name='collaborators',
            field=models.ManyToManyField(
                blank=True,
                related_name='project_tasks',
                through='projects.ProjectTaskAssignment',
                to='core.collaborator',
                verbose_name='responsáveis',
            ),
        ),
    ]

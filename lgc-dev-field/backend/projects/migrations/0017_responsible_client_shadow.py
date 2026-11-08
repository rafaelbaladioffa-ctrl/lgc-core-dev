import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Campo-sombra: Project ainda aponta 'responsible_client' para o antigo
    ClientResponsible; criamos um segundo FK temporário já apontando pro
    Responsible unificado, migramos os dados (migração de dados seguinte) e
    só então trocamos de fato (migração de finalização)."""

    dependencies = [
        ('projects', '0016_responsible_cstr_limit_choices_via_person'),
        ('core', '0026_responsible_kind_client_jobtitle'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='responsible_client_v2',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='client_projects',
                to='core.responsible',
                verbose_name='Responsável Cliente',
                limit_choices_to=models.Q(('kind', 'client')),
            ),
        ),
        migrations.AlterField(
            model_name='project',
            name='responsible_cstr',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='cstr_projects',
                to='core.responsible',
                verbose_name='Responsável CSTR',
                limit_choices_to=models.Q(
                    models.Q(('kind', 'cstr')),
                    models.Q(('person__company__legal_name__icontains', 'CONSULTIMER'), ('person__company__trade_name__icontains', 'CONSULTIMER'), _connector='OR'),
                ),
            ),
        ),
    ]

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0025_person_finalize'),
    ]

    operations = [
        migrations.AddField(
            model_name='responsible',
            name='kind',
            field=models.CharField(choices=[('cstr', 'CSTR'), ('client', 'Cliente')], default='cstr', max_length=10, verbose_name='tipo'),
        ),
        migrations.AddField(
            model_name='responsible',
            name='job_title',
            field=models.CharField(blank=True, max_length=100, verbose_name='cargo'),
        ),
        migrations.AddField(
            model_name='responsible',
            name='client',
            field=models.ForeignKey(
                blank=True,
                help_text='Obrigatório para Responsável do Cliente. Deixe em branco para Responsável CSTR.',
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='responsibles',
                to='core.client',
                verbose_name='cliente',
            ),
        ),
    ]

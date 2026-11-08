import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0024_populate_person_data'),
    ]

    operations = [
        migrations.RemoveField(model_name='clientresponsible', name='email'),
        migrations.RemoveField(model_name='clientresponsible', name='name'),
        migrations.RemoveField(model_name='clientresponsible', name='phone'),
        migrations.RemoveField(model_name='collaborator', name='company'),
        migrations.RemoveField(model_name='collaborator', name='email'),
        migrations.RemoveField(model_name='collaborator', name='name'),
        migrations.RemoveField(model_name='collaborator', name='phone'),
        migrations.RemoveField(model_name='collaborator', name='user'),
        migrations.RemoveField(model_name='responsible', name='company'),
        migrations.RemoveField(model_name='responsible', name='email'),
        migrations.RemoveField(model_name='responsible', name='name'),
        migrations.RemoveField(model_name='responsible', name='phone'),
        migrations.RemoveField(model_name='responsible', name='user'),
        migrations.AlterField(
            model_name='clientresponsible',
            name='person',
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='client_responsible_role',
                to='core.person',
                verbose_name='pessoa',
            ),
        ),
        migrations.AlterField(
            model_name='collaborator',
            name='person',
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='collaborator_role',
                to='core.person',
                verbose_name='pessoa',
            ),
        ),
        migrations.AlterField(
            model_name='responsible',
            name='person',
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='responsible_role',
                to='core.person',
                verbose_name='pessoa',
            ),
        ),
    ]

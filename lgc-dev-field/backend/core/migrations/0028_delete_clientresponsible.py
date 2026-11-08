from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0027_migrate_client_responsibles'),
        ('projects', '0018_responsible_client_swap'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='clientresponsible',
            name='client',
        ),
        migrations.RemoveField(
            model_name='clientresponsible',
            name='person',
        ),
        migrations.DeleteModel(
            name='ClientResponsible',
        ),
    ]

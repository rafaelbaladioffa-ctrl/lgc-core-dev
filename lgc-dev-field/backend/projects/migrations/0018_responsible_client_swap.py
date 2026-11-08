from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0017_responsible_client_shadow'),
        ('core', '0027_migrate_client_responsibles'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='project',
            name='responsible_client',
        ),
        migrations.RenameField(
            model_name='project',
            old_name='responsible_client_v2',
            new_name='responsible_client',
        ),
    ]

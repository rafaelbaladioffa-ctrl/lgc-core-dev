from django.db import migrations


def migrate_client_responsibles(apps, schema_editor):
    ClientResponsible = apps.get_model('core', 'ClientResponsible')
    Responsible = apps.get_model('core', 'Responsible')
    Project = apps.get_model('projects', 'Project')

    mapping = {}
    for cr in ClientResponsible.objects.all():
        responsible = Responsible.objects.create(
            kind='client',
            person_id=cr.person_id,
            client_id=cr.client_id,
            job_title=cr.job_title,
            is_active=cr.is_active,
        )
        mapping[cr.id] = responsible.id

    for project in Project.objects.exclude(responsible_client_id__isnull=True):
        new_id = mapping.get(project.responsible_client_id)
        if new_id:
            project.responsible_client_v2_id = new_id
            project.save(update_fields=['responsible_client_v2'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0026_responsible_kind_client_jobtitle'),
        ('projects', '0017_responsible_client_shadow'),
    ]

    operations = [
        migrations.RunPython(migrate_client_responsibles, noop_reverse),
    ]

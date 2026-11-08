from django.db import migrations


def populate_persons(apps, schema_editor):
    Person = apps.get_model('core', 'Person')
    Collaborator = apps.get_model('core', 'Collaborator')
    Responsible = apps.get_model('core', 'Responsible')
    ClientResponsible = apps.get_model('core', 'ClientResponsible')

    person_by_user = {}
    person_by_email = {}

    def get_or_make_person(*, name, email, phone, company_id, user_id):
        email = (email or '').strip()
        if user_id and user_id in person_by_user:
            return person_by_user[user_id]
        if email and email.lower() in person_by_email:
            return person_by_email[email.lower()]
        person = Person.objects.create(
            name=name or '',
            email=email,
            phone=phone or '',
            company_id=company_id,
            user_id=user_id,
        )
        if user_id:
            person_by_user[user_id] = person
        if email:
            person_by_email[email.lower()] = person
        return person

    # Colaboradores e Responsáveis primeiro (têm user/company — sinais mais
    # fortes de identidade), Responsáveis do Cliente por último, reaproveitando
    # um Person já criado se o e-mail bater com alguém já processado (ex:
    # alguém que já é Colaborador e também aparece como Responsável do
    # Cliente com o mesmo e-mail).
    for collaborator in Collaborator.objects.all():
        person = get_or_make_person(
            name=collaborator.name, email=collaborator.email, phone=collaborator.phone,
            company_id=collaborator.company_id, user_id=collaborator.user_id,
        )
        collaborator.person_id = person.id
        collaborator.save(update_fields=['person'])

    for responsible in Responsible.objects.all():
        person = get_or_make_person(
            name=responsible.name, email=responsible.email, phone=responsible.phone,
            company_id=responsible.company_id, user_id=responsible.user_id,
        )
        responsible.person_id = person.id
        responsible.save(update_fields=['person'])

    for client_responsible in ClientResponsible.objects.all():
        person = get_or_make_person(
            name=client_responsible.name, email=client_responsible.email, phone=client_responsible.phone,
            company_id=None, user_id=None,
        )
        client_responsible.person_id = person.id
        client_responsible.save(update_fields=['person'])


def noop_reverse(apps, schema_editor):
    """Não desfaz a criação dos Person no rollback — os papéis voltam a ter
    person_id nulo (a migração de schema seguinte que readicionaria as
    colunas antigas é quem precisaria repopulá-las, se algum dia for
    necessário reverter de fato)."""


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0023_person_schema'),
    ]

    operations = [
        migrations.RunPython(populate_persons, noop_reverse),
    ]

"""Seed inicial do catálogo canônico de Sites — os 3 sites/datacenters já
conhecidos com segurança dos escopos analisados. `site_type` mantido como
DATACENTER (classificação geral) para todos, mesmo GRU65 sendo citado como
OPTDC em um dos SOWs — essa distinção fica para uma fase futura, para não
gerar ambiguidade entre tipo físico do site e requisito operacional
específico do projeto. Idempotente e chaveado por `code`
(update_or_create): pode rodar de novo sem duplicar."""

from django.db import migrations

# (code, name, site_type, city, state, country)
SITES = [
    ("GRU65", "GRU65", "DATACENTER", "", "", "BRAZIL"),
    ("GRU60", "GRU60", "DATACENTER", "", "", "BRAZIL"),
    ("VCP1", "VCP1", "DATACENTER", "", "", "BRAZIL"),
]


def seed_sites(apps, schema_editor):
    Site = apps.get_model("master_data", "Site")
    for code, name, site_type, city, state, country in SITES:
        Site.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "site_type": site_type,
                "city": city,
                "state": state,
                "country": country,
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0019_site"),
    ]

    operations = [
        migrations.RunPython(seed_sites, migrations.RunPython.noop),
    ]

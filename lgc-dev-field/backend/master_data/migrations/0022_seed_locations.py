"""Seed inicial do catálogo canônico de Localizações — uma amostra
representativa (não exaustiva) dos SOWs já analisados, só para validar a
arquitetura. `canonical_address` é a fonte de verdade; os campos
estruturais (area/room/row/rack/position/ru) ficam vazios nesta etapa —
não há heurística validada para derivá-los automaticamente. Idempotente e
chaveado por `canonical_address` (update_or_create): pode rodar de novo
sem duplicar."""

from django.db import migrations

# (code, site_code, canonical_address, location_type, description)
LOCATIONS = [
    ("LOC-GRU65-000001", "GRU65", "GRU65.01-01-002-53", "RACK_POSITION", "Management Rack"),
    ("LOC-GRU65-000002", "GRU65", "GRU65.01-01-002-44", "RACK_POSITION", "WS Management Rack"),
    ("LOC-GRU65-000003", "GRU65", "GRU65.01-01-002-50", "RACK_POSITION", "EBR"),
    ("LOC-GRU65-000004", "GRU65", "GRU65.01-01-001-19", "IDF", "IDF1"),
    ("LOC-GRU65-000005", "GRU65", "GRU65.01-01-001-83", "IDF", "IDF2"),
    ("LOC-GRU65-000006", "GRU65", "GRU65.01-01-010-55", "RACK_POSITION", "Euclid Spine Position"),
    ("LOC-GRU65-000007", "GRU65", "GRU65.01-01-010-61", "RACK_POSITION", "Euclid Spine Position"),
]


def seed_locations(apps, schema_editor):
    Site = apps.get_model("master_data", "Site")
    Location = apps.get_model("master_data", "Location")
    for code, site_code, canonical_address, location_type, description in LOCATIONS:
        site = Site.objects.filter(code=site_code).first()
        if site is None:
            continue
        Location.objects.update_or_create(
            canonical_address=canonical_address,
            defaults={
                "code": code,
                "site": site,
                "location_type": location_type,
                "description": description,
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0021_location"),
    ]

    operations = [
        migrations.RunPython(seed_locations, migrations.RunPython.noop),
    ]

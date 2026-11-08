"""Seed inicial do catálogo canônico de Workstreams — as 9 frentes
operacionais de execução já conhecidas dos SOWs analisados. Idempotente e
chaveado por `code` (update_or_create): pode rodar de novo sem duplicar."""

from django.db import migrations

# (code, name, category, default_medium)
WORKSTREAMS = [
    ("WS-MGMT-FIBER", "Management Fibers", "CABLING", "FIBER"),
    ("WS-CONSOLE", "Console Cables", "CABLING", "MIXED"),
    ("WS-BFC-FIBER", "BFC Brick Fibers", "CABLING", "FIBER"),
    ("WS-EUCLID-FIBER", "Euclid Brick Fibers", "CABLING", "FIBER"),
    ("WS-IDF-CABLING", "IDF Cabling", "CABLING", "MIXED"),
    ("WS-HARDWARE", "Hardware Installation", "HARDWARE", "GENERAL"),
    ("WS-WAP", "WAP Installation", "WIRELESS", "COPPER"),
    ("WS-SMART-HAND", "Smart Hands", "SERVICE", "GENERAL"),
    ("WS-CLOSURE", "Project Closure", "CLOSURE", "GENERAL"),
]


def seed_workstreams(apps, schema_editor):
    Workstream = apps.get_model("master_data", "Workstream")
    for code, name, category, default_medium in WORKSTREAMS:
        Workstream.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "category": category,
                "default_medium": default_medium,
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0015_workstream"),
    ]

    operations = [
        migrations.RunPython(seed_workstreams, migrations.RunPython.noop),
    ]

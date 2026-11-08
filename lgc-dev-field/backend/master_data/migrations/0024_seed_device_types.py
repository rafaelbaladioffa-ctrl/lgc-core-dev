"""Seed inicial do catálogo canônico de Tipos de Dispositivo — os 15 tipos
já conhecidos dos SOWs/cutsheets analisados (o TIPO do device, nunca uma
instância física real). Idempotente e chaveado por `code`
(update_or_create): pode rodar de novo sem duplicar."""

from django.db import migrations

# (code, name, category, default_medium)
DEVICE_TYPES = [
    ("EUCLID_SPINE", "Euclid Spine", "RACK", "MIXED"),
    ("BFC_BRICK", "BFC Brick", "RACK", "FIBER"),
    ("EUCLID_BRICK", "Euclid Brick", "RACK", "FIBER"),
    ("MGMT_RACK", "Management Rack", "RACK", "MIXED"),
    ("MGMT_SWITCH", "Management Switch", "SWITCH", "COPPER"),
    ("CONSOLE_SWITCH", "Console Switch", "SWITCH", "COPPER"),
    ("TOR", "Top of Rack Switch", "SWITCH", "MIXED"),
    ("PSC", "PSC", "NETWORK_DEVICE", "MIXED"),
    ("EBR", "EBR", "RACK", "MIXED"),
    ("IDF", "IDF", "INFRASTRUCTURE", "MIXED"),
    ("MR", "MR Rack", "INFRASTRUCTURE", "MIXED"),
    ("WAP", "Wireless Access Point", "WIRELESS", "COPPER"),
    ("PATCH_PANEL", "Patch Panel", "PATCHING", "MIXED"),
    ("WDM", "WDM", "NETWORK_DEVICE", "FIBER"),
    ("OTHER", "Outros", "OTHER", "GENERAL"),
]


def seed_device_types(apps, schema_editor):
    DeviceType = apps.get_model("master_data", "DeviceType")
    for code, name, category, default_medium in DEVICE_TYPES:
        DeviceType.objects.update_or_create(
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
        ("master_data", "0023_devicetype"),
    ]

    operations = [
        migrations.RunPython(seed_device_types, migrations.RunPython.noop),
    ]

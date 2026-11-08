"""Corrige os atributos técnicos dos 15 registros seedados em
0002_seed_cable_families — aquela migration só preenchia code/name/medium,
deixando fiber_count/connector_a/connector_b/cable_category/preterminated
vazios/default. Idempotente e chaveada por `code`: pode rodar de novo (ex:
reaplicar em outro ambiente) sem duplicar ou reverter dado editado
manualmente para um valor igualmente correto."""

from django.db import migrations

# (code, name, medium, fiber_count, connector_a, connector_b, cable_category, preterminated)
CABLE_FAMILY_ATTRIBUTES = [
    ("FIB-2F-ROBUST", "2F Robust", "FIBER", 2, "LC", "LC", "ROBUST", True),
    ("FIB-2F-TB-ROBUST", "2F TB Robust", "FIBER", 2, "LC", "LC", "ROBUST", True),
    ("FIB-2F-RAF", "2F RAF Fiber", "FIBER", 2, "", "", "RAF", True),
    ("FIB-2F-LCLC", "2F LC-LC", "FIBER", 2, "LC", "LC", "PATCH", True),
    ("FIB-8F-LCLC", "8F LC-LC", "FIBER", 8, "LC", "LC", "TRUNK", True),
    ("FIB-12F-LCLC", "12F LC-LC", "FIBER", 12, "LC", "LC", "TRUNK", True),
    ("FIB-18F-LCLC", "18F LC-LC", "FIBER", 18, "LC", "LC", "TRUNK", True),
    ("FIB-36F-LCLC", "36F LC-LC", "FIBER", 36, "LC", "LC", "TRUNK", True),
    ("FIB-36F-OS2-LCU", "36F OS2 Yellow LCU/LCU", "FIBER", 36, "LCU", "LCU", "TRUNK", True),
    ("FIB-72F-MPOB", "72F OS2 MPO/MPO MPO-B", "FIBER", 72, "MPO", "MPO", "TRUNK", True),
    ("FIB-144F-MPOB", "144F MPO-B to MPO-B", "FIBER", 144, "MPO", "MPO", "TRUNK", True),
    ("FIB-288F-MPO-MPO", "288F MPO-MPO", "FIBER", 288, "MPO", "MPO", "TRUNK", True),
    ("FIB-288F-MPO-LC", "288F MPO-LC", "FIBER", 288, "MPO", "LC", "TRUNK", True),
    ("BRK-MPO-4LC", "MPO to 4xLC Breakout", "FIBER", None, "MPO", "LC", "BREAKOUT", True),
    ("COP-CAT6", "CAT6 UTP", "COPPER", None, "RJ45", "RJ45", "COPPER", False),
]


def fix_attributes(apps, schema_editor):
    CableFamily = apps.get_model("master_data", "CableFamily")
    for code, name, medium, fiber_count, connector_a, connector_b, cable_category, preterminated in CABLE_FAMILY_ATTRIBUTES:
        CableFamily.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "medium": medium,
                "fiber_count": fiber_count,
                "connector_a": connector_a,
                "connector_b": connector_b,
                "cable_category": cable_category,
                "preterminated": preterminated,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0003_rename_is_active_cablefamily_active"),
    ]

    operations = [
        migrations.RunPython(fix_attributes, migrations.RunPython.noop),
    ]

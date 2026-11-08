from django.db import migrations

CABLE_FAMILIES = [
    ("FIB-2F-ROBUST", "2F Robust", "FIBER"),
    ("FIB-2F-TB-ROBUST", "2F TB Robust", "FIBER"),
    ("FIB-2F-RAF", "2F RAF Fiber", "FIBER"),
    ("FIB-2F-LCLC", "2F LC-LC", "FIBER"),
    ("FIB-8F-LCLC", "8F LC-LC", "FIBER"),
    ("FIB-12F-LCLC", "12F LC-LC", "FIBER"),
    ("FIB-18F-LCLC", "18F LC-LC", "FIBER"),
    ("FIB-36F-LCLC", "36F LC-LC", "FIBER"),
    ("FIB-36F-OS2-LCU", "36F OS2 Yellow LCU/LCU", "FIBER"),
    ("FIB-72F-MPOB", "72F OS2 MPO/MPO MPO-B", "FIBER"),
    ("FIB-144F-MPOB", "144F MPO-B to MPO-B", "FIBER"),
    ("FIB-288F-MPO-MPO", "288F MPO-MPO", "FIBER"),
    ("FIB-288F-MPO-LC", "288F MPO-LC", "FIBER"),
    ("BRK-MPO-4LC", "MPO to 4xLC Breakout", "FIBER"),
    ("COP-CAT6", "CAT6 UTP", "COPPER"),
]


def seed_cable_families(apps, schema_editor):
    CableFamily = apps.get_model("master_data", "CableFamily")
    for code, name, medium in CABLE_FAMILIES:
        CableFamily.objects.get_or_create(code=code, defaults={"name": name, "medium": medium})


def remove_seeded_cable_families(apps, schema_editor):
    CableFamily = apps.get_model("master_data", "CableFamily")
    CableFamily.objects.filter(code__in=[code for code, _, _ in CABLE_FAMILIES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_cable_families, remove_seeded_cable_families),
    ]

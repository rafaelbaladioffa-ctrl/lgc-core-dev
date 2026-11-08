"""Seed inicial de Especificações de Cabo — os specs (fabricante/part
number/características físicas) já conhecidos dos documentos analisados,
cada um ligado à sua família canônica. Idempotente e chaveado por `code`
(update_or_create): pode rodar de novo sem duplicar. Os part numbers usados
aqui já existem como CableAlias (0006_seed_cable_aliases) apontando para a
mesma família — sem conflito de consistência alias<->família."""

from django.db import migrations

# (code, name, family_code, part_number, manufacturer, fiber_type, jacket_color, polarity, connector_a, connector_b, fiber_count)
CABLE_SPECS = [
    (
        "SPEC-2F-TB-ROBUST-CSTR",
        "2F TB Robust Fiber",
        "FIB-2F-TB-ROBUST",
        "XX1A0002R6D09-XXXM",
        "",
        "",
        "",
        "",
        "LC",
        "LC",
        2,
    ),
    (
        "SPEC-8F-LCLC-CX1A0012R6C03",
        "8F LC-LC Trunk Fiber",
        "FIB-8F-LCLC",
        "CX1A0012R6C03-XXXM",
        "",
        "",
        "",
        "",
        "LC",
        "LC",
        8,
    ),
    (
        "SPEC-72F-MPOB-0072X6P64",
        "72F OS2 Yellow MPO/MPO MPO-B",
        "FIB-72F-MPOB",
        "0072X6P64",
        "",
        "OS2",
        "YELLOW",
        "B",
        "MPO",
        "MPO",
        72,
    ),
    (
        "SPEC-288F-MPO-MPO-0288X6P05",
        "288F MPO-MPO",
        "FIB-288F-MPO-MPO",
        "0288X6P05",
        "",
        "",
        "",
        "",
        "MPO",
        "MPO",
        288,
    ),
    (
        "SPEC-288F-MPO-LC-0288X6P06",
        "288F MPO-LC",
        "FIB-288F-MPO-LC",
        "0288X6P06",
        "",
        "",
        "",
        "",
        "MPO",
        "LC",
        288,
    ),
]


def seed_cable_specs(apps, schema_editor):
    CableFamily = apps.get_model("master_data", "CableFamily")
    CableSpec = apps.get_model("master_data", "CableSpec")
    for (
        code,
        name,
        family_code,
        part_number,
        manufacturer,
        fiber_type,
        jacket_color,
        polarity,
        connector_a,
        connector_b,
        fiber_count,
    ) in CABLE_SPECS:
        family = CableFamily.objects.filter(code=family_code).first()
        if family is None:
            continue
        CableSpec.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "cable_family": family,
                "part_number": part_number,
                "manufacturer": manufacturer,
                "fiber_type": fiber_type,
                "jacket_color": jacket_color,
                "polarity": polarity,
                "connector_a": connector_a,
                "connector_b": connector_b,
                "fiber_count": fiber_count,
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0007_cablespec"),
    ]

    operations = [
        migrations.RunPython(seed_cable_specs, migrations.RunPython.noop),
    ]

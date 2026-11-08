"""Seed inicial de Aliases de Cabo — formas alternativas de escrita
encontradas em SOWs/cutsheets/documentos, mapeadas para a família canônica
correspondente (base para a normalização automática por IA numa fase
futura). Idempotente e chaveada por `normalized_alias` (via
update_or_create): pode rodar de novo sem duplicar. Famílias sem aliases
cadastrados aqui (ex: FIB-12F-LCLC) simplesmente não têm nenhuma variação
conhecida ainda — cadastrável manualmente pela tela a qualquer momento."""

from django.db import migrations

from master_data.models import normalize_alias_text

PART_NUMBER = "PART_NUMBER"
NAME_VARIATION = "NAME_VARIATION"

# family_code -> [(alias, alias_type), ...]
CABLE_ALIASES = {
    "FIB-8F-LCLC": [
        ("8F LC-LC", NAME_VARIATION),
        ("8F LC<>LC", NAME_VARIATION),
        ("8F LC/LC", NAME_VARIATION),
        ("8F LC TRUNK", NAME_VARIATION),
        ("8F LC TRUNK FIBER", NAME_VARIATION),
        ("CX1A0012R6C03-XXXM", PART_NUMBER),
    ],
    "FIB-2F-ROBUST": [
        ("2F ROBUST", NAME_VARIATION),
        ("2F ROBUST FIBER", NAME_VARIATION),
        ("2F ROBUST CORD", NAME_VARIATION),
        ("2F ROBUST CORDS", NAME_VARIATION),
    ],
    "FIB-2F-TB-ROBUST": [
        ("2F TB ROBUST", NAME_VARIATION),
        ("2F TB ROBUST FIBER", NAME_VARIATION),
        ("XX1A0002R6D09-XXXM", PART_NUMBER),
    ],
    "FIB-2F-RAF": [
        ("2F RAF", NAME_VARIATION),
        ("2F RAF FIBER", NAME_VARIATION),
        ("RAF 2F", NAME_VARIATION),
    ],
    "FIB-2F-LCLC": [
        ("2F LC-LC", NAME_VARIATION),
        ("2F LC<>LC", NAME_VARIATION),
        ("2F LC/LC", NAME_VARIATION),
        ("2F SINGLE MODE LC-LC", NAME_VARIATION),
        ("2F SINGLE MODE LC/LC", NAME_VARIATION),
    ],
    "FIB-18F-LCLC": [
        ("18F LC-LC", NAME_VARIATION),
        ("18F LC<>LC", NAME_VARIATION),
        ("18F LC/LC", NAME_VARIATION),
    ],
    "FIB-36F-LCLC": [
        ("36F LC-LC", NAME_VARIATION),
        ("36F LC<>LC", NAME_VARIATION),
        ("36F LC/LC", NAME_VARIATION),
        ("36F SINGLE MODE LC-LC", NAME_VARIATION),
    ],
    "FIB-36F-OS2-LCU": [
        ("36F OS2 YELLOW LCU/LCU", NAME_VARIATION),
        ("36F OS2 YELLOW LCU-LCU", NAME_VARIATION),
        ("36F LCU/LCU", NAME_VARIATION),
    ],
    "FIB-72F-MPOB": [
        ("72F MPO-MPO", NAME_VARIATION),
        ("72F MPO/MPO", NAME_VARIATION),
        ("72F OS2 YELLOW MPO/MPO", NAME_VARIATION),
        ("72F OS2 YELLOW MPO/MPO MPO-B", NAME_VARIATION),
        ("72F MPO-MPO TRUNK", NAME_VARIATION),
        ("0072X6P64", PART_NUMBER),
    ],
    "FIB-144F-MPOB": [
        ("144F MPO-B TO MPO-B", NAME_VARIATION),
        ("144F MPO-B MPO-B", NAME_VARIATION),
        ("144F MPO-MPO", NAME_VARIATION),
        ("144F MPO/MPO", NAME_VARIATION),
        ("144F MPO-MPO FIBER", NAME_VARIATION),
    ],
    "FIB-288F-MPO-MPO": [
        ("288F MPO-MPO", NAME_VARIATION),
        ("288F MPO/MPO", NAME_VARIATION),
        ("0288X6P05", PART_NUMBER),
    ],
    "FIB-288F-MPO-LC": [
        ("288F MPO-LC", NAME_VARIATION),
        ("288F MPO/LC", NAME_VARIATION),
        ("0288X6P06", PART_NUMBER),
    ],
    "BRK-MPO-4LC": [
        ("MPO TO 4XLC BREAKOUT", NAME_VARIATION),
        ("MPO TO 4X LC BREAKOUT", NAME_VARIATION),
        ("MPO-4LC BREAKOUT", NAME_VARIATION),
    ],
    "COP-CAT6": [
        ("CAT6", NAME_VARIATION),
        ("CAT6 UTP", NAME_VARIATION),
        ("UTP", NAME_VARIATION),
        ("UTPS", NAME_VARIATION),
        ("UTP CABLE", NAME_VARIATION),
        ("UTP CABLES", NAME_VARIATION),
        ("UTP CORD", NAME_VARIATION),
        ("UTP CORDS", NAME_VARIATION),
        ("CAT6 COPPER", NAME_VARIATION),
        ("CAT6 CABLE", NAME_VARIATION),
        ("RJ45", NAME_VARIATION),
        ("GREEN RJ45", NAME_VARIATION),
        ("ORANGE RJ45", NAME_VARIATION),
        ("YELLOW RJ45", NAME_VARIATION),
        ("GREEN CAT6 COPPER", NAME_VARIATION),
        ("ORANGE CAT6 COPPER", NAME_VARIATION),
    ],
}


def seed_cable_aliases(apps, schema_editor):
    CableFamily = apps.get_model("master_data", "CableFamily")
    CableAlias = apps.get_model("master_data", "CableAlias")
    for family_code, aliases in CABLE_ALIASES.items():
        family = CableFamily.objects.filter(code=family_code).first()
        if family is None:
            continue
        for alias_text, alias_type in aliases:
            CableAlias.objects.update_or_create(
                normalized_alias=normalize_alias_text(alias_text),
                defaults={
                    "cable_family": family,
                    "alias": alias_text,
                    "alias_type": alias_type,
                    "active": True,
                },
            )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0005_cable_alias_fields"),
    ]

    operations = [
        migrations.RunPython(seed_cable_aliases, migrations.RunPython.noop),
    ]

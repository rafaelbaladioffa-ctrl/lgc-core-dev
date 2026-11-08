"""Seed inicial do catálogo canônico de Atividades — as 14 ações
operacionais padronizadas já conhecidas, agrupadas por categoria
(preparação, instalação, organização, terminação, certificação, qualidade,
documentação, site, encerramento). Idempotente e chaveado por `code`
(update_or_create): pode rodar de novo sem duplicar."""

from django.db import migrations

# (code, name, category, execution_type, default_unit, measurable, requires_quantity, requires_evidence, requires_certification)
ACTIVITIES = [
    ("MAT-SEP", "Separar materiais", "PREPARATION", "MANUAL", "UNIT", True, True, False, False),
    ("MAT-CHECK", "Conferir materiais", "PREPARATION", "INSPECTION", "UNIT", True, True, False, False),
    ("CAB-MEASURE", "Medir cabeamento", "PREPARATION", "MANUAL", "METER", True, True, False, False),
    ("CAB-CUT", "Cortar cabeamento", "PREPARATION", "MANUAL", "CABLE", True, True, False, False),
    ("CAB-LABEL", "Aplicar labels", "PREPARATION", "MANUAL", "CABLE", True, True, True, False),
    ("CAB-RUN", "Lançar cabeamento", "INSTALLATION", "MANUAL", "CABLE", True, True, True, False),
    ("CAB-DRESS", "Organizar cabeamento", "ORGANIZATION", "MANUAL", "CABLE", True, True, True, False),
    ("CAB-CRIMP", "Crimpar RJ45", "TERMINATION", "MANUAL", "CONNECTOR", True, True, True, False),
    ("CAB-PATCH", "Realizar patching", "TERMINATION", "MANUAL", "CONNECTION", True, True, True, False),
    ("CERTIFY", "Certificar cabeamento", "CERTIFICATION", "TEST", "LINK", True, True, True, False),
    ("QAQC", "Realizar QA/QC", "QUALITY", "INSPECTION", "PROJECT", False, False, True, False),
    ("EVIDENCE", "Registrar evidências", "DOCUMENTATION", "DOCUMENTATION", "PROJECT", False, False, True, False),
    ("SITE-CLEAN", "Housekeeping / Retirada de materiais", "SITE", "MANUAL", "PROJECT", False, False, True, False),
    ("HANDOVER", "Realizar handover", "CLOSURE", "DOCUMENTATION", "PROJECT", False, False, True, False),
]


def seed_activities(apps, schema_editor):
    Activity = apps.get_model("master_data", "Activity")
    for (
        code,
        name,
        category,
        execution_type,
        default_unit,
        measurable,
        requires_quantity,
        requires_evidence,
        requires_certification,
    ) in ACTIVITIES:
        Activity.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "category": category,
                "execution_type": execution_type,
                "default_unit": default_unit,
                "measurable": measurable,
                "requires_quantity": requires_quantity,
                "requires_evidence": requires_evidence,
                "requires_certification": requires_certification,
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0011_activity"),
    ]

    operations = [
        migrations.RunPython(seed_activities, migrations.RunPython.noop),
    ]

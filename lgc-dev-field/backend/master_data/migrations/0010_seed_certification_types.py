"""Seed inicial de Tipos de Certificação — os métodos de certificação/
validação já conhecidos da operação (OTDR, certificação de cobre,
certificação de fibra genérica, validação QA/QC). Idempotente e chaveado
por `code` (update_or_create): pode rodar de novo sem duplicar."""

from django.db import migrations

# (code, name, medium, method, requires_report, requires_attachment)
CERTIFICATION_TYPES = [
    ("CERT-OTDR", "Certificação OTDR", "FIBER", "OTDR", True, True),
    ("CERT-COPPER", "Certificação de Cabeamento de Cobre", "COPPER", "COPPER_CERTIFIER", True, True),
    ("CERT-FIBER-GENERAL", "Certificação de Fibra Óptica", "FIBER", "FIBER_CERTIFICATION", True, True),
    ("CERT-QAQC", "Validação QA/QC", "GENERAL", "QA_QC", False, False),
]


def seed_certification_types(apps, schema_editor):
    CertificationType = apps.get_model("master_data", "CertificationType")
    for code, name, medium, method, requires_report, requires_attachment in CERTIFICATION_TYPES:
        CertificationType.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "medium": medium,
                "method": method,
                "requires_report": requires_report,
                "requires_attachment": requires_attachment,
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0009_certificationtype"),
    ]

    operations = [
        migrations.RunPython(seed_certification_types, migrations.RunPython.noop),
    ]

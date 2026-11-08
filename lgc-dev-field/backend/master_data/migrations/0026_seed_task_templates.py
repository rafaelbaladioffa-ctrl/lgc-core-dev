"""Seed inicial do catálogo canônico de Templates de Tarefa — os 8
cabeçalhos/classificações de receita de execução já conhecidos. Ainda sem
etapas (task_template_steps, fase futura) nem relação com CableFamily/
Network/Workstream/Path/Activity. Idempotente e chaveado por `code`
(update_or_create): pode rodar de novo sem duplicar."""

from django.db import migrations

# (code, name, category, medium)
TASK_TEMPLATES = [
    ("TPL-FIBER-PRETERMINATED", "Fibra Pré-Terminada", "CABLING", "FIBER"),
    ("TPL-FIBER-ROBUST", "Fibra Robust", "CABLING", "FIBER"),
    ("TPL-FIBER-MPO", "Fibra MPO", "CABLING", "FIBER"),
    ("TPL-COPPER-FIELD-TERMINATED", "UTP Terminado em Campo", "CABLING", "COPPER"),
    ("TPL-COPPER-PRETERMINATED", "UTP Pré-Terminada", "CABLING", "COPPER"),
    ("TPL-WAP-COPPER", "Cabeamento e Instalação WAP", "WIRELESS", "COPPER"),
    ("TPL-HARDWARE-INSTALL", "Instalação de Hardware", "HARDWARE", "GENERAL"),
    ("TPL-PROJECT-CLOSURE", "Encerramento de Projeto", "CLOSURE", "GENERAL"),
]


def seed_task_templates(apps, schema_editor):
    TaskTemplate = apps.get_model("master_data", "TaskTemplate")
    for code, name, category, medium in TASK_TEMPLATES:
        TaskTemplate.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "category": category,
                "medium": medium,
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0025_tasktemplate"),
    ]

    operations = [
        migrations.RunPython(seed_task_templates, migrations.RunPython.noop),
    ]

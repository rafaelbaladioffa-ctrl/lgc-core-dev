"""Seed inicial das etapas dos Templates de Tarefa já conhecidos. Idempotente
e chaveado por (task_template, step_order) via update_or_create: pode
rodar de novo sem duplicar. TPL-HARDWARE-INSTALL fica sem etapas nesta
etapa (não há Activities específicas suficientes ainda — não criar steps
artificiais)."""

from django.db import migrations

# Configuração default por Activity (required, repeatable, quantity_source),
# reaproveitada em todos os templates onde a mesma atividade aparece sem
# uma configuração específica indicada.
ACTIVITY_DEFAULTS = {
    "MAT-SEP": (True, False, "SCOPE_ITEM"),
    "MAT-CHECK": (True, False, "SCOPE_ITEM"),
    "CAB-MEASURE": (True, True, "CABLE_COUNT"),
    "CAB-CUT": (True, True, "CABLE_COUNT"),
    "CAB-LABEL": (True, True, "CABLE_COUNT"),
    "CAB-RUN": (True, True, "CABLE_COUNT"),
    "CAB-DRESS": (True, True, "CABLE_COUNT"),
    "CAB-CRIMP": (True, True, "CONNECTION_COUNT"),
    "CAB-PATCH": (True, True, "LINK_COUNT"),
    "CERTIFY": (True, True, "LINK_COUNT"),
    "QAQC": (True, False, "PROJECT"),
    "EVIDENCE": (True, False, "PROJECT"),
    "HANDOVER": (True, False, "NONE"),
}

# task_template_code -> [(step_order, activity_code), ...]
TEMPLATE_STEPS = {
    "TPL-FIBER-PRETERMINATED": [
        (10, "MAT-SEP"), (20, "MAT-CHECK"), (30, "CAB-LABEL"), (40, "CAB-RUN"),
        (50, "CAB-DRESS"), (60, "CAB-PATCH"), (70, "CERTIFY"), (80, "QAQC"), (90, "EVIDENCE"),
    ],
    "TPL-FIBER-ROBUST": [
        (10, "MAT-SEP"), (20, "MAT-CHECK"), (30, "CAB-LABEL"), (40, "CAB-RUN"),
        (50, "CAB-DRESS"), (60, "CAB-PATCH"), (70, "CERTIFY"), (80, "QAQC"), (90, "EVIDENCE"),
    ],
    "TPL-FIBER-MPO": [
        (10, "MAT-SEP"), (20, "MAT-CHECK"), (30, "CAB-LABEL"), (40, "CAB-RUN"),
        (50, "CAB-DRESS"), (60, "CAB-PATCH"), (70, "CERTIFY"), (80, "QAQC"), (90, "EVIDENCE"),
    ],
    "TPL-COPPER-FIELD-TERMINATED": [
        (10, "MAT-SEP"), (20, "MAT-CHECK"), (30, "CAB-MEASURE"), (40, "CAB-CUT"),
        (50, "CAB-LABEL"), (60, "CAB-RUN"), (70, "CAB-DRESS"), (80, "CAB-CRIMP"),
        (90, "CERTIFY"), (100, "CAB-PATCH"), (110, "QAQC"), (120, "EVIDENCE"),
    ],
    "TPL-COPPER-PRETERMINATED": [
        (10, "MAT-SEP"), (20, "MAT-CHECK"), (30, "CAB-LABEL"), (40, "CAB-RUN"),
        (50, "CAB-DRESS"), (60, "CERTIFY"), (70, "CAB-PATCH"), (80, "QAQC"), (90, "EVIDENCE"),
    ],
    "TPL-WAP-COPPER": [
        (10, "MAT-SEP"), (20, "MAT-CHECK"), (30, "CAB-MEASURE"), (40, "CAB-CUT"),
        (50, "CAB-LABEL"), (60, "CAB-RUN"), (70, "CAB-DRESS"), (80, "CAB-CRIMP"),
        (90, "CERTIFY"), (100, "CAB-PATCH"), (110, "QAQC"), (120, "EVIDENCE"),
    ],
    "TPL-HARDWARE-INSTALL": [],
    "TPL-PROJECT-CLOSURE": [
        (10, "QAQC"), (20, "EVIDENCE"), (30, "HANDOVER"),
    ],
}


def seed_task_template_steps(apps, schema_editor):
    TaskTemplate = apps.get_model("master_data", "TaskTemplate")
    Activity = apps.get_model("master_data", "Activity")
    TaskTemplateStep = apps.get_model("master_data", "TaskTemplateStep")

    for template_code, steps in TEMPLATE_STEPS.items():
        template = TaskTemplate.objects.filter(code=template_code).first()
        if template is None:
            continue
        for step_order, activity_code in steps:
            activity = Activity.objects.filter(code=activity_code).first()
            if activity is None:
                continue
            required, repeatable, quantity_source = ACTIVITY_DEFAULTS.get(activity_code, (True, False, ""))
            TaskTemplateStep.objects.update_or_create(
                task_template=template,
                step_order=step_order,
                defaults={
                    "activity": activity,
                    "required": required,
                    "repeatable": repeatable,
                    "quantity_source": quantity_source,
                    "active": True,
                },
            )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0027_tasktemplatestep"),
    ]

    operations = [
        migrations.RunPython(seed_task_template_steps, migrations.RunPython.noop),
    ]

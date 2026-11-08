"""Seed inicial das regras de seleção de Template de Tarefa — a base do
futuro motor de geração automática de tarefas (Rules Engine). Idempotente e
chaveado por `code` via update_or_create: pode rodar de novo sem duplicar.

Regras 1-13 são específicas por Família de Cabo (fibra); as duas de CAT6
(14/15) também restringem por `preterminated` (a mesma família COP-CAT6
pode ser usada terminada em campo OU pré-terminada, dependendo do item de
escopo — por isso a regra usa o atributo, não um valor fixo assumido a
partir de CableFamily.preterminated); as duas últimas (16/17) são
fallbacks genéricos por `medium`, sem família específica, com priority=500
(a menor prioridade possível entre as regras seedadas aqui)."""

from django.db import migrations

RULES = [
    {
        "code": "RULE-FIB-2F-ROBUST",
        "name": "2F Robust → Template Fiber Robust",
        "task_template": "TPL-FIBER-ROBUST",
        "cable_family": "FIB-2F-ROBUST",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-2F-TB-ROBUST",
        "name": "2F TB Robust → Template Fiber Robust",
        "task_template": "TPL-FIBER-ROBUST",
        "cable_family": "FIB-2F-TB-ROBUST",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-2F-RAF",
        "name": "2F RAF → Template Fiber Preterminated",
        "task_template": "TPL-FIBER-PRETERMINATED",
        "cable_family": "FIB-2F-RAF",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-2F-LCLC",
        "name": "2F LC-LC → Template Fiber Preterminated",
        "task_template": "TPL-FIBER-PRETERMINATED",
        "cable_family": "FIB-2F-LCLC",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-8F-LCLC",
        "name": "8F LC-LC → Template Fiber Preterminated",
        "task_template": "TPL-FIBER-PRETERMINATED",
        "cable_family": "FIB-8F-LCLC",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-12F-LCLC",
        "name": "12F LC-LC → Template Fiber Preterminated",
        "task_template": "TPL-FIBER-PRETERMINATED",
        "cable_family": "FIB-12F-LCLC",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-18F-LCLC",
        "name": "18F LC-LC → Template Fiber Preterminated",
        "task_template": "TPL-FIBER-PRETERMINATED",
        "cable_family": "FIB-18F-LCLC",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-36F-LCLC",
        "name": "36F LC-LC → Template Fiber Preterminated",
        "task_template": "TPL-FIBER-PRETERMINATED",
        "cable_family": "FIB-36F-LCLC",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-36F-OS2-LCU",
        "name": "36F OS2 LCU/LCU → Template Fiber Preterminated",
        "task_template": "TPL-FIBER-PRETERMINATED",
        "cable_family": "FIB-36F-OS2-LCU",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-72F-MPOB",
        "name": "72F MPO-B → Template Fiber MPO",
        "task_template": "TPL-FIBER-MPO",
        "cable_family": "FIB-72F-MPOB",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-144F-MPOB",
        "name": "144F MPO-B → Template Fiber MPO",
        "task_template": "TPL-FIBER-MPO",
        "cable_family": "FIB-144F-MPOB",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-288F-MPO-MPO",
        "name": "288F MPO-MPO → Template Fiber MPO",
        "task_template": "TPL-FIBER-MPO",
        "cable_family": "FIB-288F-MPO-MPO",
        "priority": 10,
    },
    {
        "code": "RULE-FIB-288F-MPO-LC",
        "name": "288F MPO-LC → Template Fiber MPO",
        "task_template": "TPL-FIBER-MPO",
        "cable_family": "FIB-288F-MPO-LC",
        "priority": 10,
    },
    {
        "code": "RULE-CAT6-FIELD",
        "name": "CAT6 Terminado em Campo",
        "task_template": "TPL-COPPER-FIELD-TERMINATED",
        "cable_family": "COP-CAT6",
        "preterminated": False,
        "priority": 10,
    },
    {
        "code": "RULE-CAT6-PRETERM",
        "name": "CAT6 Pré-Terminada",
        "task_template": "TPL-COPPER-PRETERMINATED",
        "cable_family": "COP-CAT6",
        "preterminated": True,
        "priority": 10,
    },
    {
        "code": "RULE-FIBER-GENERIC",
        "name": "Fallback Fibra Pré-Terminada",
        "task_template": "TPL-FIBER-PRETERMINATED",
        "medium": "FIBER",
        "priority": 500,
    },
    {
        "code": "RULE-COPPER-GENERIC",
        "name": "Fallback Copper Terminado em Campo",
        "task_template": "TPL-COPPER-FIELD-TERMINATED",
        "medium": "COPPER",
        "priority": 500,
    },
]


def seed_task_template_rules(apps, schema_editor):
    TaskTemplate = apps.get_model("master_data", "TaskTemplate")
    CableFamily = apps.get_model("master_data", "CableFamily")
    TaskTemplateRule = apps.get_model("master_data", "TaskTemplateRule")

    for rule in RULES:
        template = TaskTemplate.objects.filter(code=rule["task_template"]).first()
        if template is None:
            continue
        cable_family = None
        family_code = rule.get("cable_family")
        if family_code:
            cable_family = CableFamily.objects.filter(code=family_code).first()
            if cable_family is None:
                continue
        TaskTemplateRule.objects.update_or_create(
            code=rule["code"],
            defaults={
                "name": rule["name"],
                "task_template": template,
                "cable_family": cable_family,
                "medium": rule.get("medium", ""),
                "preterminated": rule.get("preterminated"),
                "priority": rule["priority"],
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0029_tasktemplaterule"),
    ]

    operations = [
        migrations.RunPython(seed_task_template_rules, migrations.RunPython.noop),
    ]

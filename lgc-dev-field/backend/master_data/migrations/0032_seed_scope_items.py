"""Seed de teste de ScopeItem — só 3 itens, para exercitar manualmente o
fluxo completo (SOW/Texto Livre -> ScopeItem -> Task Rule Resolver ->
TaskTemplate) antes de qualquer geração automática por IA existir.
Idempotente e chaveado por `raw_text` via update_or_create (não por
`code`, que normalmente é gerado pela sequência em ScopeItem.save() — aqui
o `code` é atribuído explicitamente, já que a migration usa o model
histórico, que não tem o save() customizado). Avança
ScopeItemSequence.last_number para 3 (nunca regride), para que o próximo
ScopeItem criado pela aplicação continue a numeração a partir de aí, sem
colidir com os códigos fixos usados aqui."""

from django.db import migrations

# (code, raw_text, item_type, cable_family_code, cable_spec_code, quantity,
#  unit, length_type, length_m, medium, preterminated, source_type)
SCOPE_ITEMS = [
    (
        "SCOPE-ITEM-000001",
        "2x 72F OS2 Yellow MPO/MPO, MPO-B, 0072X6P64 with 50m",
        "CABLE",
        "FIB-72F-MPOB",
        "SPEC-72F-MPOB-0072X6P64",
        2,
        "CABLE",
        "EXACT",
        "50",
        "FIBER",
        None,
        "SOW",
    ),
    (
        "SCOPE-ITEM-000002",
        "10x CAT6 UTP up to 60m",
        "CABLE",
        "COP-CAT6",
        "",
        10,
        "CABLE",
        "MAXIMUM",
        "60",
        "COPPER",
        False,
        "SOW",
    ),
    (
        "SCOPE-ITEM-000003",
        "4x 2F robust fibers up to 60m",
        "CABLE",
        "FIB-2F-ROBUST",
        "",
        4,
        "CABLE",
        "MAXIMUM",
        "60",
        "FIBER",
        None,
        "SOW",
    ),
]


def seed_scope_items(apps, schema_editor):
    CableFamily = apps.get_model("master_data", "CableFamily")
    CableSpec = apps.get_model("master_data", "CableSpec")
    ScopeItem = apps.get_model("master_data", "ScopeItem")
    ScopeItemSequence = apps.get_model("master_data", "ScopeItemSequence")

    for (
        code,
        raw_text,
        item_type,
        family_code,
        spec_code,
        quantity,
        unit,
        length_type,
        length_m,
        medium,
        preterminated,
        source_type,
    ) in SCOPE_ITEMS:
        cable_family = CableFamily.objects.filter(code=family_code).first() if family_code else None
        cable_spec = CableSpec.objects.filter(code=spec_code).first() if spec_code else None
        ScopeItem.objects.update_or_create(
            raw_text=raw_text,
            defaults={
                "code": code,
                "item_type": item_type,
                "cable_family": cable_family,
                "cable_spec": cable_spec,
                "quantity": quantity,
                "unit": unit,
                "length_type": length_type,
                "length_m": length_m,
                "medium": medium,
                "preterminated": preterminated,
                "source_type": source_type,
                "active": True,
            },
        )

    sequence, _ = ScopeItemSequence.objects.get_or_create(pk=1)
    if sequence.last_number < len(SCOPE_ITEMS):
        sequence.last_number = len(SCOPE_ITEMS)
        sequence.save(update_fields=("last_number",))


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0031_scopeitem"),
    ]

    operations = [
        migrations.RunPython(seed_scope_items, migrations.RunPython.noop),
    ]

"""Seed inicial do catálogo canônico de Redes — as 6 redes/tipos de
serviço de cabeamento já conhecidos (função lógica da conexão, não o tipo
físico do cabo nem a frente de execução do projeto). Idempotente e
chaveado por `code` (update_or_create): pode rodar de novo sem duplicar."""

from django.db import migrations

# (code, name, domain, medium)
NETWORKS = [
    ("CORP_FIBER", "Corporate Fiber", "CORPORATE", "FIBER"),
    ("CONSOLE_FIBER", "Console Fiber", "CONSOLE", "FIBER"),
    ("MN_FIBER", "Management Network Fiber", "MANAGEMENT", "FIBER"),
    ("CONSOLE_COPPER", "Console Copper", "CONSOLE", "COPPER"),
    ("MN_COPPER", "Management Network Copper", "MANAGEMENT", "COPPER"),
    ("WAP_COPPER", "WAP Copper", "WAP", "COPPER"),
]


def seed_networks(apps, schema_editor):
    Network = apps.get_model("master_data", "Network")
    for code, name, domain, medium in NETWORKS:
        Network.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "domain": domain,
                "medium": medium,
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0013_network"),
    ]

    operations = [
        migrations.RunPython(seed_networks, migrations.RunPython.noop),
    ]

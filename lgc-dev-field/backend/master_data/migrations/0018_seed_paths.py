"""Seed inicial do catálogo canônico de Rotas/Caminhos — os 6 tipos de
caminho já conhecidos dos SOWs analisados (padroniza termos equivalentes
como "Route A"/"Path A"/"Rota A" -> PATH-A). Idempotente e chaveado por
`code` (update_or_create): pode rodar de novo sem duplicar."""

from django.db import migrations

# (code, name, path_group, path_type, description)
PATHS = [
    (
        "PATH-A",
        "Path A",
        "REDUNDANT_PATH",
        "A",
        "Caminho redundante A utilizado para segregação de rota.",
    ),
    (
        "PATH-B",
        "Path B",
        "REDUNDANT_PATH",
        "B",
        "Caminho redundante B utilizado para segregação de rota.",
    ),
    (
        "INTER-RACK",
        "Inter-rack",
        "INTERNAL",
        "INTER_RACK",
        "Conexão executada entre racks sem classificação específica de Path A/B.",
    ),
    (
        "CROSS-CONNECT",
        "Cross Connection",
        "CROSS_CONNECTION",
        "CROSS_CONNECT",
        "Conexão do tipo cross-connect entre pontos/racks.",
    ),
    (
        "DIRECT-DUCT",
        "Direct Duct",
        "DUCT",
        "DIRECT",
        "Cabeamento executado diretamente através de dutos.",
    ),
    (
        "UNSPECIFIED",
        "Não especificado",
        "UNSPECIFIED",
        "UNSPECIFIED",
        "Utilizado quando o escopo não informa rota ou caminho.",
    ),
]


def seed_paths(apps, schema_editor):
    Path = apps.get_model("master_data", "Path")
    for code, name, path_group, path_type, description in PATHS:
        Path.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "path_group": path_group,
                "path_type": path_type,
                "description": description,
                "active": True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0017_path"),
    ]

    operations = [
        migrations.RunPython(seed_paths, migrations.RunPython.noop),
    ]

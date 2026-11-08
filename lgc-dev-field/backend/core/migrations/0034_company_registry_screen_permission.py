from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0033_populate_regions"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="company",
            options={
                "ordering": ("legal_name",),
                "permissions": [("access_registry_screen", "Pode acessar a tela Cadastros Gerais")],
                "verbose_name": "empresa",
                "verbose_name_plural": "empresas",
            },
        ),
    ]

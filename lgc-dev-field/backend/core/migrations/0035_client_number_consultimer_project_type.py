import django.db.models.deletion
from django.db import migrations, models


def populate_client_numbers(apps, schema_editor):
    Client = apps.get_model("core", "Client")
    for number, client in enumerate(Client.objects.order_by("id"), start=1):
        client.number = number
        client.save(update_fields=["number"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0034_company_registry_screen_permission"),
    ]

    operations = [
        migrations.CreateModel(
            name="ConsultimerProjectType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("name", models.CharField(max_length=100, verbose_name="nome")),
                ("code", models.CharField(max_length=10, unique=True, verbose_name="sigla")),
                ("description", models.TextField(blank=True, verbose_name="descrição")),
                ("is_active", models.BooleanField(default=True, verbose_name="ativo")),
            ],
            options={
                "verbose_name": "Tipo de Projeto Consultimer",
                "verbose_name_plural": "Tipos de Projeto Consultimer",
                "ordering": ("name",),
            },
        ),
        migrations.AddField(
            model_name="client",
            name="number",
            field=models.PositiveIntegerField(blank=True, editable=False, null=True, unique=True, verbose_name="número do cadastro"),
        ),
        migrations.RunPython(populate_client_numbers, migrations.RunPython.noop),
    ]

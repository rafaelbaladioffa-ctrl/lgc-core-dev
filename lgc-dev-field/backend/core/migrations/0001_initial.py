from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name="Company",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("legal_name", models.CharField(max_length=255, verbose_name="razao social")),
                ("trade_name", models.CharField(blank=True, max_length=255, verbose_name="nome fantasia")),
                ("tax_id", models.CharField(max_length=18, unique=True, verbose_name="CNPJ/CPF")),
                ("email", models.EmailField(blank=True, max_length=254, verbose_name="e-mail")),
                ("phone", models.CharField(blank=True, max_length=20, verbose_name="telefone")),
                ("is_active", models.BooleanField(default=True, verbose_name="ativa")),
            ],
            options={"verbose_name": "empresa", "verbose_name_plural": "empresas", "ordering": ("legal_name",)},
        )
    ]


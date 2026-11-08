from django.db import migrations, models
import django.db.models.deletion


def populate_client_from_company(apps, schema_editor):
    Site = apps.get_model("core", "Site")
    Client = apps.get_model("core", "Client")

    for site in Site.objects.all():
        if not site.company_id:
            continue
        client = Client.objects.filter(company_id=site.company_id).order_by("pk").first()
        if client is None:
            company = site.company
            client = Client.objects.create(
                company_id=site.company_id,
                legal_name=company.legal_name,
                trade_name=company.trade_name,
                tax_id=company.tax_id,
            )
        site.client_id = client.pk
        site.save(update_fields=["client"])


def noop_reverse(apps, schema_editor):
    # Não há como reverter com segurança sem perder informação (múltiplos
    # sites de clientes diferentes da mesma empresa colapsariam de volta
    # em "company"); mantemos os dados de client intactos ao reverter.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0018_site_manual_coordinates_alter_site_latitude_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="site",
            name="client",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="sites",
                to="core.client",
                verbose_name="cliente",
            ),
        ),
        migrations.RunPython(populate_client_from_company, noop_reverse),
        migrations.RemoveConstraint(
            model_name="site",
            name="unique_site_code_per_company",
        ),
        migrations.RemoveField(
            model_name="site",
            name="company",
        ),
        migrations.AlterField(
            model_name="site",
            name="client",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="sites",
                to="core.client",
                verbose_name="cliente",
            ),
        ),
        migrations.AddConstraint(
            model_name="site",
            constraint=models.UniqueConstraint(
                condition=~models.Q(code=""),
                fields=("client", "code"),
                name="unique_site_code_per_client",
            ),
        ),
    ]

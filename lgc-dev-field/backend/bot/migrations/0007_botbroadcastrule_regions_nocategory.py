from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bot", "0006_botbroadcastrule"),
        ("core", "0033_populate_regions"),
    ]

    operations = [
        migrations.AddField(
            model_name="botbroadcastrule",
            name="regions",
            field=models.ManyToManyField(blank=True, related_name="+", to="core.region", verbose_name="regionais"),
        ),
        migrations.AddField(
            model_name="botbroadcastrule",
            name="include_no_category",
            field=models.BooleanField(
                default=False,
                help_text="Só vale quando há categorias selecionadas; sem categorias, todos entram.",
                verbose_name="incluir projetos sem categoria",
            ),
        ),
    ]

"""Reformula CableAlias para a segunda entidade de Cadastros Mestres
(Aliases de Cabo): troca alias_text/is_active por alias/normalized_alias
(calculado e único)/alias_type/description/active, adiciona created_by/
updated_by (mesmo padrão de rastreio de CableFamily, via MasterDataModel) e
muda o FK para PROTECT (a família nunca é apagada de fato, só inativada —
não faz sentido permitir apagar uma família que já tem alias apontando para
ela). Escrita à mão em vez de gerada por makemigrations porque a tabela
está vazia em produção (entidade só tinha o modelo, sem tela/API ainda) —
sem necessidade de preservar/migrar dado nenhum."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0004_fix_cable_family_technical_attributes"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="cablealias",
            name="unique_alias_per_family",
        ),
        migrations.RemoveField(
            model_name="cablealias",
            name="alias_text",
        ),
        migrations.RemoveField(
            model_name="cablealias",
            name="is_active",
        ),
        migrations.AddField(
            model_name="cablealias",
            name="alias",
            field=models.CharField(default="", max_length=200, verbose_name="alias"),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="cablealias",
            name="normalized_alias",
            field=models.CharField(blank=True, editable=False, max_length=200, unique=True, verbose_name="alias normalizado"),
        ),
        migrations.AddField(
            model_name="cablealias",
            name="alias_type",
            field=models.CharField(blank=True, max_length=50, verbose_name="tipo do alias"),
        ),
        migrations.AddField(
            model_name="cablealias",
            name="description",
            field=models.TextField(blank=True, verbose_name="descrição"),
        ),
        migrations.AddField(
            model_name="cablealias",
            name="active",
            field=models.BooleanField(default=True, verbose_name="ativo"),
        ),
        migrations.AddField(
            model_name="cablealias",
            name="created_by",
            field=models.ForeignKey(
                blank=True,
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
                verbose_name="criado por",
            ),
        ),
        migrations.AddField(
            model_name="cablealias",
            name="updated_by",
            field=models.ForeignKey(
                blank=True,
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
                verbose_name="atualizado por",
            ),
        ),
        migrations.AlterField(
            model_name="cablealias",
            name="cable_family",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="aliases",
                to="master_data.cablefamily",
                verbose_name="família de cabo",
            ),
        ),
        migrations.AlterModelOptions(
            name="cablealias",
            options={"ordering": ("alias",), "verbose_name": "Alias de Cabo", "verbose_name_plural": "Aliases de Cabo"},
        ),
    ]

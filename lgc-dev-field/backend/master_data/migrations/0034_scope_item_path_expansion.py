import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("master_data", "0033_generatedtask"),
    ]

    operations = [
        migrations.AddField(
            model_name="scopeitem",
            name="expansion_mode",
            field=models.CharField(blank=True, default="NONE", max_length=20, verbose_name="modo de expansão"),
        ),
        migrations.AddField(
            model_name="scopeitem",
            name="tasks_outdated",
            field=models.BooleanField(default=False, verbose_name="tarefas desatualizadas"),
        ),
        migrations.AddField(
            model_name="generatedtask",
            name="expansion_key",
            field=models.CharField(default="DEFAULT", max_length=50, verbose_name="chave de expansão"),
        ),
        migrations.AddField(
            model_name="generatedtask",
            name="path",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="generated_tasks",
                to="master_data.path",
                verbose_name="rota/caminho",
            ),
        ),
        migrations.RemoveConstraint(
            model_name="generatedtask",
            name="unique_generated_task_per_scope_item_step",
        ),
        migrations.AddConstraint(
            model_name="generatedtask",
            constraint=models.UniqueConstraint(
                fields=("scope_item", "task_template_step", "expansion_key"),
                name="unique_generated_task_per_scope_item_step_expansion",
            ),
        ),
        migrations.CreateModel(
            name="ScopeItemPath",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("sequence", models.PositiveIntegerField(default=0, verbose_name="sequência")),
                ("active", models.BooleanField(default=True, verbose_name="ativo")),
                (
                    "path",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="scope_item_path_entries",
                        to="master_data.path",
                        verbose_name="rota/caminho",
                    ),
                ),
                (
                    "scope_item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="scope_item_paths",
                        to="master_data.scopeitem",
                        verbose_name="item de escopo",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="criado por",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="atualizado por",
                    ),
                ),
            ],
            options={
                "verbose_name": "Rota do Item de Escopo",
                "verbose_name_plural": "Rotas do Item de Escopo",
                "ordering": ("scope_item", "sequence", "path"),
            },
        ),
        migrations.AddConstraint(
            model_name="scopeitempath",
            constraint=models.UniqueConstraint(fields=("scope_item", "path"), name="unique_scope_item_path"),
        ),
    ]

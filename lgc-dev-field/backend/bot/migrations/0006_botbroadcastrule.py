from django.db import migrations, models


def seed_default_rules(apps, schema_editor):
    """Reproduz o comportamento antes fixo no código: 15h texto e 15h01 print,
    só projetos do cliente A100 na categoria GND. Se cliente/categoria não
    forem encontrados, as regras nascem DESATIVADAS — filtro vazio significaria
    "todos os projetos"."""
    from datetime import time

    from django.db.models import Q

    Rule = apps.get_model("bot", "BotBroadcastRule")
    Client = apps.get_model("core", "Client")
    Category = apps.get_model("core", "Category")
    if Rule.objects.exists():
        return
    clients = list(
        Client.objects.filter(Q(trade_name__icontains="A100") | Q(legal_name__icontains="A100"))
    )
    categories = list(Category.objects.filter(name__icontains="GND"))
    ready = bool(clients and categories)
    for name, content_type, send_time, caption in (
        ("Relatório 15h (texto)", "text", time(15, 0), ""),
        ("Relatório 15h01 (print)", "image", time(15, 1), ""),
    ):
        rule = Rule.objects.create(
            name=name,
            content_type=content_type,
            send_time=send_time,
            weekdays=[],
            statuses=["in_progress"],
            image_caption=caption,
            is_active=ready,
        )
        rule.clients.set(clients)
        rule.categories.set(categories)


class Migration(migrations.Migration):

    dependencies = [
        ("bot", "0005_botmessagetemplate"),
        ("core", "0033_populate_regions"),
    ]

    operations = [
        migrations.CreateModel(
            name="BotBroadcastRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("name", models.CharField(max_length=150, verbose_name="nome")),
                ("is_active", models.BooleanField(default=True, verbose_name="ativa")),
                (
                    "message_type",
                    models.CharField(
                        default="daily_project_report", editable=False, max_length=40, verbose_name="tipo de mensagem"
                    ),
                ),
                (
                    "content_type",
                    models.CharField(
                        choices=[("text", "Texto (uma mensagem por projeto)"), ("image", "Imagem (print)")],
                        default="text",
                        max_length=10,
                        verbose_name="formato",
                    ),
                ),
                ("send_time", models.TimeField(verbose_name="horário de envio (Brasília)")),
                (
                    "weekdays",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text="0=segunda ... 6=domingo. Vazio = todos os dias.",
                        verbose_name="dias da semana",
                    ),
                ),
                (
                    "statuses",
                    models.JSONField(
                        blank=True, default=list, help_text="Vazio = qualquer status.", verbose_name="status do projeto"
                    ),
                ),
                ("image_caption", models.CharField(blank=True, max_length=250, verbose_name="legenda da imagem")),
                (
                    "categories",
                    models.ManyToManyField(blank=True, related_name="+", to="core.category", verbose_name="categorias"),
                ),
                (
                    "clients",
                    models.ManyToManyField(blank=True, related_name="+", to="core.client", verbose_name="clientes"),
                ),
                (
                    "recipients",
                    models.ManyToManyField(
                        blank=True,
                        help_text="Vazio = todos os destinatários que recebem a atualização diária de projeto.",
                        related_name="broadcast_rules",
                        to="bot.botsubscriber",
                        verbose_name="destinatários",
                    ),
                ),
                (
                    "sites",
                    models.ManyToManyField(blank=True, related_name="+", to="core.site", verbose_name="sites"),
                ),
            ],
            options={
                "verbose_name": "Regra de envio do Bot",
                "verbose_name_plural": "Regras de envio do Bot",
                "ordering": ("send_time", "id"),
            },
        ),
        migrations.RunPython(seed_default_rules, migrations.RunPython.noop),
    ]

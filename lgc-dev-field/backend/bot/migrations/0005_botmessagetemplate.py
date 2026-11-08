# Generated manually for BotMessageTemplate.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bot", "0004_botsubscriber_group_jid"),
    ]

    operations = [
        migrations.CreateModel(
            name="BotMessageTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                (
                    "message_type",
                    models.CharField(
                        choices=[
                            ("daily_tasks", "Tarefas do dia"),
                            ("project_updates", "Atualização de projetos"),
                            ("operations_print", "Print da Operação do Dia"),
                            ("daily_project_report", "Relatório diário de projeto"),
                        ],
                        max_length=40,
                        unique=True,
                        verbose_name="tipo de mensagem",
                    ),
                ),
                ("title", models.CharField(blank=True, max_length=180, verbose_name="título")),
                ("intro_text", models.TextField(blank=True, verbose_name="texto inicial")),
                ("footer_text", models.TextField(blank=True, verbose_name="texto final")),
                ("enabled_fields", models.JSONField(blank=True, default=dict, verbose_name="campos habilitados")),
                ("is_active", models.BooleanField(default=True, verbose_name="ativo")),
            ],
            options={
                "verbose_name": "Modelo de mensagem do Bot",
                "verbose_name_plural": "Modelos de mensagem do Bot",
                "ordering": ("message_type",),
            },
        ),
    ]

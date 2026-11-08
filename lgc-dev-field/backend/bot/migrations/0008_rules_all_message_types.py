from django.db import migrations, models

RULE_TYPES = [
    ("daily_project_report", "Relatório diário de projeto"),
    ("daily_tasks", "Tarefas do dia"),
    ("project_updates", "Atualização de projetos"),
    ("allocation", "Alocação diária aos técnicos"),
    ("operations_print", "Print da operação"),
]


def seed_rules(apps, schema_editor):
    """Cria regras equivalentes aos horários que estavam fixos no bot
    (10h tarefas, 17h atualização, 18h alocação do dia seguinte e prints às
    8/10/12/14/16/18h), sem filtros — comportamento idêntico ao anterior."""
    from datetime import time

    Rule = apps.get_model("bot", "BotBroadcastRule")
    seeds = [
        ("daily_tasks", "Tarefas do dia (10h)", "text", time(10, 0), 0),
        ("project_updates", "Atualização de projetos (17h)", "text", time(17, 0), 0),
        ("allocation", "Alocação do dia seguinte (18h)", "text", time(18, 0), 1),
    ] + [
        ("operations_print", f"Print da operação ({h}h)", "image", time(h, 0), 0) for h in (8, 10, 12, 14, 16, 18)
    ]
    for message_type, name, content_type, send_time, offset in seeds:
        if Rule.objects.filter(message_type=message_type, send_time=send_time).exists():
            continue
        Rule.objects.create(
            message_type=message_type,
            name=name,
            content_type=content_type,
            send_time=send_time,
            date_offset_days=offset,
            weekdays=[],
            statuses=[],
            is_active=True,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("bot", "0007_botbroadcastrule_regions_nocategory"),
    ]

    operations = [
        migrations.AlterField(
            model_name="botmessagetemplate",
            name="message_type",
            field=models.CharField(
                choices=[
                    ("daily_tasks", "Tarefas do dia"),
                    ("project_updates", "Atualização de projetos"),
                    ("operations_print", "Print da Operação do Dia"),
                    ("daily_project_report", "Relatório diário de projeto"),
                    ("allocation", "Alocação diária aos técnicos"),
                    ("interactive_menu", "Menu /bot"),
                ],
                max_length=40,
                unique=True,
                verbose_name="tipo de mensagem",
            ),
        ),
        migrations.AlterField(
            model_name="botbroadcastrule",
            name="message_type",
            field=models.CharField(
                choices=RULE_TYPES, default="daily_project_report", max_length=40, verbose_name="tipo de mensagem"
            ),
        ),
        migrations.AddField(
            model_name="botbroadcastrule",
            name="date_offset_days",
            field=models.IntegerField(
                default=0,
                help_text="0 = dados de hoje; 1 = dados de amanhã (ex.: alocação do dia seguinte).",
                verbose_name="dias à frente dos dados",
            ),
        ),
        migrations.RunPython(seed_rules, migrations.RunPython.noop),
    ]

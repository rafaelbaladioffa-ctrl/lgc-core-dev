from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0037_assignment_time_allocated"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttask",
            name="exclude_from_reports",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Tarefa de teste ou com apontamento errado (ex.: em lote): não entra em Relatórios e Indicadores "
                    "(HH, produção por técnico, estimativa por atividade e relatório gerencial). Nada é apagado."
                ),
                verbose_name="ignorar nos relatórios",
            ),
        ),
    ]

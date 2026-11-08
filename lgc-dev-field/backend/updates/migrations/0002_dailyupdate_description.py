from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("updates", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="dailyupdate",
            name="description",
            field=models.TextField(
                blank=True,
                editable=False,
                help_text="Mensagem gerada automaticamente para envio aos técnicos.",
                verbose_name="descritivo para envio",
            ),
        ),
    ]

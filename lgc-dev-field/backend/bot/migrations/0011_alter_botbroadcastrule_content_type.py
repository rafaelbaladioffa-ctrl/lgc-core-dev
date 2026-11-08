from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bot", "0010_botbroadcastrule_managers"),
    ]

    operations = [
        migrations.AlterField(
            model_name="botbroadcastrule",
            name="content_type",
            field=models.CharField(
                choices=[("text", "Texto"), ("image", "Imagem (print)")],
                default="text",
                max_length=10,
                verbose_name="formato",
            ),
        ),
    ]

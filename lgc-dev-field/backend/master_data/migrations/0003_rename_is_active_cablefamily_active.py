from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("master_data", "0002_seed_cable_families"),
    ]

    operations = [
        migrations.RenameField(
            model_name="cablefamily",
            old_name="is_active",
            new_name="active",
        ),
    ]

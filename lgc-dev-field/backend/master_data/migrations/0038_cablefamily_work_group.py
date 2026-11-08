from django.db import migrations, models

GROUP_BY_CODE = {
    "COP-CAT6": "COPPER_CAT6",
    "FIB-2F-LCLC": "FIBER_2F",
    "FIB-2F-ROBUST": "FIBER_2F",
    "FIB-2F-TB-ROBUST": "FIBER_2F",
    "FIB-2F-RAF": "FIBER_2F",
    "FIB-8F-LCLC": "TRUNK_LC_SMALL",
    "FIB-12F-LCLC": "TRUNK_LC_SMALL",
    "FIB-18F-LCLC": "TRUNK_LC_SMALL",
    "FIB-36F-LCLC": "TRUNK_LC_LARGE",
    "FIB-36F-OS2-LCU": "TRUNK_LC_LARGE",
    "FIB-72F-LCLC": "TRUNK_LC_LARGE",
    "FIB-72F-MPOB": "TRUNK_MPO",
    "FIB-144F-MPOB": "TRUNK_MPO",
    "FIB-288F-MPO-MPO": "TRUNK_MPO",
    "FIB-288F-MPO-LC": "TRUNK_MPO",
    "BRK-MPO-4LC": "BREAKOUT",
    "FIB-100G-AOC-20M OM3 MM": "AOC",
}


def fill_groups(apps, schema_editor):
    CableFamily = apps.get_model("master_data", "CableFamily")
    for code, group in GROUP_BY_CODE.items():
        CableFamily.objects.filter(code=code, work_group="").update(work_group=group)


class Migration(migrations.Migration):
    dependencies = [
        ("master_data", "0037_sowimport_ai_mode"),
    ]

    operations = [
        migrations.AddField(
            model_name="cablefamily",
            name="work_group",
            field=models.CharField(
                blank=True,
                choices=[
                    ("COPPER_CAT6", "Cobre CAT6"),
                    ("FIBER_2F", "Fibra 2F"),
                    ("TRUNK_LC_SMALL", "Tronco LC pequeno (8F–18F)"),
                    ("TRUNK_LC_LARGE", "Tronco LC grande (36F–72F)"),
                    ("TRUNK_MPO", "Tronco MPO"),
                    ("BREAKOUT", "Breakout MPO–4×LC"),
                    ("AOC", "AOC 100G"),
                ],
                max_length=30,
                verbose_name="grupo de trabalho",
            ),
        ),
        migrations.RunPython(fill_groups, migrations.RunPython.noop),
    ]

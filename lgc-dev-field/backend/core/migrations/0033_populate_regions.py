from django.db import migrations


REGIONS = [
    # (country, code, name)
    ("BR", "GSP",        "Grande São Paulo"),
    ("BR", "INT_SP",     "Interior SP"),
    ("BR", "RIO",        "Rio de Janeiro"),
    ("BR", "SUL",        "Sul"),
    ("BR", "NE",         "Nordeste"),
    ("BR", "CO",         "Centro-Oeste"),
    ("BR", "NO",         "Norte"),
    ("US", "US_EAST",    "East Coast"),
    ("US", "US_WEST",    "West Coast"),
    ("US", "US_CENTRAL", "Central"),
    ("CL", "CL_SCL",     "Santiago"),
    ("CL", "CL_NORTE",   "Norte Chile"),
    ("CL", "CL_SUR",     "Sur Chile"),
    ("MX", "MX_CDMX",   "Cidade do México"),
    ("MX", "MX_BAJIO",  "Bajío"),
    ("MX", "MX_NORTE",  "Norte México"),
    ("MX", "MX_OCC",    "Occidente"),
]

CITY_TO_REGION = {
    # Grande São Paulo
    ("SP", "são paulo"):          "GSP",
    ("SP", "barueri"):            "GSP",
    ("SP", "osasco"):             "GSP",
    # Interior SP
    ("SP", "campinas"):           "INT_SP",
    ("SP", "hortolandia"):        "INT_SP",
    ("SP", "hortolândia"):        "INT_SP",
    ("SP", "jundiaí"):            "INT_SP",
    ("SP", "jundiai"):            "INT_SP",
    ("SP", "jundaí"):             "INT_SP",
    ("SP", "paulinia"):           "INT_SP",
    ("SP", "paulínia"):           "INT_SP",
    ("SP", "sumare"):             "INT_SP",
    ("SP", "sumaré"):             "INT_SP",
    ("SP", "vinhedo"):            "INT_SP",
    # Rio de Janeiro
    ("RJ", "rio de janeiro"):     "RIO",
    ("RJ", "sao joao de meriti"): "RIO",
    ("RJ", "são joão de meriti"): "RIO",
}


def populate_regions(apps, schema_editor):
    Region = apps.get_model("core", "Region")
    Site = apps.get_model("core", "Site")

    region_map = {}
    for country, code, name in REGIONS:
        r, _ = Region.objects.get_or_create(code=code, defaults={"country": country, "name": name})
        region_map[code] = r

    for site in Site.objects.filter(region__isnull=True):
        key = (site.state.strip().upper(), site.city.strip().lower())
        region_code = CITY_TO_REGION.get(key)
        if region_code and region_code in region_map:
            site.region = region_map[region_code]
            site.save(update_fields=["region"])


def remove_regions(apps, schema_editor):
    Region = apps.get_model("core", "Region")
    Site = apps.get_model("core", "Site")
    Site.objects.all().update(region=None)
    Region.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0032_add_region_model"),
    ]

    operations = [
        migrations.RunPython(populate_regions, remove_regions),
    ]

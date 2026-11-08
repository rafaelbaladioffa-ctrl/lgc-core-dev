"""Cadastro guiado de modelo de cabo (passo a passo): código e nome gerados
pelo sistema, família equivalente reaproveitada, aliases sugeridos, conflitos.

Valores de teste usam conectores fictícios (ZZ, ZY, ZX): a migração de seed
já cria os cabos reais na base de testes e uma colisão mascararia o teste.
"""

from django.contrib.auth.models import Permission
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from master_data.models import CableAlias, CableFamily, CableSpec
from master_data.services.cable_wizard import (
    WizardError,
    base_family_identity,
    base_spec_identity,
    clean_input,
    suggest_work_group,
)
from users.models import User


def fiber(**kwargs):
    data = {"medium": "FIBER", "category": "TRUNK", "fiber_count": 8, "connector_a": "LC", "connector_b": "LC"}
    data.update(kwargs)
    return clean_input(data)


class CableNamingTests(SimpleTestCase):
    """O gerador reproduz o padrão que já existe no catálogo."""

    def test_trunk_with_same_two_letter_connectors_are_joined(self):
        self.assertEqual(base_family_identity(fiber()), ("FIB-8F-LCLC", "8F LC-LC"))

    def test_trunk_with_different_connectors_uses_hyphen(self):
        cleaned = fiber(fiber_count=288, connector_a="MPO", connector_b="LC")
        self.assertEqual(base_family_identity(cleaned), ("FIB-288F-MPO-LC", "288F MPO-LC"))

    def test_trunk_with_same_long_connectors_uses_hyphen(self):
        cleaned = fiber(fiber_count=288, connector_a="MPO", connector_b="MPO")
        self.assertEqual(base_family_identity(cleaned), ("FIB-288F-MPO-MPO", "288F MPO-MPO"))

    def test_robust_ignores_connectors_in_code(self):
        cleaned = clean_input({"medium": "FIBER", "category": "ROBUST", "fiber_count": 2})
        self.assertEqual(base_family_identity(cleaned), ("FIB-2F-ROBUST", "2F Robust"))

    def test_copper_utp_and_shielded(self):
        utp = clean_input({"medium": "COPPER", "copper_type": "CAT6", "shielding": "UTP"})
        self.assertEqual(base_family_identity(utp), ("COP-CAT6", "CAT6 UTP"))
        shielded = clean_input({"medium": "COPPER", "copper_type": "CAT6A", "shielding": "F/UTP"})
        self.assertEqual(base_family_identity(shielded), ("COP-CAT6A-FUTP", "CAT6A F/UTP"))
        self.assertEqual(shielded["connector_a"], "RJ45")

    def test_breakout(self):
        cleaned = clean_input(
            {"medium": "FIBER", "category": "BREAKOUT", "legs": 4, "connector_a": "MPO", "connector_b": "LC"}
        )
        self.assertEqual(base_family_identity(cleaned), ("BRK-MPO-4LC", "MPO to 4xLC Breakout"))
        self.assertEqual(cleaned["fiber_count"], 8)

    def test_aoc(self):
        cleaned = clean_input({"medium": "FIBER", "category": "AOC", "speed": "100g", "length": "20m"})
        self.assertEqual(base_family_identity(cleaned), ("FIB-100G-AOC-20M", "100G-AOC-20M"))

    def test_spec_code_drops_length_placeholder_from_part_number(self):
        cleaned = fiber(spec={"part_number": "CX1A0012R6C03-XXXM"})
        code, _ = base_spec_identity(cleaned, "FIB-8F-LCLC", "8F LC-LC")
        self.assertEqual(code, "SPEC-8F-LCLC-CX1A0012R6C03")

    def test_descriptive_spec_name_follows_catalog_pattern(self):
        cleaned = fiber(
            fiber_count=72,
            connector_a="MPO",
            connector_b="MPO",
            spec={"part_number": "0072X6P64", "fiber_type": "os2", "jacket_color": "yellow", "polarity": "b"},
        )
        code, name = base_spec_identity(cleaned, "FIB-72F-MPOB", "72F MPO-MPO")
        self.assertEqual(code, "SPEC-72F-MPOB-0072X6P64")
        self.assertEqual(name, "72F OS2 Yellow MPO/MPO MPO-B")

    def test_spec_without_part_number_uses_manufacturer(self):
        cleaned = fiber(spec={"manufacturer": "Acme Fibras"})
        code, name = base_spec_identity(cleaned, "FIB-8F-LCLC", "8F LC-LC")
        self.assertEqual(code, "SPEC-8F-LCLC-ACMEFIBRAS")
        self.assertEqual(name, "8F LC-LC")

    def test_work_group_suggestions(self):
        self.assertEqual(suggest_work_group(fiber(fiber_count=8)), "TRUNK_LC_SMALL")
        self.assertEqual(suggest_work_group(fiber(fiber_count=36)), "TRUNK_LC_LARGE")
        self.assertEqual(suggest_work_group(fiber(fiber_count=72, connector_a="MPO", connector_b="MPO")), "TRUNK_MPO")
        self.assertEqual(suggest_work_group(fiber(fiber_count=2, category="PATCH")), "FIBER_2F")
        self.assertEqual(suggest_work_group(clean_input({"medium": "COPPER", "copper_type": "CAT6"})), "COPPER_CAT6")

    def test_validation_lists_what_is_missing(self):
        with self.assertRaises(WizardError) as ctx:
            clean_input({"medium": "FIBER", "category": "TRUNK"})
        self.assertTrue(any("fibras" in message for message in ctx.exception.errors))
        self.assertTrue(any("conector" in message.lower() for message in ctx.exception.errors))
        with self.assertRaises(WizardError):
            clean_input({})


class CableWizardApiTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="cable_wizard_admin", email="cable_wizard@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)

    def _preview(self, **extra):
        data = {"medium": "FIBER", "category": "TRUNK", "fiber_count": 5, "connector_a": "ZZ", "connector_b": "ZZ"}
        data.update(extra)
        return self.client_api.post("/api/master-data/cable-wizard/preview/", data, format="json")

    def _create(self, **extra):
        data = {"medium": "FIBER", "category": "TRUNK", "fiber_count": 5, "connector_a": "ZZ", "connector_b": "ZZ"}
        data.update(extra)
        return self.client_api.post("/api/master-data/cable-wizard/", data, format="json")

    def test_preview_new_family_generates_code_name_and_alias_suggestions(self):
        response = self._preview()
        self.assertEqual(response.status_code, 200, response.data)
        family = response.data["family"]
        self.assertEqual((family["mode"], family["code"], family["name"]), ("new", "FIB-5F-ZZZZ", "5F ZZ-ZZ"))
        texts = [entry["text"] for entry in response.data["aliases"]]
        self.assertEqual(texts, ["5F ZZ-ZZ", "5F ZZ/ZZ", "5F ZZ<>ZZ"])
        self.assertTrue(all(entry["selected"] for entry in response.data["aliases"]))
        self.assertTrue(response.data["can_create"])
        self.assertFalse(CableFamily.objects.filter(code="FIB-5F-ZZZZ").exists())

    def test_preview_finds_equivalent_existing_family(self):
        family = CableFamily.objects.create(
            code="TST-EQ", name="Equivalente", medium="FIBER", fiber_count=6,
            connector_a="ZY", connector_b="ZY", cable_category="TRUNK",
        )
        response = self._preview(fiber_count=6, connector_a="zy", connector_b="zy")
        self.assertEqual(response.data["family"]["mode"], "existing")
        self.assertEqual(response.data["family"]["id"], family.pk)
        self.assertEqual(response.data["family"]["code"], "TST-EQ")

    def test_copper_cat6a_is_not_mistaken_for_existing_cat6(self):
        CableFamily.objects.get_or_create(
            code="COP-CAT6",
            defaults={"name": "CAT6 UTP", "medium": "COPPER", "connector_a": "RJ45", "connector_b": "RJ45", "cable_category": "COPPER"},
        )
        response = self._preview(medium="COPPER", category="", copper_type="CAT6A", shielding="UTP")
        self.assertEqual(response.data["family"]["mode"], "new")
        self.assertEqual(response.data["family"]["code"], "COP-CAT6A")

    def test_create_ignores_code_and_name_sent_by_the_client(self):
        response = self._create(code="HACK", name="Nome inventado")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["family"]["code"], "FIB-5F-ZZZZ")
        self.assertFalse(CableFamily.objects.filter(code="HACK").exists())
        family = CableFamily.objects.get(code="FIB-5F-ZZZZ")
        self.assertEqual(family.name, "5F ZZ-ZZ")
        self.assertEqual(family.cable_category, "TRUNK")
        self.assertEqual(family.created_by, self.admin)

    def test_create_with_aliases_and_spec_follows_catalog_conventions(self):
        response = self._create(
            fiber_count=72,
            connector_a="ZW",
            connector_b="ZW",
            aliases=["72F ZW-ZW", "72F ZW/ZW", "meu apelido"],
            spec={
                "manufacturer": "Acme",
                "part_number": "WZ-0072-XXXM",
                "fiber_type": "os2",
                "jacket_color": "yellow",
                "polarity": "b",
            },
        )
        self.assertEqual(response.status_code, 201, response.data)
        family = CableFamily.objects.get(code="FIB-72F-ZWZW")
        self.assertEqual(family.work_group, "")  # conectores fora do padrão: sem sugestão
        aliases = {a.alias: a.alias_type for a in CableAlias.objects.filter(cable_family=family)}
        self.assertEqual(
            aliases,
            {"72F ZW-ZW": "NAME_VARIATION", "72F ZW/ZW": "NAME_VARIATION", "meu apelido": "NAME_VARIATION", "WZ-0072-XXXM": "PART_NUMBER"},
        )
        spec = CableSpec.objects.get(cable_family=family)
        self.assertEqual(spec.code, "SPEC-72F-ZWZW-WZ-0072")
        self.assertEqual(spec.name, "72F OS2 Yellow ZW/ZW ZW-B")
        self.assertEqual((spec.manufacturer, spec.part_number, spec.fiber_type), ("Acme", "WZ-0072-XXXM", "OS2"))

    def test_work_group_is_suggested_when_not_chosen(self):
        self._create(connector_a="LC", connector_b="LC", fiber_count=14)
        self.assertEqual(CableFamily.objects.get(code="FIB-14F-LCLC").work_group, "TRUNK_LC_SMALL")

    def test_user_can_explicitly_choose_no_work_group(self):
        self._create(connector_a="LC", connector_b="LC", fiber_count=15, work_group="NONE")
        self.assertEqual(CableFamily.objects.get(code="FIB-15F-LCLC").work_group, "")

    def test_chosen_work_group_is_saved_and_invalid_one_is_rejected(self):
        self._create(connector_a="LC", connector_b="LC", fiber_count=16, work_group="BREAKOUT")
        self.assertEqual(CableFamily.objects.get(code="FIB-16F-LCLC").work_group, "BREAKOUT")
        invalid = self._create(connector_a="LC", connector_b="LC", fiber_count=17, work_group="INEXISTENTE")
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(CableFamily.objects.filter(code="FIB-17F-LCLC").exists())

    def test_no_aliases_are_created_when_none_is_chosen(self):
        response = self._create(aliases=[])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["aliases"], [])
        self.assertFalse(CableAlias.objects.filter(cable_family__code="FIB-5F-ZZZZ").exists())

    def test_equivalent_family_must_be_reused_instead_of_duplicated(self):
        family = CableFamily.objects.create(
            code="TST-EQ2", name="Equivalente 2", medium="FIBER", fiber_count=6,
            connector_a="ZY", connector_b="ZY", cable_category="TRUNK",
        )
        blocked = self._create(fiber_count=6, connector_a="ZY", connector_b="ZY")
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(CableFamily.objects.filter(connector_a="ZY", fiber_count=6).count(), 1)

        reused = self._create(
            fiber_count=6, connector_a="ZY", connector_b="ZY", reuse_family_id=family.pk, aliases=["6F ZY-ZY"]
        )
        self.assertEqual(reused.status_code, 201, reused.data)
        self.assertFalse(reused.data["family_created"])
        self.assertTrue(CableAlias.objects.filter(cable_family=family, alias="6F ZY-ZY").exists())

    def test_code_collision_with_other_category_gets_category_suffix(self):
        CableFamily.objects.create(
            code="FIB-7F-ZXZX", name="Patch 7F", medium="FIBER", fiber_count=7,
            connector_a="ZX", connector_b="ZX", cable_category="PATCH",
        )
        response = self._create(fiber_count=7, connector_a="ZX", connector_b="ZX", category="TRUNK")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["family"]["code"], "FIB-7F-ZXZX-TRUNK")
        self.assertEqual(response.data["family"]["name"], "7F ZX-ZX Trunk")

    def test_alias_owned_by_other_family_blocks_and_nothing_is_created(self):
        owner = CableFamily.objects.create(code="TST-OWNER-W", name="Dona")
        CableAlias.objects.create(cable_family=owner, alias="5F ZZ-ZZ")
        preview = self._preview()
        conflict = [a for a in preview.data["aliases"] if a["text"] == "5F ZZ-ZZ"][0]
        self.assertEqual(conflict["state"], "conflict")
        self.assertFalse(preview.data["can_create"])

        response = self._create(aliases=["5F ZZ-ZZ"])
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CableFamily.objects.filter(code="FIB-5F-ZZZZ").exists())

    def test_part_number_already_in_use_blocks_and_rolls_back(self):
        owner = CableFamily.objects.create(code="TST-SPEC-W", name="Dona da spec")
        CableSpec.objects.create(cable_family=owner, code="TST-SPEC-W-1", name="Spec", part_number="PN-DUP-1", active=True)
        response = self._create(spec={"part_number": "pn-dup-1"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CableFamily.objects.filter(code="FIB-5F-ZZZZ").exists())

    def test_spec_code_collision_is_disambiguated(self):
        other = CableFamily.objects.create(code="TST-OTHER-W", name="Outra")
        # Código que o sistema geraria já está ocupado por uma especificação antiga (inativa).
        CableSpec.objects.create(cable_family=other, code="SPEC-5F-ZZZZ-COL-2", name="Antiga", active=False)
        response = self._create(spec={"part_number": "COL-2"})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["spec"]["code"], "SPEC-5F-ZZZZ-COL-2-2")

    def test_invalid_input_returns_all_messages(self):
        response = self.client_api.post(
            "/api/master-data/cable-wizard/preview/", {"medium": "FIBER", "category": "TRUNK"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertGreaterEqual(len(response.data["errors"]), 2)

    def test_options_include_catalog_values(self):
        CableFamily.objects.create(code="TST-OPT", name="Opt", connector_a="ZQ", connector_b="ZQ", fiber_count=999)
        response = self.client_api.get("/api/master-data/cable-wizard/options/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("ZQ", response.data["connectors"])
        self.assertIn("LC", response.data["connectors"])
        self.assertIn(999, response.data["fiber_counts"])
        self.assertIn("OS2", response.data["fiber_types"])

    def test_permissions(self):
        outsider = User.objects.create_user(username="wiz_outsider", email="wo@example.com", password="x")
        client = APIClient()
        client.force_authenticate(user=outsider)
        self.assertEqual(client.get("/api/master-data/cable-wizard/options/").status_code, 403)

        viewer = User.objects.create_user(username="wiz_viewer", email="wv@example.com", password="x")
        viewer.user_permissions.add(Permission.objects.get(codename="view_cablefamily", content_type__app_label="master_data"))
        client.force_authenticate(user=viewer)
        self.assertEqual(client.get("/api/master-data/cable-wizard/options/").status_code, 200)
        payload = {"medium": "FIBER", "category": "TRUNK", "fiber_count": 5, "connector_a": "ZZ", "connector_b": "ZZ"}
        self.assertEqual(client.post("/api/master-data/cable-wizard/preview/", payload, format="json").status_code, 403)
        self.assertEqual(client.post("/api/master-data/cable-wizard/", payload, format="json").status_code, 403)

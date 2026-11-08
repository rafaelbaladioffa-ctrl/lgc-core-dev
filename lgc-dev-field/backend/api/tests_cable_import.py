"""Fluxo guiado de cadastro de modelos de cabo (Cadastros Mestres).

Códigos de teste com prefixo "TST-": a migração de seed
(master_data/0002_seed_cable_families) já cria os cabos reais na base de
testes, então usar esses códigos causaria colisão.
"""

from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIClient

from master_data.models import CableAlias, CableFamily, CableImport, CableImportItem, CableSpec
from master_data.services.cable_import import parse_cable_import_text, payload_from_line
from users.models import User


class CableImportParserTests(TestCase):
    def test_line_with_all_fields_becomes_payload(self):
        payload = payload_from_line("TST-A | 8F LC-LC | fibra | 8 | LC | LC | Acme | PN-1 | 8F LC/LC ; 8F LC Trunk")
        self.assertEqual(payload["code"], "TST-A")
        self.assertEqual(payload["medium"], CableFamily.MEDIUM_FIBER)
        self.assertEqual(payload["fiber_count"], 8)
        self.assertEqual(payload["manufacturer"], "Acme")
        self.assertEqual(payload["part_number"], "PN-1")
        self.assertEqual(payload["aliases"], ["8F LC/LC", "8F LC Trunk"])

    def test_only_code_and_name_are_required(self):
        payload = payload_from_line("TST-B | Cabo simples")
        self.assertEqual(payload["medium"], CableFamily.MEDIUM_FIBER)
        self.assertIsNone(payload["fiber_count"])
        self.assertEqual(payload["aliases"], [])

    def test_copper_medium_accepts_portuguese_and_english(self):
        self.assertEqual(payload_from_line("TST-C | Cat6 | cobre")["medium"], CableFamily.MEDIUM_COPPER)
        self.assertEqual(payload_from_line("TST-D | Cat6 | COPPER")["medium"], CableFamily.MEDIUM_COPPER)

    def test_invalid_lines_raise_readable_errors(self):
        with self.assertRaisesMessage(ValueError, "código é obrigatório"):
            payload_from_line(" | Nome sem código")
        with self.assertRaisesMessage(ValueError, "meio inválido"):
            payload_from_line("TST-E | Nome | plástico")
        with self.assertRaisesMessage(ValueError, "nº de fibras inválido"):
            payload_from_line("TST-F | Nome | fibra | oito")

    def test_text_skips_blank_and_comment_lines(self):
        rows = parse_cable_import_text("\n# cabeçalho\nTST-G | Um\n\nTST-H | Dois\n")
        self.assertEqual([row["line_number"] for row in rows], [3, 5])
        self.assertTrue(all(row["parse_error"] is None for row in rows))


class CableImportFlowTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="cable_import_admin", email="cable_import@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)

    def _create_import(self, text, title="Teste"):
        return self.client_api.post(
            "/api/master-data/cable-imports/",
            {"title": title, "source_text": text},
            format="json",
        )

    def _items_by_code(self, response):
        return {item["payload"]["code"]: item for item in response.data["items"]}

    def test_create_generates_one_item_per_line_without_writing_to_catalog(self):
        response = self._create_import("TST-100 | Cabo um\nTST-101 | Cabo dois\n")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], CableImport.STATUS_DRAFT)
        self.assertEqual(response.data["total_models"], 2)
        self.assertEqual(len(response.data["items"]), 2)
        self.assertFalse(CableFamily.objects.filter(code__in=["TST-100", "TST-101"]).exists())

    def test_empty_text_is_rejected(self):
        response = self._create_import("   \n  ")
        self.assertEqual(response.status_code, 400)

    def test_existing_family_code_is_a_conflict_and_cannot_be_approved(self):
        CableFamily.objects.create(code="TST-EXIST", name="Já existe")
        response = self._create_import("TST-EXIST | Outro nome")
        item = response.data["items"][0]
        self.assertEqual([c["code"] for c in item["conflicts"]], ["FAMILY_CODE_EXISTS"])

        approve = self.client_api.post(f"/api/master-data/cable-import-items/{item['id']}/approve/")
        self.assertEqual(approve.status_code, 400)
        self.assertIn("conflicts", approve.data)

    def test_duplicate_code_inside_same_import_is_flagged_on_both_lines(self):
        response = self._create_import("TST-DUP1 | Primeiro\nTST-DUP1 | Segundo")
        for item in response.data["items"]:
            self.assertIn("DUPLICATE_IN_IMPORT", [c["code"] for c in item["conflicts"]])

    def test_alias_pointing_to_other_family_is_a_conflict(self):
        family = CableFamily.objects.create(code="TST-OWNER", name="Dona do alias")
        CableAlias.objects.create(cable_family=family, alias="TST ALIAS UNICO")
        response = self._create_import("TST-NEW | Novo cabo | fibra | | | | | | TST ALIAS UNICO")
        codes = [c["code"] for c in response.data["items"][0]["conflicts"]]
        self.assertIn("ALIAS_OTHER_FAMILY", codes)

    def test_part_number_already_in_use_is_a_conflict(self):
        family = CableFamily.objects.create(code="TST-SPEC-OWNER", name="Dona da spec")
        CableSpec.objects.create(cable_family=family, code="TST-SPEC-1", name="Spec", part_number="PN-TST-1", active=True)
        response = self._create_import("TST-NEW2 | Novo | fibra | | | | Acme | pn-tst-1")
        codes = [c["code"] for c in response.data["items"][0]["conflicts"]]
        self.assertIn("PART_NUMBER_EXISTS", codes)

    def test_editing_payload_recomputes_conflicts_and_resets_status(self):
        CableFamily.objects.create(code="TST-TAKEN", name="Ocupado")
        response = self._create_import("TST-TAKEN | Cabo")
        item = response.data["items"][0]

        edit = self.client_api.patch(
            f"/api/master-data/cable-import-items/{item['id']}/",
            {"payload": {"code": "TST-FREE", "name": "Cabo", "medium": "FIBER", "aliases": ["TST FREE ALIAS"]}},
            format="json",
        )
        self.assertEqual(edit.status_code, 200, edit.data)
        self.assertEqual(edit.data["conflicts"], [])
        self.assertEqual(edit.data["payload"]["code"], "TST-FREE")
        self.assertEqual(edit.data["status"], CableImportItem.STATUS_PENDING)

    def test_happy_path_approve_and_finalize_creates_family_alias_and_spec(self):
        response = self._create_import("TST-OK | Cabo OK | fibra | 12 | LC | LC | Acme | PN-OK-1 | TST OK LC/LC")
        item = response.data["items"][0]
        self.assertEqual(item["conflicts"], [])

        approve = self.client_api.post(f"/api/master-data/cable-import-items/{item['id']}/approve/")
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(approve.data["status"], CableImportItem.STATUS_APPROVED)

        finalize = self.client_api.post(f"/api/master-data/cable-imports/{response.data['id']}/finalize/")
        self.assertEqual(finalize.status_code, 200, finalize.data)
        self.assertEqual(finalize.data["status"], CableImport.STATUS_FINALIZED)
        self.assertEqual(finalize.data["total_created"], 1)

        family = CableFamily.objects.get(code="TST-OK")
        self.assertEqual(family.fiber_count, 12)
        self.assertEqual(family.created_by, self.admin)
        self.assertTrue(CableAlias.objects.filter(cable_family=family, normalized_alias="TST OK LC/LC").exists())
        self.assertTrue(CableSpec.objects.filter(cable_family=family, part_number="PN-OK-1", code="PN-OK-1").exists())
        self.assertEqual(finalize.data["items"][0]["created_family"], family.pk)

    def test_finalize_without_approved_items_is_refused(self):
        response = self._create_import("TST-PEND | Pendente")
        finalize = self.client_api.post(f"/api/master-data/cable-imports/{response.data['id']}/finalize/")
        self.assertEqual(finalize.status_code, 400)
        self.assertFalse(CableFamily.objects.filter(code="TST-PEND").exists())

    def test_finalize_is_all_or_nothing_when_an_approved_item_became_conflicting(self):
        response = self._create_import("TST-ALL-1 | Primeiro\nTST-ALL-2 | Segundo")
        first, second = response.data["items"]
        for item in (first, second):
            self.assertEqual(self.client_api.post(f"/api/master-data/cable-import-items/{item['id']}/approve/").status_code, 200)

        # Depois da aprovação, outro cadastro passa a usar o código do segundo item.
        CableFamily.objects.create(code="TST-ALL-2", name="Chegou depois")

        finalize = self.client_api.post(f"/api/master-data/cable-imports/{response.data['id']}/finalize/")
        self.assertEqual(finalize.status_code, 400)
        self.assertEqual([b["code"] for b in finalize.data["blocked"]], ["TST-ALL-2"])
        # O primeiro item, que não tinha conflito, também não foi gravado.
        self.assertFalse(CableFamily.objects.filter(code="TST-ALL-1").exists())
        self.assertEqual(CableImportItem.objects.get(pk=first["id"]).status, CableImportItem.STATUS_APPROVED)

    def test_created_item_cannot_be_edited_or_rejected(self):
        response = self._create_import("TST-LOCK | Trancado")
        item = response.data["items"][0]
        self.client_api.post(f"/api/master-data/cable-import-items/{item['id']}/approve/")
        self.client_api.post(f"/api/master-data/cable-imports/{response.data['id']}/finalize/")

        edit = self.client_api.patch(
            f"/api/master-data/cable-import-items/{item['id']}/",
            {"payload": {"code": "TST-LOCK2", "name": "Mudou"}},
            format="json",
        )
        self.assertEqual(edit.status_code, 400)
        reject = self.client_api.post(f"/api/master-data/cable-import-items/{item['id']}/reject/")
        self.assertEqual(reject.status_code, 400)

    def test_user_without_cable_permissions_is_refused(self):
        outsider = User.objects.create_user(username="cable_outsider", email="outsider@example.com", password="x")
        client = APIClient()
        client.force_authenticate(user=outsider)
        response = client.post("/api/master-data/cable-imports/", {"source_text": "TST-NOPE | Sem permissão"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_user_with_view_only_can_list_but_not_create(self):
        viewer = User.objects.create_user(username="cable_viewer", email="viewer@example.com", password="x")
        viewer.user_permissions.add(Permission.objects.get(codename="view_cablefamily", content_type__app_label="master_data"))
        client = APIClient()
        client.force_authenticate(user=viewer)
        self.assertEqual(client.get("/api/master-data/cable-imports/").status_code, 200)
        self.assertEqual(client.post("/api/master-data/cable-imports/", {"source_text": "TST-V | X"}, format="json").status_code, 403)

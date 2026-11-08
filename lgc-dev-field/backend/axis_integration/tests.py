import hashlib
import hmac
import io
import json
import uuid
from datetime import timedelta
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from core.models import Client, Collaborator, Company, Person, Site
from projects.models import Project
from users.models import User

from . import api_client
from .matching import build_unmatched_report, normalize_name, only_digits
from .models import AxisInboxEvent, AxisMasterRecord

SECRET = "segredo-de-teste"
URL = "/api/v1/webhooks/axis"


def sign(body: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


@override_settings(AXIS_WEBHOOK_SECRET=SECRET, AXIS_API_URL="", AXIS_API_KEY="")
class WebhookBase(TestCase):
    """Os testes rodam no banco `test_<POSTGRES_DB>` que o Django cria e destrói sozinho; nunca no real."""

    def setUp(self):
        patcher = mock.patch("core.geocoding.geocode_site_address", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.company = Company.objects.create(legal_name="LGC Teste Ltda", tax_id="00.000.000/0001-91")

    def envelope(self, event_type, payload, *, event_id=None, occurred_at=None):
        return {
            "event_id": str(event_id or uuid.uuid4()),
            "event_type": event_type,
            "occurred_at": (occurred_at or timezone.now()).isoformat(),
            "payload": payload,
        }

    def post(self, event_type, payload, *, signature=None, **kwargs):
        body = json.dumps(self.envelope(event_type, payload, **kwargs)).encode()
        return self.post_raw(body, signature=signature)

    def post_raw(self, body: bytes, *, signature=None):
        headers = {"HTTP_X_AXIS_SIGNATURE": signature if signature is not None else sign(body)}
        return self.client.post(URL, data=body, content_type="application/json", **headers)

    def make_client(self, **kwargs):
        kwargs.setdefault("legal_name", "Cliente Exemplo Ltda")
        return Client.objects.create(company=self.company, **kwargs)

    def make_collaborator(self, name="Fulano de Tal", email="", **kwargs):
        person = Person.objects.create(name=name, email=email, company=self.company)
        return Collaborator.objects.create(person=person, **kwargs)


class SignatureAndReplayTests(WebhookBase):
    def test_sem_segredo_configurado_responde_503(self):
        with override_settings(AXIS_WEBHOOK_SECRET=""):
            response = self.post("client.created", {"client_id": str(uuid.uuid4())})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(AxisInboxEvent.objects.count(), 0)

    def test_assinatura_errada_e_recusada_e_nada_e_gravado(self):
        payload = {"client_id": str(uuid.uuid4()), "cnpj": "11.222.333/0001-81"}
        for bad in (sign(b"outro corpo"), sign(b"x", secret="outro-segredo"), "sha256=", "abc", ""):
            response = self.post("client.created", payload, signature=bad)
            self.assertEqual(response.status_code, 401, bad)
        self.assertEqual(AxisInboxEvent.objects.count(), 0)
        self.assertEqual(AxisMasterRecord.objects.count(), 0)

    def test_sem_cabecalho_de_assinatura_e_recusado(self):
        body = json.dumps(self.envelope("client.created", {"client_id": str(uuid.uuid4())})).encode()
        response = self.client.post(URL, data=body, content_type="application/json")
        self.assertEqual(response.status_code, 401)

    def test_assinatura_do_corpo_adulterado_e_recusada(self):
        body = json.dumps(self.envelope("client.created", {"client_id": str(uuid.uuid4())})).encode()
        response = self.post_raw(body.replace(b"client.created", b"client.updated"), signature=sign(body))
        self.assertEqual(response.status_code, 401)

    def test_aceita_com_ou_sem_barra_final(self):
        body = json.dumps(self.envelope("ping", {})).encode()
        for url in (URL, URL + "/"):
            response = self.client.post(url, data=body, content_type="application/json", HTTP_X_AXIS_SIGNATURE=sign(body))
            self.assertIn(response.status_code, (200,))

    def test_evento_fora_da_janela_e_replay(self):
        old = timezone.now() - timedelta(hours=73)
        response = self.post("client.created", {"client_id": str(uuid.uuid4())}, occurred_at=old)
        self.assertEqual(response.status_code, 400)
        future = timezone.now() + timedelta(minutes=10)
        response = self.post("client.created", {"client_id": str(uuid.uuid4())}, occurred_at=future)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(AxisInboxEvent.objects.count(), 0)

    def test_corpo_malformado_e_400(self):
        self.assertEqual(self.post_raw(b"nao e json").status_code, 400)
        body = json.dumps({"event_id": "x", "event_type": "client.created", "occurred_at": "x", "payload": {}}).encode()
        self.assertEqual(self.post_raw(body).status_code, 400)
        body = json.dumps(self.envelope("client.created", {"client_id": "nao-e-uuid"})).encode()
        self.assertEqual(self.post_raw(body).status_code, 400)

    def test_get_nao_e_permitido(self):
        self.assertEqual(self.client.get(URL).status_code, 405)


class IdempotencyTests(WebhookBase):
    def test_evento_repetido_e_processado_uma_so_vez(self):
        axis_id = str(uuid.uuid4())
        event_id = uuid.uuid4()
        payload = {"client_id": axis_id, "name": "Cliente Exemplo Ltda", "cnpj": "11.222.333/0001-81"}
        first = self.post("client.created", payload, event_id=event_id)
        self.assertEqual(first.json()["status"], "processed")
        # Mesma entrega repetida (até com conteúdo diferente) não reprocessa.
        second = self.post("client.created", {**payload, "name": "Nome adulterado"}, event_id=event_id)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["status"], "duplicate")
        self.assertEqual(AxisInboxEvent.objects.filter(event_id=event_id).count(), 1)
        self.assertEqual(AxisMasterRecord.objects.get(axis_id=axis_id).name, "Cliente Exemplo Ltda")

    def test_falha_no_processamento_responde_5xx_e_a_reentrega_reprocessa(self):
        axis_id = str(uuid.uuid4())
        event_id = uuid.uuid4()
        payload = {"client_id": axis_id, "name": "Cliente Exemplo"}
        with mock.patch("axis_integration.webhook.handlers.apply_event", side_effect=RuntimeError("banco fora")):
            response = self.post("client.created", payload, event_id=event_id)
        self.assertEqual(response.status_code, 500)
        inbox = AxisInboxEvent.objects.get(event_id=event_id)
        self.assertEqual(inbox.status, AxisInboxEvent.STATUS_FAILED)
        self.assertFalse(AxisMasterRecord.objects.exists())  # a transação foi desfeita junto

        response = self.post("client.created", payload, event_id=event_id)
        self.assertEqual(response.json()["status"], "processed")
        inbox.refresh_from_db()
        self.assertEqual(inbox.status, AxisInboxEvent.STATUS_PROCESSED)
        self.assertEqual(inbox.attempts, 2)
        self.assertEqual(AxisMasterRecord.objects.count(), 1)

    def test_tipo_de_evento_desconhecido_e_ignorado_com_200(self):
        response = self.post("purchase.approved", {"request_id": str(uuid.uuid4())})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ignored")
        self.assertEqual(AxisInboxEvent.objects.get().status, AxisInboxEvent.STATUS_IGNORED)

    def test_evento_mais_antigo_nao_sobrescreve_o_cache(self):
        axis_id = str(uuid.uuid4())
        now = timezone.now()
        self.post("client.updated", {"client_id": axis_id, "name": "Nome novo"}, occurred_at=now)
        response = self.post(
            "client.updated", {"client_id": axis_id, "name": "Nome velho"}, occurred_at=now - timedelta(minutes=5)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(AxisMasterRecord.objects.get(axis_id=axis_id).name, "Nome novo")
        self.assertEqual(AxisInboxEvent.objects.filter(note="out_of_order").count(), 1)


class ClientMatchingTests(WebhookBase):
    def test_casa_cliente_por_cnpj_ignorando_pontuacao_e_nome(self):
        field_client = self.make_client(legal_name="Razão Social Antiga", tax_id="12.345.678/0001-90")
        axis_id = str(uuid.uuid4())
        response = self.post(
            "client.created", {"client_id": axis_id, "code": 7, "name": "Outro Nome Ltda", "cnpj": "12345678000190"}
        )
        self.assertEqual(response.status_code, 200)
        field_client.refresh_from_db()
        self.assertEqual(str(field_client.axis_client_id), axis_id)
        self.assertEqual(field_client.legal_name, "Outro Nome Ltda")  # MI-02: o Core manda nos campos dele
        self.assertEqual(Client.objects.count(), 1)  # casou, não criou

    def test_evento_magro_do_core_e_completado_pela_api_de_consulta(self):
        field_client = self.make_client(tax_id="12.345.678/0001-90")
        axis_id = str(uuid.uuid4())
        row = {"id": axis_id, "code": 7, "legalName": "Cliente Exemplo Ltda", "cnpj": "12345678000190",
               "contacts": [{"name": "Fulana", "phone": "1199999"}], "address": {"city": "Sumaré"}}
        fake = mock.Mock()
        fake.get_one.return_value = row
        with override_settings(AXIS_API_URL="http://core.test/api/v1", AXIS_API_KEY="k"), mock.patch(
            "axis_integration.webhook.api_client.AxisApiClient", return_value=fake
        ):
            self.post("client.created", {"client_id": axis_id, "code": 7})
        fake.get_one.assert_called_once_with("clients", axis_id)
        field_client.refresh_from_db()
        self.assertEqual(str(field_client.axis_client_id), axis_id)
        record = AxisMasterRecord.objects.get(axis_id=axis_id)
        self.assertNotIn("contacts", record.data)  # contatos pessoais do cliente não ficam no cache
        self.assertNotIn("address", record.data)

    def test_falha_na_consulta_ao_core_nao_derruba_o_evento(self):
        axis_id = str(uuid.uuid4())
        fake = mock.Mock()
        fake.get_one.side_effect = api_client.AxisApiError("fora do ar")
        with override_settings(AXIS_API_URL="http://core.test/api/v1", AXIS_API_KEY="k"), mock.patch(
            "axis_integration.webhook.api_client.AxisApiClient", return_value=fake
        ):
            response = self.post("client.created", {"client_id": axis_id, "code": 7})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(AxisMasterRecord.objects.filter(axis_id=axis_id).exists())

    def test_sem_cnpj_casa_por_nome_normalizado(self):
        field_client = self.make_client(legal_name="Açaí & Filhos S.A.", tax_id="")
        self.assertNotEqual(normalize_name("ACAI e FILHOS LTDA"), normalize_name(field_client.legal_name))  # "&" ≠ "e"
        axis_id = str(uuid.uuid4())
        self.post("client.updated", {"client_id": axis_id, "name": "acai filhos"})
        field_client.refresh_from_db()
        self.assertEqual(str(field_client.axis_client_id), axis_id)
        self.assertEqual(Client.objects.count(), 1)

    def test_nome_ambiguo_fica_sem_vinculo_e_aparece_no_relatorio(self):
        self.make_client(legal_name="Cliente Repetido Ltda", tax_id="")
        self.make_client(legal_name="Cliente Repetido S.A.", tax_id="")
        axis_id = str(uuid.uuid4())
        self.post("client.created", {"client_id": axis_id, "name": "Cliente Repetido"})
        self.assertFalse(Client.objects.filter(axis_client_id__isnull=False).exists())
        report = build_unmatched_report()
        self.assertEqual([r["axis_id"] for r in report["core_without_field"]["client"]], [axis_id])
        self.assertEqual(len(report["field_without_core"]["client"]), 2)

    def test_cliente_sem_par_e_criado_na_empresa_padrao_sem_mexer_nos_outros(self):
        existing = self.make_client(tax_id="99.999.999/0001-99")
        axis_id = str(uuid.uuid4())
        self.post("client.created", {"client_id": axis_id, "name": "Cliente Novo", "cnpj": "11222333000181"})
        self.assertEqual(Client.objects.count(), 2)
        created = Client.objects.get(axis_client_id=axis_id)
        self.assertEqual((created.legal_name, created.tax_id, created.company), ("Cliente Novo", "11.222.333/0001-81", self.company))
        existing.refresh_from_db()
        self.assertIsNone(existing.axis_client_id)

    def test_cliente_ja_vinculado_a_outro_id_do_core_nao_e_reaproveitado(self):
        field_client = self.make_client(tax_id="12.345.678/0001-90")
        first, second = str(uuid.uuid4()), str(uuid.uuid4())
        self.post("client.created", {"client_id": first, "cnpj": "12345678000190", "name": "A"})
        self.post("client.created", {"client_id": second, "cnpj": "12345678000190", "name": "A"})
        field_client.refresh_from_db()
        self.assertEqual(str(field_client.axis_client_id), first)

    def test_normalizacao(self):
        self.assertEqual(only_digits("12.345.678/0001-90"), "12345678000190")
        self.assertEqual(normalize_name("  Açaí  Ltda. "), "acai")
        self.assertEqual(normalize_name("Empresa do Brasil S.A."), "empresa")


class CollaboratorTests(WebhookBase):
    def test_casa_por_email_e_acompanha_o_centro_de_custo(self):
        collaborator = self.make_collaborator(email="Fulano@LGC.com.br", registration="123")
        axis_id = str(uuid.uuid4())
        cc_a, cc_b = str(uuid.uuid4()), str(uuid.uuid4())
        row = {"id": axis_id, "fullName": "Fulano de Tal", "corporateEmail": "fulano@lgc.com.br", "status": "ativo"}
        fake = mock.Mock()
        fake.get_one.return_value = row
        with override_settings(AXIS_API_URL="http://core.test/api/v1", AXIS_API_KEY="k"), mock.patch(
            "axis_integration.webhook.api_client.AxisApiClient", return_value=fake
        ):
            self.post("collaborator.created", {"collaborator_id": axis_id, "name": "Fulano de Tal", "status": "ativo",
                                               "cost_center_id": cc_a})
        collaborator.refresh_from_db()
        self.assertEqual(str(collaborator.axis_collaborator_id), axis_id)
        self.assertEqual(str(collaborator.axis_cost_center_id), cc_a)

        later = timezone.now() + timedelta(seconds=30)
        self.post("collaborator.cost_center_changed",
                  {"collaborator_id": axis_id, "previous_cost_center_id": cc_a, "cost_center_id": cc_b,
                   "valid_from": "2026-11-08"}, occurred_at=later - timedelta(seconds=25))
        collaborator.refresh_from_db()
        self.assertEqual(str(collaborator.axis_cost_center_id), cc_b)

    def test_casa_por_matricula_quando_nao_ha_email(self):
        collaborator = self.make_collaborator(registration="MAT-77")
        axis_id = str(uuid.uuid4())
        self.post("collaborator.updated", {"collaborator_id": axis_id, "name": "X", "registration": "MAT-77"})
        collaborator.refresh_from_db()
        self.assertEqual(str(collaborator.axis_collaborator_id), axis_id)

    def test_desligamento_inativa_o_colaborador_do_field(self):
        collaborator = self.make_collaborator(email="a@lgc.com.br")
        axis_id = str(uuid.uuid4())
        self.post("collaborator.created", {"collaborator_id": axis_id, "name": "A", "email": "a@lgc.com.br",
                                           "status": "ativo"})
        self.post("collaborator.offboarded", {"collaborator_id": axis_id, "offboarded_at": "2026-11-08T10:00:00Z"},
                  occurred_at=timezone.now() + timedelta(seconds=1))
        self.assertFalse(AxisMasterRecord.objects.get(axis_id=axis_id).active)
        collaborator.refresh_from_db()
        self.assertFalse(collaborator.is_active)  # MI-02: desligado no Core = inativo no Field
        self.assertEqual(collaborator.axis_status, "desligado")
        self.assertEqual(str(collaborator.axis_collaborator_id), axis_id)

    def test_centro_de_custo_que_chega_antes_do_vinculo_e_aplicado_ao_casar(self):
        axis_id, cc = str(uuid.uuid4()), str(uuid.uuid4())
        self.post("collaborator.cost_center_changed", {"collaborator_id": axis_id, "cost_center_id": cc,
                                                       "valid_from": "2026-11-08"})
        collaborator = self.make_collaborator(email="b@lgc.com.br")
        self.post("collaborator.updated", {"collaborator_id": axis_id, "name": "B", "email": "b@lgc.com.br"},
                  occurred_at=timezone.now() + timedelta(seconds=1))
        collaborator.refresh_from_db()
        self.assertEqual(str(collaborator.axis_cost_center_id), cc)


class SiteTests(WebhookBase):
    def site_payload(self, client_axis_id, **extra):
        return {"site_id": str(uuid.uuid4()), "client_id": client_axis_id, "code": "GRU53", "name": "GRU53 Hortolândia",
                "address": "Rua A, 1", "latitude": -22.9, "longitude": -47.2, "active": True, **extra}

    def test_site_casa_por_cliente_e_codigo(self):
        client = self.make_client(tax_id="12.345.678/0001-90")
        client_axis = str(uuid.uuid4())
        self.post("client.created", {"client_id": client_axis, "cnpj": "12345678000190", "name": "X"})
        site = Site.objects.create(client=client, code="gru53", name="GRU 53")
        other = Site.objects.create(client=client, code="GRU99", name="Outro")
        payload = self.site_payload(client_axis)
        self.post("site.created", payload)
        site.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual(str(site.axis_site_id), payload["site_id"])
        self.assertIsNone(other.axis_site_id)
        self.assertEqual(site.name, "GRU53 Hortolândia")  # MI-02: nome e endereço vêm do Core
        self.assertEqual(site.code, "GRU53")
        self.assertTrue(site.manual_coordinates)  # coordenada do Core: a geocodificação não sobrescreve
        self.assertEqual(Site.objects.count(), 2)

    def test_site_sem_cliente_fica_sem_vinculo_e_casa_quando_o_cliente_chegar(self):
        client = self.make_client(tax_id="12.345.678/0001-90")
        site = Site.objects.create(client=client, code="GRU53", name="GRU 53")
        client_axis = str(uuid.uuid4())
        payload = self.site_payload(client_axis)

        response = self.post("site.created", payload)
        self.assertEqual(response.status_code, 200)
        site.refresh_from_db()
        self.assertIsNone(site.axis_site_id)
        report = build_unmatched_report()
        rows = report["core_without_field"]["site"]
        self.assertEqual([r["axis_id"] for r in rows], [payload["site_id"]])
        self.assertEqual(rows[0]["motivo"], "cliente do site sem par no Field")
        self.assertEqual(Site.objects.count(), 1)  # nada foi criado

        self.post("client.created", {"client_id": client_axis, "cnpj": "12345678000190", "name": "X"})
        site.refresh_from_db()
        self.assertEqual(str(site.axis_site_id), payload["site_id"])
        self.assertEqual(build_unmatched_report()["core_without_field"]["site"], [])

    def test_site_do_mesmo_codigo_em_outro_cliente_nao_casa(self):
        mine = self.make_client(legal_name="Meu", tax_id="12.345.678/0001-90")
        other = self.make_client(legal_name="Outro", tax_id="98.765.432/0001-10")
        wrong = Site.objects.create(client=other, code="GRU53", name="de outro cliente")
        client_axis = str(uuid.uuid4())
        self.post("client.created", {"client_id": client_axis, "cnpj": "12345678000190", "name": "Meu"})
        self.post("site.created", self.site_payload(client_axis))
        wrong.refresh_from_db()
        self.assertIsNone(wrong.axis_site_id)
        self.assertEqual(wrong.name, "de outro cliente")
        self.assertEqual(mine.sites.count(), 1)  # MI-01: o site do Core é criado no cliente certo


class ProjectAndCostCenterTests(WebhookBase):
    def project_payload(self, axis_id, **extra):
        return {"project_id": axis_id, "code": "PROP-1.001-1126", "name": "Proposta X", "status": "proposta",
                "client_id": str(uuid.uuid4()), "site_id": str(uuid.uuid4()), "cost_center_id": str(uuid.uuid4()),
                "responsible_collaborator_id": None, "planned_start_date": None, "planned_end_date": None, **extra}

    def test_project_nao_cria_obra_so_guarda_cache(self):
        axis_id = str(uuid.uuid4())
        for event in ("project.created", "project.updated", "project.status_changed"):
            self.assertEqual(self.post(event, self.project_payload(axis_id)).status_code, 200)
        self.assertEqual(Project.objects.count(), 0)
        record = AxisMasterRecord.objects.get(kind="project", axis_id=axis_id)
        self.assertEqual(record.code, "PROP-1.001-1126")
        self.assertTrue(record.active)

    def test_obra_ja_vinculada_recebe_o_centro_de_custo_sem_perder_dados(self):
        axis_id = str(uuid.uuid4())
        project = Project.objects.create(company=self.company, name="Obra do Field", axis_project_id=axis_id)
        payload = self.project_payload(axis_id)
        self.post("project.updated", payload)
        project.refresh_from_db()
        self.assertEqual(str(project.axis_cost_center_id), payload["cost_center_id"])
        self.assertEqual(project.name, "Obra do Field")
        self.assertEqual(project.status, Project.STATUS_PLANNING)

    def test_project_encerrado_ou_excluido_fica_inativo_no_cache(self):
        axis_id = str(uuid.uuid4())
        now = timezone.now()
        self.post("project.created", self.project_payload(axis_id), occurred_at=now)
        self.post("project.deleted", self.project_payload(axis_id, status="encerrado", deleted=True),
                  occurred_at=now + timedelta(seconds=1))
        self.assertFalse(AxisMasterRecord.objects.get(axis_id=axis_id).active)

    def test_centro_de_custo_vai_para_o_cache(self):
        axis_id = str(uuid.uuid4())
        self.post("cost_center.created", {"cost_center_id": axis_id, "code": "CC-001", "name": "Equipe JAI",
                                          "short_code": "DC-001-JAI", "kind": "equipe_tecnica", "active": True})
        self.post("cost_center.updated", {"cost_center_id": axis_id, "code": "CC-001", "name": "Equipe JAI",
                                          "active": False}, occurred_at=timezone.now() + timedelta(seconds=1))
        record = AxisMasterRecord.objects.get(kind="cost_center", axis_id=axis_id)
        self.assertEqual((record.code, record.name, record.active), ("CC-001", "Equipe JAI", False))
        self.assertEqual(record.data["short_code"], "DC-001-JAI")  # evento parcial não perde o que já se sabia


class AxisSyncCommandTests(WebhookBase):
    class FakeClient:
        def __init__(self, data, missing=()):
            self.data, self.missing = data, set(missing)

        def iter_all(self, resource, per_page=200):
            if resource in self.missing:
                raise api_client.AxisApiNotFound(resource)
            yield from self.data.get(resource, [])

    def run_command(self, fake, *args):
        out = io.StringIO()
        with override_settings(AXIS_API_URL="http://core.test/api/v1", AXIS_API_KEY="k"), mock.patch(
            "axis_integration.management.commands.axis_sync.AxisApiClient", return_value=fake
        ):
            call_command("axis_sync", *args, stdout=out)
        return out.getvalue()

    def test_carga_inicial_casa_e_reporta_os_sem_par(self):
        paired = self.make_client(legal_name="Cliente Par", tax_id="12.345.678/0001-90")
        self.make_client(legal_name="Só no Field", tax_id="55.555.555/0001-55")
        Site.objects.create(client=paired, code="GRU53", name="GRU 53")
        collaborator = self.make_collaborator(name="Com Par", email="par@lgc.com.br")
        self.make_collaborator(name="Só no Field Colab", email="so@lgc.com.br")
        user = User.objects.create_user(username="par", email="par@lgc.com.br", password="x")
        c_id, k_id, u_id, s_id, orphan_site = (str(uuid.uuid4()) for _ in range(5))
        fake = self.FakeClient({
            "clients": [
                {"id": c_id, "code": 1, "legalName": "Cliente Par", "cnpj": "12345678000190", "contacts": []},
                {"id": str(uuid.uuid4()), "code": 2, "legalName": "Só no Core", "cnpj": "00111222000133"},
            ],
            "collaborators": [{"id": k_id, "fullName": "Com Par", "corporateEmail": "PAR@lgc.com.br", "status": "ativo"}],
            "users": [{"id": u_id, "email": "par@lgc.com.br", "status": "active"}],
            "sites": [
                {"id": s_id, "clientId": c_id, "code": "GRU53", "name": "GRU 53", "active": True},
                {"id": orphan_site, "clientId": str(uuid.uuid4()), "code": "XXX1", "name": "Sem cliente", "active": True},
            ],
        })
        output = self.run_command(fake, "--resources", "clients", "collaborators", "users", "sites")

        self.assertEqual(str(Client.objects.get(legal_name="Cliente Par").axis_client_id), c_id)
        collaborator.refresh_from_db()
        self.assertEqual(str(collaborator.axis_collaborator_id), k_id)
        user.refresh_from_db()
        self.assertEqual(str(user.axis_user_id), u_id)
        self.assertEqual(str(Site.objects.get(code="GRU53").axis_site_id), s_id)
        self.assertIn("Só no Field", output)
        self.assertIn("Sem cliente", output)
        self.assertIn("cliente do site sem par no Field", output)
        # MI-01: o cliente que só existia no Core foi criado; nada foi apagado
        self.assertEqual(Client.objects.count(), 3)
        self.assertTrue(Client.objects.filter(legal_name="Só no Core", axis_client_id__isnull=False).exists())

    def test_recurso_indisponivel_no_core_nao_interrompe_os_demais(self):
        fake = self.FakeClient({"clients": [{"id": str(uuid.uuid4()), "legalName": "A", "cnpj": "1"}]}, missing={"sites"})
        output = self.run_command(fake, "--resources", "sites", "clients")
        self.assertIn("sites: indisponível no Core", output)
        self.assertEqual(AxisMasterRecord.objects.filter(kind="client").count(), 1)

    def test_erro_do_core_termina_com_codigo_de_erro_depois_de_processar_o_resto(self):
        class Broken(self.FakeClient):
            def iter_all(self, resource, per_page=200):
                if resource == "projects":
                    raise api_client.AxisApiError("O Core recusou a API key")
                yield from self.data.get(resource, [])

        fake = Broken({"clients": [{"id": str(uuid.uuid4()), "legalName": "A"}]})
        with self.assertRaises(CommandError):
            self.run_command(fake, "--resources", "projects", "clients")
        self.assertEqual(AxisMasterRecord.objects.filter(kind="client").count(), 1)

    def test_sem_configuracao_orienta_o_operador(self):
        with override_settings(AXIS_API_URL="", AXIS_API_KEY=""), self.assertRaisesMessage(CommandError, "AXIS_API_URL"):
            call_command("axis_sync", stdout=io.StringIO())

    def test_report_only_nao_consulta_o_core(self):
        self.make_client(legal_name="Só no Field", tax_id="")
        out = io.StringIO()
        with override_settings(AXIS_API_URL="", AXIS_API_KEY=""):
            call_command("axis_sync", "--report-only", stdout=out)
        self.assertIn("Só no Field", out.getvalue())

    def test_relatorio_em_json(self):
        out = io.StringIO()
        call_command("axis_sync", "--report-only", "--json", stdout=out)
        self.assertEqual(set(json.loads(out.getvalue())), {"core_without_field", "field_without_core"})

    def test_evento_posterior_a_consulta_prevalece_sobre_o_snapshot(self):
        axis_id = str(uuid.uuid4())
        self.post("client.updated", {"client_id": axis_id, "name": "Nome do evento"},
                  occurred_at=timezone.now() + timedelta(minutes=1))
        fake = self.FakeClient({"clients": [{"id": axis_id, "legalName": "Nome da consulta", "name": "Nome da consulta"}]})
        self.run_command(fake, "--resources", "clients")
        self.assertEqual(AxisMasterRecord.objects.get(axis_id=axis_id).name, "Nome do evento")


class MigrationTests(TestCase):
    def test_modelos_e_migracoes_estao_em_dia(self):
        call_command("makemigrations", "--check", "--dry-run", stdout=io.StringIO())

    def test_rota_do_webhook(self):
        self.assertEqual(reverse("axis-webhook"), "/api/v1/webhooks/axis")

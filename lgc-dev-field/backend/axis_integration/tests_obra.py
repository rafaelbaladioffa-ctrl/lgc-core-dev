"""PT-08: obra a partir de `project.approved`, plano automático da SOW e eventos ao Core.

Os testes rodam no banco `test_<POSTGRES_DB>` e nunca falam com a rede: a API do Core e o POST do outbox são
simulados."""

import hashlib
import hmac
import io
import json
import uuid
from datetime import date, timedelta
from unittest import mock

import requests
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Client, Collaborator, Company, Notification, Person, Responsible, Site, Task
from master_data.models import ScopeItem, SowImport
from projects.models import Project, ProjectTask, ProjectTaskAssignment
from users.models import User

from . import api_client, field_events, outbox, sow_plan
from .models import AxisInboxEvent, AxisOutboxEvent
from .tests import SECRET, URL, WebhookBase, sign

OUTBOUND_SECRET = "segredo-de-saida"
CLEAN_SOW = "1x 2F LC-LC (55m) from A to B (Path A)"


def core_settings(**extra):
    return override_settings(
        AXIS_API_URL="http://core.test/api/v1",
        AXIS_API_KEY="chave-de-teste",
        AXIS_OUTBOUND_SECRET=OUTBOUND_SECRET,
        AXIS_OUTBOUND_IMMEDIATE=False,
        AXIS_BACKGROUND_TASKS=False,
        **extra,
    )


class ObraBase(WebhookBase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser(username="adm", email="adm@example.com", password="x")
        self.client_id, self.site_id, self.collab_id, self.project_id = (str(uuid.uuid4()) for _ in range(4))
        self.doc_id = str(uuid.uuid4())

    def make_world(self, *, client=True, site=True, responsible=True):
        """Cadastros do Field já casados com o Axis (ids deste teste)."""
        world = {}
        if client:
            world["client"] = self.make_client(axis_client_id=self.client_id)
        if site and client:
            world["site"] = Site.objects.create(client=world["client"], code="GRU53", name="GRU53", axis_site_id=self.site_id)
        if responsible:
            person = Person.objects.create(name="Marcia Resp", email="marcia@example.com", company=self.company)
            world["collaborator"] = Collaborator.objects.create(person=person, axis_collaborator_id=self.collab_id)
            world["responsible"] = Responsible.objects.create(person=person, kind=Responsible.KIND_CSTR)
            world["user"] = User.objects.create_user(username="marcia", email="marcia@example.com", password="x")
            person.user = world["user"]
            person.save()
        return world

    def approved_payload(self, **overrides):
        payload = {
            "project_id": self.project_id,
            "code": "PROP-ACME.001-1126",
            "name": "Backbone GRU53",
            "status": "aprovado",
            "client_id": self.client_id,
            "cost_center_id": str(uuid.uuid4()),
            "site_id": self.site_id,
            "responsible_collaborator_id": self.collab_id,
            "planned_start_date": "2026-12-01",
            "planned_end_date": "2026-12-20",
            "site": {"site_id": self.site_id, "code": "GRU53", "name": "GRU53"},
            "accepted_quote": {
                "project_quote_id": str(uuid.uuid4()),
                "external_revision_id": "rev-1",
                "revision_number": 1,
                "work_days": "20.00",
                "planned_start_date": "2026-12-02",
                "planned_end_date": "2026-12-22",
                "team": [
                    {"role_key": "tecnico", "role_name": "Técnico", "field_role": True, "people": 5, "days": 20, "hours": 800},
                    {"role_key": "supervisor", "role_name": "Supervisor", "field_role": False, "people": 1, "days": 20, "hours": 160},
                ],
                "sow_document_id": self.doc_id,
            },
            "client_po_number": "PO-123",
            "material_request_id": None,
            "approved_by_user_id": str(uuid.uuid4()),
            "approved_at": timezone.now().isoformat(),
        }
        payload.update(overrides)
        return payload

    def make_project(self, **kwargs):
        world = self.make_world()
        defaults = dict(
            company=self.company, name="Obra", client=world["client"], site=world["site"],
            axis_project_id=self.project_id, planned_team=[{"field_role": True, "hours": 100}, {"field_role": False, "hours": 50}],
        )
        defaults.update(kwargs)
        return Project.objects.create(**defaults)


class ProjectApprovedWebhookTests(ObraBase):
    @core_settings()
    def test_cria_a_obra_com_cadastros_datas_po_e_equipe_prevista(self):
        world = self.make_world()
        with self.captureOnCommitCallbacks(execute=False):
            response = self.post("project.approved", self.approved_payload())
        self.assertEqual(response.status_code, 200, response.content)
        project = Project.objects.get(axis_project_id=self.project_id)
        self.assertEqual(project.status, Project.STATUS_PLANNING)
        self.assertEqual(project.client, world["client"])
        self.assertEqual(project.site, world["site"])
        self.assertEqual(project.responsible_cstr, world["responsible"])
        self.assertEqual((project.planned_start, project.planned_end), (date(2026, 12, 2), date(2026, 12, 22)))
        self.assertEqual(project.po, "PO-123")
        self.assertEqual([line["role_key"] for line in project.planned_team], ["tecnico", "supervisor"])
        self.assertEqual(project.planned_team[0]["people"], 5)
        self.assertEqual(project.axis_pending_issues, [])
        self.assertEqual(project.sow_plan_status, Project.SOW_PLAN_PENDING)
        self.assertEqual(str(project.axis_sow_document_id), self.doc_id)
        self.assertTrue(project.code)
        # ainda sem evento `created`: ele sai quando o plano da SOW termina
        self.assertFalse(AxisOutboxEvent.objects.filter(event_type=field_events.CREATED).exists())

    @core_settings()
    def test_evento_repetido_nao_duplica_a_obra(self):
        self.make_world()
        event_id = uuid.uuid4()
        first = self.post("project.approved", self.approved_payload(), event_id=event_id)
        again = self.post("project.approved", self.approved_payload(), event_id=event_id)
        other_event = self.post("project.approved", self.approved_payload())  # reaprovação: outro event_id
        self.assertEqual(first.json()["status"], "processed")
        self.assertEqual(again.json()["status"], "duplicate")
        self.assertEqual(other_event.status_code, 200)
        self.assertEqual(Project.objects.filter(axis_project_id=self.project_id).count(), 1)
        self.assertEqual(AxisInboxEvent.objects.filter(event_type="project.approved").count(), 2)

    @core_settings()
    def test_sem_par_cria_a_obra_com_pendencia_e_avisa_o_admin(self):
        with self.captureOnCommitCallbacks(execute=False):
            response = self.post("project.approved", self.approved_payload())
        self.assertEqual(response.status_code, 200)
        project = Project.objects.get(axis_project_id=self.project_id)
        self.assertIsNone(project.client)
        self.assertIsNone(project.site)
        self.assertIsNone(project.responsible_cstr)
        joined = " ".join(project.axis_pending_issues)
        self.assertIn("Cliente", joined)
        self.assertIn("Site GRU53", joined)
        self.assertIn("Responsável", joined)
        notification = Notification.objects.get(user=self.admin)
        self.assertEqual(notification.title, "Obra criada com pendências")
        self.assertEqual(notification.project_id, project.pk)
        # o evento foi processado (não se perde) e a obra aparece na API com a pendência
        self.assertEqual(AxisInboxEvent.objects.get(event_type="project.approved").status, AxisInboxEvent.STATUS_PROCESSED)
        api = APIClient()
        api.force_authenticate(user=self.admin)
        data = api.get(f"/api/projects/{project.pk}/").json()
        self.assertEqual(data["axis_project_id"], self.project_id)
        self.assertEqual(data["axis_pending_issues"], project.axis_pending_issues)
        self.assertEqual(data["sow_plan_status"], "pending")
        self.assertEqual(data["planned_team"][0]["role_key"], "tecnico")
        # a tela só lê: a API não aceita alterar esses campos
        api.patch(f"/api/projects/{project.pk}/", {"sow_plan_status": "generated", "axis_pending_issues": []}, format="json")
        project.refresh_from_db()
        self.assertEqual(project.sow_plan_status, "pending")
        self.assertTrue(project.axis_pending_issues)

    @core_settings()
    def test_site_de_outro_cliente_vira_pendencia(self):
        world = self.make_world()
        other = self.make_client(legal_name="Outro Cliente SA")
        Site.objects.filter(pk=world["site"].pk).update(client=other)
        self.post("project.approved", self.approved_payload())
        project = Project.objects.get(axis_project_id=self.project_id)
        self.assertIsNone(project.site)
        self.assertIn("outro cliente", " ".join(project.axis_pending_issues))

    @core_settings()
    def test_sem_sow_emite_created_na_hora_com_no_sow(self):
        self.make_world()
        payload = self.approved_payload()
        payload["accepted_quote"]["sow_document_id"] = None
        self.post("project.approved", payload)
        project = Project.objects.get(axis_project_id=self.project_id)
        self.assertEqual(project.sow_plan_status, Project.SOW_PLAN_NO_SOW)
        event = AxisOutboxEvent.objects.get(event_type=field_events.CREATED)
        self.assertEqual(event.payload["sow_plan_status"], "no_sow")
        self.assertEqual(event.payload["tasks_count"], 0)
        self.assertEqual(event.payload["axis_project_id"], self.project_id)
        self.assertEqual(event.payload["field_project_id"], project.pk)

    @core_settings()
    def test_depois_do_commit_o_plano_da_sow_roda(self):
        self.make_world()
        with mock.patch.object(api_client, "download_project_document", return_value=(CLEAN_SOW.encode(), "sow.txt", "text/plain")):
            with self.captureOnCommitCallbacks(execute=True):
                self.post("project.approved", self.approved_payload())
        project = Project.objects.get(axis_project_id=self.project_id)
        self.assertEqual(project.sow_plan_status, Project.SOW_PLAN_GENERATED, project.sow_plan_note)

    @core_settings()
    def test_falha_ao_aplicar_nao_grava_obra_e_o_evento_fica_failed(self):
        self.make_world()
        with mock.patch("axis_integration.obra._pick_company", return_value=None):
            response = self.post("project.approved", self.approved_payload())
        self.assertEqual(response.status_code, 500)
        self.assertFalse(Project.objects.filter(axis_project_id=self.project_id).exists())
        self.assertEqual(AxisInboxEvent.objects.get(event_type="project.approved").status, AxisInboxEvent.STATUS_FAILED)


@core_settings()
class SowPlanTests(ObraBase):
    def setUp(self):
        super().setUp()
        self.world = self.make_world()
        self.project = Project.objects.create(
            company=self.company, name="Obra Axis", client=self.world["client"], site=self.world["site"],
            responsible_cstr=self.world["responsible"], axis_project_id=self.project_id,
            axis_sow_document_id=self.doc_id, sow_plan_status=Project.SOW_PLAN_PENDING,
            planned_team=[{"field_role": True, "hours": 800}],
        )
        Notification.objects.all().delete()

    def download(self, text=CLEAN_SOW, name="sow.txt"):
        return mock.patch.object(api_client, "download_project_document", return_value=(text.encode(), name, "text/plain"))

    def test_sow_sem_aviso_gera_e_envia_as_tarefas_sozinha(self):
        with self.download(), mock.patch.dict("os.environ", {"AI_API_KEY": "chave-que-nao-deve-ser-usada"}), mock.patch(
            "master_data.services.sow_parser.service.get_ai_sow_parser", side_effect=AssertionError("a IA não pode rodar")
        ):
            status = sow_plan.run(self.project.pk)
        self.assertEqual(status, Project.SOW_PLAN_GENERATED)
        self.project.refresh_from_db()
        self.assertEqual(self.project.sow_plan_status, Project.SOW_PLAN_GENERATED)
        tasks = ProjectTask.objects.filter(project=self.project)
        self.assertGreater(tasks.count(), 0)
        self.assertIsNotNone(self.project.sow_import)
        self.assertEqual(self.project.sow_import.status, "APPROVED")
        self.assertEqual(self.project.sow_import.ai_mode, "DETERMINISTIC_ONLY")
        self.assertEqual(ScopeItem.objects.filter(source_reference=self.project.sow_import.code).count(), 1)
        created = AxisOutboxEvent.objects.get(event_type=field_events.CREATED)
        self.assertEqual(created.payload["sow_plan_status"], "generated")
        self.assertEqual(created.payload["tasks_count"], tasks.count())
        progress = AxisOutboxEvent.objects.get(event_type=field_events.PROGRESS)
        self.assertEqual(progress.payload["tasks_total"], tasks.count())
        self.assertEqual(progress.payload["tasks_done"], 0)
        self.assertEqual(progress.payload["percent_complete"], 0)
        self.assertEqual(progress.payload["planned_man_hours"], 800.0)
        self.assertFalse(Notification.objects.filter(title__startswith="Plano da SOW").exists())

    def test_rodar_de_novo_e_idempotente(self):
        with self.download() as mocked:
            sow_plan.run(self.project.pk)
            total = ProjectTask.objects.filter(project=self.project).count()
            self.assertIsNone(sow_plan.run(self.project.pk))
            self.assertEqual(mocked.call_count, 1)
        self.assertEqual(ProjectTask.objects.filter(project=self.project).count(), total)
        self.assertEqual(SowImport.objects.count(), 1)
        self.assertEqual(AxisOutboxEvent.objects.filter(event_type=field_events.CREATED).count(), 1)

    def test_item_com_aviso_para_na_revisao_e_notifica_o_responsavel(self):
        with self.download(text="1x cabo misterioso XYZ-999 from A to B"):
            status = sow_plan.run(self.project.pk)
        self.assertEqual(status, Project.SOW_PLAN_PENDING_REVIEW)
        self.project.refresh_from_db()
        self.assertEqual(self.project.sow_plan_status, Project.SOW_PLAN_PENDING_REVIEW)
        self.assertIn("Revisar Itens", self.project.sow_plan_note)
        self.assertEqual(ProjectTask.objects.filter(project=self.project).count(), 0)
        self.assertEqual(ScopeItem.objects.filter(source_reference=self.project.sow_import.code).count(), 0)
        self.assertEqual(self.project.sow_import.status, "READY_FOR_REVIEW")
        notification = Notification.objects.get(user=self.world["user"], title="Plano da SOW pendente de revisão")
        self.assertEqual(notification.project_id, self.project.pk)
        created = AxisOutboxEvent.objects.get(event_type=field_events.CREATED)
        self.assertEqual(created.payload["sow_plan_status"], "pending_review")
        self.assertEqual(created.payload["tasks_count"], 0)
        self.assertFalse(AxisOutboxEvent.objects.filter(event_type=field_events.PROGRESS).exists())

    def test_sem_responsavel_a_notificacao_vai_para_os_administradores(self):
        Project.objects.filter(pk=self.project.pk).update(responsible_cstr=None)
        with self.download(text="1x cabo misterioso XYZ-999 from A to B"):
            sow_plan.run(self.project.pk)
        self.assertTrue(Notification.objects.filter(user=self.admin, title="Plano da SOW pendente de revisão").exists())

    def test_download_falho_marca_failed_com_motivo_e_a_obra_continua(self):
        with mock.patch.object(api_client, "download_project_document", side_effect=api_client.AxisApiNotFound("A SOW não foi encontrada no Core.")):
            status = sow_plan.run(self.project.pk)
        self.assertEqual(status, Project.SOW_PLAN_FAILED)
        self.project.refresh_from_db()
        self.assertEqual(self.project.sow_plan_status, Project.SOW_PLAN_FAILED)
        self.assertIn("não foi encontrada", self.project.sow_plan_note)
        self.assertTrue(Project.objects.filter(pk=self.project.pk).exists())
        self.assertEqual(AxisOutboxEvent.objects.get(event_type=field_events.CREATED).payload["sow_plan_status"], "failed")
        self.assertTrue(Notification.objects.filter(user=self.world["user"], title="Plano da SOW falhou").exists())

    def test_arquivo_ilegivel_marca_failed(self):
        with mock.patch.object(api_client, "download_project_document", return_value=(b"%PDF-1.4 lixo", "sow.pdf", "application/pdf")):
            status = sow_plan.run(self.project.pk)
        self.assertEqual(status, Project.SOW_PLAN_FAILED)
        self.project.refresh_from_db()
        self.assertIn("ler", self.project.sow_plan_note)

    def test_erro_inesperado_marca_failed(self):
        with self.download(), mock.patch("axis_integration.sow_plan.create_project_tasks_from_generated_tasks", side_effect=RuntimeError("boom")):
            status = sow_plan.run(self.project.pk)
        self.assertEqual(status, Project.SOW_PLAN_FAILED)
        self.project.refresh_from_db()
        self.assertIn("boom", self.project.sow_plan_note)

    def test_pdf_de_verdade_e_lido_com_pypdf(self):
        from reportlab.pdfgen import canvas

        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer)
        pdf.drawString(72, 750, CLEAN_SOW)
        pdf.save()
        with mock.patch.object(api_client, "download_project_document", return_value=(buffer.getvalue(), "sow.pdf", "application/pdf")):
            status = sow_plan.run(self.project.pk)
        self.assertEqual(status, Project.SOW_PLAN_GENERATED, Project.objects.get(pk=self.project.pk).sow_plan_note)
        self.assertEqual(Project.objects.get(pk=self.project.pk).sow_import.source_type, "PDF")

    def test_comando_retoma_pendente_e_processing_travado(self):
        stuck = Project.objects.create(
            company=self.company, name="Travada", axis_project_id=uuid.uuid4(), axis_sow_document_id=uuid.uuid4(),
            sow_plan_status=Project.SOW_PLAN_PROCESSING,
        )
        Project.objects.filter(pk=stuck.pk).update(updated_at=timezone.now() - timedelta(minutes=30))
        with mock.patch.object(api_client, "download_project_document", side_effect=api_client.AxisApiError("fora do ar")):
            call_command("axis_sow_plan", stdout=io.StringIO())
        for project in (self.project, stuck):
            project.refresh_from_db()
            self.assertEqual(project.sow_plan_status, Project.SOW_PLAN_FAILED)

    def test_processing_recente_nao_e_pego_de_novo(self):
        Project.objects.filter(pk=self.project.pk).update(sow_plan_status=Project.SOW_PLAN_PROCESSING, updated_at=timezone.now())
        with self.download() as mocked:
            self.assertIsNone(sow_plan.run(self.project.pk))
        mocked.assert_not_called()


class DownloadClientTests(TestCase):
    class FakeResponse:
        def __init__(self, status=200, content=b"%PDF-1.4", headers=None):
            self.status_code, self._content, self.headers = status, content, headers or {}

        def iter_content(self, chunk_size):
            yield self._content

        def close(self):
            pass

    def client_with(self, response=None, exc=None):
        session = mock.Mock()
        if exc:
            session.get.side_effect = exc
        else:
            session.get.return_value = response
        return api_client.AxisApiClient(base_url="http://core.test/api/v1", api_key="chave-secreta", session=session), session

    def test_baixa_com_a_api_key_e_le_o_nome_do_arquivo(self):
        response = self.FakeResponse(headers={"Content-Disposition": "attachment; filename*=UTF-8''SOW%20GRU53.pdf", "Content-Type": "application/pdf"})
        client, session = self.client_with(response)
        content, name, mime = api_client.download_project_document("p1", "d1", client=client)
        self.assertEqual((content, name, mime), (b"%PDF-1.4", "SOW GRU53.pdf", "application/pdf"))
        args, kwargs = session.get.call_args
        self.assertEqual(args[0], "http://core.test/api/v1/integration/projects/p1/documents/d1/content")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer chave-secreta")

    def test_erros_viram_mensagens_sem_vazar_a_chave(self):
        for status, expected in ((404, "não foi encontrada"), (401, "recusou a API key"), (500, "500")):
            client, _ = self.client_with(self.FakeResponse(status=status))
            with self.assertRaises(api_client.AxisApiError) as ctx:
                api_client.download_project_document("p1", "d1", client=client)
            self.assertIn(expected, str(ctx.exception))
            self.assertNotIn("chave-secreta", str(ctx.exception))
        client, _ = self.client_with(exc=requests.ConnectionError("x"))
        with self.assertRaises(api_client.AxisApiError):
            api_client.download_project_document("p1", "d1", client=client)

    def test_documento_grande_demais_e_recusado(self):
        client, _ = self.client_with(self.FakeResponse(headers={"Content-Length": str(50 * 1024 * 1024)}))
        with self.assertRaises(api_client.AxisDocumentTooLarge):
            api_client.download_project_document("p1", "d1", client=client)
        client, _ = self.client_with(self.FakeResponse(content=b"x" * 2048))
        with self.assertRaises(api_client.AxisDocumentTooLarge):
            api_client.download_project_document("p1", "d1", client=client, max_bytes=1024)


@core_settings()
class OutboxTests(ObraBase):
    def make_event(self):
        return AxisOutboxEvent.objects.create(event_type="field.project.started", payload={"axis_project_id": self.project_id, "x": "ç"})

    def ok_session(self, status=200):
        session = mock.Mock()
        session.post.return_value = mock.Mock(status_code=status)
        return session

    def test_envelope_assinatura_e_cabecalhos(self):
        event = self.make_event()
        session = self.ok_session()
        self.assertTrue(outbox.send(event, session=session))
        (url,), kwargs = session.post.call_args
        self.assertEqual(url, "http://core.test/api/v1/integration/inbound")
        body = kwargs["data"]
        expected = "sha256=" + hmac.new(OUTBOUND_SECRET.encode(), body, hashlib.sha256).hexdigest()
        self.assertEqual(kwargs["headers"]["X-Field-Signature"], expected)
        self.assertEqual(kwargs["headers"]["Idempotency-Key"], str(event.event_id))
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer chave-de-teste")
        envelope = json.loads(body)
        self.assertEqual(set(envelope), {"event_id", "event_type", "occurred_at", "source", "payload"})
        self.assertEqual(envelope["source"], "field")
        self.assertEqual(envelope["event_id"], str(event.event_id))
        self.assertEqual(envelope["payload"]["x"], "ç")
        event.refresh_from_db()
        self.assertEqual((event.status, event.attempts), (AxisOutboxEvent.STATUS_SENT, 1))

    def test_enviado_nao_e_reenviado(self):
        event = self.make_event()
        session = self.ok_session()
        first = outbox.dispatch_pending(session=session)
        second = outbox.dispatch_pending(session=session)
        self.assertEqual((first["sent"], second["sent"]), (1, 0))
        self.assertEqual(session.post.call_count, 1)
        self.assertFalse(outbox.dispatch_one(event.pk, session=session))
        self.assertEqual(session.post.call_count, 1)

    def test_falha_agenda_nova_tentativa_com_backoff_e_o_mesmo_event_id(self):
        event = self.make_event()
        session = mock.Mock()
        session.post.side_effect = requests.ConnectionError("fora")
        outbox.dispatch_pending(session=session)
        event.refresh_from_db()
        self.assertEqual((event.status, event.attempts), (AxisOutboxEvent.STATUS_PENDING, 1))
        self.assertIn("ConnectionError", event.last_error)
        self.assertGreater(event.next_attempt_at, timezone.now() + timedelta(seconds=20))
        # ainda não venceu: nada é enviado
        self.assertEqual(outbox.dispatch_pending(session=session)["sent"], 0)
        self.assertEqual(session.post.call_count, 1)
        # vence e o Core volta: o mesmo event_id vai de novo (o Core deduplica por Idempotency-Key)
        AxisOutboxEvent.objects.filter(pk=event.pk).update(next_attempt_at=timezone.now() - timedelta(seconds=1))
        session.post.side_effect = None
        session.post.return_value = mock.Mock(status_code=200)
        self.assertEqual(outbox.dispatch_pending(session=session)["sent"], 1)
        keys = {call.kwargs["headers"]["Idempotency-Key"] for call in session.post.call_args_list}
        self.assertEqual(keys, {str(event.event_id)})

    def test_resposta_de_erro_do_core_conta_como_falha(self):
        event = self.make_event()
        outbox.dispatch_pending(session=self.ok_session(status=401))
        event.refresh_from_db()
        self.assertEqual(event.status, AxisOutboxEvent.STATUS_PENDING)
        self.assertIn("401", event.last_error)

    @override_settings(AXIS_OUTBOUND_MAX_ATTEMPTS=2)
    def test_esgota_as_tentativas_e_o_comando_reabre(self):
        event = self.make_event()
        session = mock.Mock()
        session.post.side_effect = requests.Timeout("lento")
        for _ in range(2):
            AxisOutboxEvent.objects.filter(pk=event.pk).update(next_attempt_at=timezone.now() - timedelta(seconds=1))
            outbox.dispatch_pending(session=session)
        event.refresh_from_db()
        self.assertEqual(event.status, AxisOutboxEvent.STATUS_DEAD)
        call_command("axis_outbox_dispatch", "--retry-dead", stdout=io.StringIO())
        event.refresh_from_db()
        self.assertEqual(event.status, AxisOutboxEvent.STATUS_PENDING)

    @override_settings(AXIS_OUTBOUND_SECRET="")
    def test_sem_segredo_o_evento_fica_na_fila_sem_gastar_tentativa(self):
        event = self.make_event()
        session = self.ok_session()
        summary = outbox.dispatch_pending(session=session)
        self.assertEqual(summary["skipped_not_configured"], 1)
        session.post.assert_not_called()
        event.refresh_from_db()
        self.assertEqual((event.status, event.attempts), (AxisOutboxEvent.STATUS_PENDING, 0))

    @override_settings(AXIS_OUTBOUND_IMMEDIATE=True)
    def test_enqueue_tenta_enviar_depois_do_commit(self):
        with mock.patch.object(outbox.requests, "post", return_value=mock.Mock(status_code=200)) as post:
            with self.captureOnCommitCallbacks(execute=True):
                event = outbox.enqueue("field.project.started", {"axis_project_id": self.project_id})
            post.assert_called_once()
        event.refresh_from_db()
        self.assertEqual(event.status, AxisOutboxEvent.STATUS_SENT)

    def test_enqueue_sem_commit_so_grava(self):
        with self.captureOnCommitCallbacks(execute=False):
            event = outbox.enqueue("field.project.started", {})
        self.assertEqual(event.status, AxisOutboxEvent.STATUS_PENDING)

    def test_core_aceita_a_assinatura_do_corpo_enviado(self):
        """Confere o que o guard do Core confere: HMAC-SHA256 do corpo bruto com o segredo, `sha256=<hex>`."""
        event = self.make_event()
        session = self.ok_session()
        outbox.send(event, session=session)
        kwargs = session.post.call_args.kwargs
        header = kwargs["headers"]["X-Field-Signature"]
        self.assertRegex(header, r"^sha256=[0-9a-f]{64}$")
        self.assertTrue(hmac.compare_digest(header, "sha256=" + hmac.new(OUTBOUND_SECRET.encode(), kwargs["data"], hashlib.sha256).hexdigest()))
        self.assertIsInstance(kwargs["data"], bytes)


@core_settings()
class LifecycleTests(ObraBase):
    def setUp(self):
        super().setUp()
        self.project = self.make_project()
        self.t1 = ProjectTask.objects.create(project=self.project, task=Task.objects.create(name="T1"))
        self.t2 = ProjectTask.objects.create(project=self.project, task=Task.objects.create(name="T2"))

    def events(self, kind):
        return AxisOutboxEvent.objects.filter(event_type=kind)

    def test_started_so_uma_vez_na_primeira_tarefa_iniciada(self):
        self.assertEqual(self.events(field_events.STARTED).count(), 0)
        started = timezone.now() - timedelta(hours=2)
        self.t1.status = ProjectTask.STATUS_IN_PROGRESS
        self.t1.actual_start = started
        self.t1.save()
        self.t2.status = ProjectTask.STATUS_IN_PROGRESS
        self.t2.actual_start = timezone.now()
        self.t2.save()
        self.t1.status = ProjectTask.STATUS_PAUSED
        self.t1.save()
        self.assertEqual(self.events(field_events.STARTED).count(), 1)
        payload = self.events(field_events.STARTED).get().payload
        self.assertEqual(set(payload), {"axis_project_id", "field_project_id", "started_at"})
        self.assertEqual(payload["axis_project_id"], self.project_id)
        self.assertEqual(payload["field_project_id"], self.project.pk)
        self.assertEqual(payload["started_at"], started.isoformat())
        self.project.refresh_from_db()
        self.assertIsNotNone(self.project.axis_started_at)

    def test_obra_sem_axis_project_id_nao_emite_nada(self):
        local = Project.objects.create(company=self.company, name="Local")
        task = ProjectTask.objects.create(project=local, task=Task.objects.create(name="L1"), status=ProjectTask.STATUS_COMPLETED)
        self.assertEqual(AxisOutboxEvent.objects.count(), 0)
        self.assertEqual(field_events.check_lifecycle(local.pk), [])
        self.assertIsNotNone(task.pk)

    def test_completed_quando_todas_as_tarefas_nao_canceladas_concluem(self):
        self.t1.status = ProjectTask.STATUS_COMPLETED
        self.t1.actual_start = timezone.now()
        self.t1.save()
        self.assertEqual(self.events(field_events.COMPLETED).count(), 0)
        self.t2.status = ProjectTask.STATUS_CANCELED
        self.t2.save()
        self.assertEqual(self.events(field_events.COMPLETED).count(), 1)
        payload = self.events(field_events.COMPLETED).get().payload
        self.assertEqual(set(payload), {"axis_project_id", "field_project_id", "completed_at"})
        self.t2.status = ProjectTask.STATUS_COMPLETED
        self.t2.save()
        self.assertEqual(self.events(field_events.COMPLETED).count(), 1)
        self.assertEqual(self.events(field_events.STARTED).count(), 1)

    def test_atualizacao_em_massa_e_recuperada_pelo_comando_diario(self):
        ProjectTask.objects.filter(project=self.project).update(status=ProjectTask.STATUS_COMPLETED)  # .update() não dispara sinal
        self.assertEqual(AxisOutboxEvent.objects.count(), 0)
        call_command("axis_progress_snapshot", stdout=io.StringIO())
        self.assertEqual(self.events(field_events.STARTED).count(), 1)
        self.assertEqual(self.events(field_events.COMPLETED).count(), 1)

    def test_metricas_de_progresso_seguem_a_regra_1_de_horas(self):
        tecnico_a = Collaborator.objects.create(person=Person.objects.create(name="A", company=self.company))
        tecnico_b = Collaborator.objects.create(person=Person.objects.create(name="B", company=self.company))
        self.t1.status = ProjectTask.STATUS_COMPLETED
        self.t1.save()
        ProjectTaskAssignment.objects.create(project_task=self.t1, collaborator=tecnico_a, actual_hours=2, status="completed")
        ProjectTaskAssignment.objects.create(project_task=self.t1, collaborator=tecnico_b, actual_hours=3, status="completed")
        extra = ProjectTask.objects.create(project=self.project, task=Task.objects.create(name="T3"), status=ProjectTask.STATUS_CANCELED)
        self.assertIsNotNone(extra.pk)
        metrics = field_events.progress_metrics(Project.objects.get(pk=self.project.pk))
        # soma das horas de cada técnico (2 + 3), não duração × técnicos; cancelada fica fora da contagem
        self.assertEqual(metrics["real_man_hours"], 5.0)
        self.assertEqual((metrics["tasks_total"], metrics["tasks_done"], metrics["percent_complete"]), (2, 1, 50))
        self.assertEqual(metrics["planned_man_hours"], 100.0)  # só função de campo

    def test_snapshot_diario_payload_idempotencia_e_mudanca(self):
        day = "2026-12-05"
        call_command("axis_progress_snapshot", "--date", day, stdout=io.StringIO())
        first = self.events(field_events.PROGRESS).get()
        self.assertEqual(
            set(first.payload),
            {"axis_project_id", "field_project_id", "date", "percent_complete", "tasks_total", "tasks_done", "real_man_hours", "planned_man_hours"},
        )
        self.assertEqual(first.payload["date"], day)
        call_command("axis_progress_snapshot", "--date", day, stdout=io.StringIO())
        self.assertEqual(self.events(field_events.PROGRESS).count(), 1)  # sem mudança: não repete
        self.t1.status = ProjectTask.STATUS_COMPLETED
        self.t1.save()
        call_command("axis_progress_snapshot", "--date", day, stdout=io.StringIO())
        self.assertEqual(self.events(field_events.PROGRESS).count(), 2)  # mudou: novo evento do mesmo dia
        self.assertEqual(self.events(field_events.PROGRESS).order_by("-id").first().payload["percent_complete"], 50)

    def test_snapshot_ignora_obra_sem_tarefas_ou_cancelada(self):
        ProjectTask.objects.filter(project=self.project).delete()
        call_command("axis_progress_snapshot", stdout=io.StringIO())
        self.assertEqual(self.events(field_events.PROGRESS).count(), 0)
        ProjectTask.objects.create(project=self.project, task=Task.objects.create(name="T9"))
        Project.objects.filter(pk=self.project.pk).update(status=Project.STATUS_CANCELED)
        call_command("axis_progress_snapshot", stdout=io.StringIO())
        self.assertEqual(self.events(field_events.PROGRESS).count(), 0)

    def test_created_payload_tem_o_contrato_fixo(self):
        self.project.sow_plan_status = Project.SOW_PLAN_PENDING_REVIEW
        field_events.emit_created(self.project, tasks_count=0)
        payload = self.events(field_events.CREATED).get().payload
        self.assertEqual(
            set(payload),
            {"axis_project_id", "field_project_id", "field_project_code", "url", "status", "sow_plan_status", "tasks_count", "created_at"},
        )
        self.assertEqual(payload["field_project_code"], self.project.code)
        self.assertTrue(payload["url"].endswith(f"/projetos/{self.project.pk}"))
        self.assertEqual(payload["status"], "planning")

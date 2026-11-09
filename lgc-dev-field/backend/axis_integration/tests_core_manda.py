"""Onda V3 (MI-01/MI-02): o Field cria e atualiza os cadastros do Core e bloqueia os campos do Core no registro casado.

Rodam no banco de teste que o Django cria e destrói; a geocodificação e a API do Core são simuladas."""

import io
import uuid
from datetime import date, timedelta
from unittest import mock

from django.contrib import admin
from django.test import RequestFactory, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.admin import ClientAdmin, CollaboratorAdmin, SiteAdmin
from core.csv_io import import_csv_rows
from core.models import Client, Collaborator, Company, Holiday, JobTitle, Person, Site
from dispatch.models import TechnicianAbsence
from projects.sites_panel import business_days_between, previous_business_day
from users.models import User

from .matching import build_unmatched_report
from .models import AxisMasterRecord
from .tests import WebhookBase


def later(seconds=1):
    return timezone.now() + timedelta(seconds=seconds)


def client_payload(axis_id, **extra):
    """`client.*` do contrato V1 (estado completo)."""
    payload = {
        "client_id": axis_id, "code": 12, "name": "Hyperscale Brasil Ltda", "legal_name": "Hyperscale Brasil Ltda",
        "trade_name": "Hyperscale", "cnpj": "11222333000181", "phone": "11987654321", "email": "contato@hyper.test",
        "cep": "13170-000", "address_street": "Rua das Fibras", "address_number": "100", "address_complement": None,
        "address_district": "Centro", "address_city": "Sumaré", "address_state": "sp", "active": True,
    }
    payload.update(extra)
    return payload


def collaborator_payload(axis_id, **extra):
    """`collaborator.*` do contrato V1."""
    payload = {
        "collaborator_id": axis_id, "name": "Técnico Novo", "status": "ativo", "sector_id": str(uuid.uuid4()),
        "cost_center_id": None, "job_title_id": str(uuid.uuid4()), "job_title_name": "Técnico de Fibra",
        "admission_date": "2026-01-10", "email": "tecnico.novo@lgc.test", "matricula": "M-900", "phone": "11912345678",
        "yellow_badge": "YB-77", "supervisor_id": None, "management_level": "colaborador", "job_title_is_technician": True,
        "active": True,
    }
    payload.update(extra)
    return payload


class ClientCreateUpdateTests(WebhookBase):
    def test_cria_cliente_com_campos_do_core_e_atualiza_depois(self):
        axis_id = str(uuid.uuid4())
        self.assertEqual(self.post("client.created", client_payload(axis_id)).status_code, 200)
        client = Client.objects.get(axis_client_id=axis_id)
        self.assertEqual(client.company, self.company)
        self.assertEqual((client.legal_name, client.trade_name), ("Hyperscale Brasil Ltda", "Hyperscale"))
        self.assertEqual(client.tax_id, "11.222.333/0001-81")
        self.assertEqual(client.phone, "+55 (11) 98765-4321")
        self.assertEqual((client.city, client.state), ("Sumaré", "SP"))
        self.assertEqual(client.address, "Rua das Fibras, 100 - Centro - CEP 13170-000")

        client.notes = "Observação do Field"
        client.save()
        self.post("client.updated", client_payload(axis_id, trade_name="Hyper DC", changed_fields=["trade_name"]),
                  occurred_at=later())
        client.refresh_from_db()
        self.assertEqual(client.trade_name, "Hyper DC")
        self.assertEqual(client.notes, "Observação do Field")  # campo do Field não é tocado

        self.post("client.deleted", {"client_id": axis_id, "code": 12, "active": False, "deleted": True},
                  occurred_at=later(2))
        client.refresh_from_db()
        self.assertFalse(client.is_active)
        self.assertEqual(Client.objects.count(), 1)  # nada apagado

    def test_cliente_inativo_no_core_nao_e_criado(self):
        axis_id = str(uuid.uuid4())
        self.post("client.updated", client_payload(axis_id, active=False))
        self.assertFalse(Client.objects.exists())
        reason = build_unmatched_report()["core_without_field"]["client"][0]["motivo"]
        self.assertIn("inativo", reason)

    def test_cnpj_de_cliente_vinculado_a_outro_id_nao_cria_duplicado(self):
        self.make_client(tax_id="11.222.333/0001-81", axis_client_id=uuid.uuid4())
        self.post("client.created", client_payload(str(uuid.uuid4())))
        self.assertEqual(Client.objects.count(), 1)

    @override_settings(AXIS_DEFAULT_COMPANY_ID=None)
    def test_empresa_padrao_configurada(self):
        other = Company.objects.create(legal_name="Outra Empresa")
        axis_id = str(uuid.uuid4())
        with override_settings(AXIS_DEFAULT_COMPANY_ID=other.pk):
            self.post("client.created", client_payload(axis_id))
        self.assertEqual(Client.objects.get(axis_client_id=axis_id).company, other)


class SiteCreateTests(WebhookBase):
    def site_payload(self, client_axis_id, **extra):
        payload = {
            "site_id": str(uuid.uuid4()), "client_id": client_axis_id, "code": "GRU65", "name": "GRU65 Cajamar",
            "cep": None, "address_street": "Estrada X", "address_number": "5", "address_complement": None,
            "address_district": None, "address_city": "Cajamar", "address_state": "SP",
            "latitude": -23.3561234567, "longitude": -46.8765432109, "active": True,
        }
        payload.update(extra)
        return payload

    def test_site_e_criado_com_coordenadas_do_core_sem_geocodificar(self):
        client_axis = str(uuid.uuid4())
        self.post("client.created", client_payload(client_axis))
        payload = self.site_payload(client_axis)
        with mock.patch("core.geocoding.geocode_site_address") as geocode:
            self.post("site.created", payload, occurred_at=later())
            site = Site.objects.get(axis_site_id=payload["site_id"])
            self.assertEqual(site.client.axis_client_id, uuid.UUID(client_axis))
            self.assertEqual((site.code, site.name, site.city, site.state), ("GRU65", "GRU65 Cajamar", "Cajamar", "SP"))
            self.assertEqual(str(site.latitude), "-23.356123")
            self.assertTrue(site.manual_coordinates)
            # salvar pela tela (ex.: regional) não troca a coordenada do Core
            site.save()
            geocode.assert_not_called()

    def test_site_sem_coordenadas_e_criado_sem_chamar_a_internet(self):
        client_axis = str(uuid.uuid4())
        self.post("client.created", client_payload(client_axis))
        payload = self.site_payload(client_axis, latitude=None, longitude=None)
        with mock.patch("core.geocoding.geocode_site_address") as geocode:
            self.post("site.created", payload, occurred_at=later())
            geocode.assert_not_called()
        site = Site.objects.get(axis_site_id=payload["site_id"])
        self.assertIsNone(site.latitude)
        self.assertFalse(site.manual_coordinates)

    def test_site_que_chega_antes_do_cliente_e_criado_quando_o_cliente_chega(self):
        client_axis = str(uuid.uuid4())
        payload = self.site_payload(client_axis)
        self.post("site.created", payload)
        self.assertFalse(Site.objects.exists())
        self.post("client.created", client_payload(client_axis), occurred_at=later())
        self.assertTrue(Site.objects.filter(axis_site_id=payload["site_id"], client__axis_client_id=client_axis).exists())

    def test_regional_do_field_sobrevive_a_atualizacao(self):
        from core.models import Region

        client_axis = str(uuid.uuid4())
        self.post("client.created", client_payload(client_axis))
        payload = self.site_payload(client_axis)
        self.post("site.created", payload, occurred_at=later())
        region = Region.objects.create(name="Grande SP", code="ZZ-GSP")
        Site.objects.filter(axis_site_id=payload["site_id"]).update(region=region)
        self.post("site.updated", {**payload, "name": "GRU65 novo nome"}, occurred_at=later(2))
        site = Site.objects.get(axis_site_id=payload["site_id"])
        self.assertEqual((site.name, site.region), ("GRU65 novo nome", region))


class JobTitleTests(WebhookBase):
    def test_cria_casa_renomeia_e_inativa_cargo(self):
        existing = JobTitle.objects.create(company=self.company, name="supervisor de campo")
        sup_id, new_id = str(uuid.uuid4()), str(uuid.uuid4())
        self.post("job_title.created", {"job_title_id": sup_id, "name": "Supervisor de Campo", "is_technician": False,
                                        "active": True})
        existing.refresh_from_db()
        self.assertEqual(str(existing.axis_job_title_id), sup_id)  # casou pelo nome, sem diferenciar maiúsculas
        self.assertEqual(existing.name, "Supervisor de Campo")

        self.post("job_title.created", {"job_title_id": new_id, "name": "Emendador", "is_technician": True, "active": True})
        created = JobTitle.objects.get(axis_job_title_id=new_id)
        self.assertEqual(created.company, self.company)

        self.post("job_title.updated", {"job_title_id": new_id, "name": "Emendador Óptico", "is_technician": True,
                                        "active": True}, occurred_at=later())
        self.post("job_title.deleted", {"job_title_id": new_id, "name": "Emendador Óptico", "active": False,
                                        "deleted": True}, occurred_at=later(2))
        created.refresh_from_db()
        self.assertEqual(created.name, "Emendador Óptico")
        self.assertFalse(created.is_active)


class CollaboratorCreateTests(WebhookBase):
    def test_tecnico_novo_no_core_e_criado_com_pessoa_cargo_e_dados(self):
        axis_id = str(uuid.uuid4())
        payload = collaborator_payload(axis_id)
        self.post("collaborator.created", payload)
        collaborator = Collaborator.objects.get(axis_collaborator_id=axis_id)
        person = collaborator.person
        self.assertEqual((person.name, person.email, person.phone, person.company),
                         ("Técnico Novo", "tecnico.novo@lgc.test", "+55 (11) 91234-5678", self.company))
        self.assertEqual((collaborator.registration, collaborator.yellow_badge), ("M-900", "YB-77"))
        self.assertEqual(collaborator.job_title.name, "Técnico de Fibra")
        self.assertEqual(str(collaborator.job_title.axis_job_title_id), payload["job_title_id"])
        self.assertEqual(collaborator.axis_status, "ativo")
        self.assertTrue(collaborator.is_active)

    def test_colaborador_administrativo_nao_entra_no_field(self):
        axis_id = str(uuid.uuid4())
        self.post("collaborator.created", collaborator_payload(axis_id, job_title_is_technician=False))
        self.assertFalse(Collaborator.objects.exists())
        reason = build_unmatched_report()["core_without_field"]["collaborator"][0]["motivo"]
        self.assertIn("nem técnico nem gestor", reason)

    def test_gestor_entra_mesmo_sem_cargo_tecnico_e_supervisor_que_chega_depois_e_resolvido(self):
        tech_id, sup_id = str(uuid.uuid4()), str(uuid.uuid4())
        self.post("collaborator.created", collaborator_payload(tech_id, supervisor_id=sup_id))
        tech = Collaborator.objects.get(axis_collaborator_id=tech_id)
        self.assertIsNone(tech.manager)
        self.post("collaborator.created", collaborator_payload(
            sup_id, name="Supervisora", email="sup@lgc.test", matricula="M-901", job_title_is_technician=False,
            management_level="supervisor", job_title_id=str(uuid.uuid4()), job_title_name="Supervisor",
        ), occurred_at=later())
        supervisor = Collaborator.objects.get(axis_collaborator_id=sup_id)
        tech.refresh_from_db()
        self.assertEqual(tech.manager, supervisor)

        # Core troca o supervisor para alguém fora do Field: o gestor antigo não fica pendurado
        self.post("collaborator.updated", collaborator_payload(tech_id, supervisor_id=str(uuid.uuid4())), occurred_at=later(2))
        tech.refresh_from_db()
        self.assertIsNone(tech.manager)

    def test_ferias_so_aparece_como_situacao_no_core_sem_ausencia(self):
        axis_id = str(uuid.uuid4())
        self.post("collaborator.created", collaborator_payload(axis_id))
        self.post("collaborator.updated", collaborator_payload(axis_id, status="ferias"), occurred_at=later())
        collaborator = Collaborator.objects.get(axis_collaborator_id=axis_id)
        self.assertEqual(collaborator.axis_status, "ferias")
        self.assertTrue(collaborator.is_active)
        self.assertFalse(TechnicianAbsence.objects.exists())

    def test_desligado_no_core_fica_inativo(self):
        axis_id = str(uuid.uuid4())
        self.post("collaborator.created", collaborator_payload(axis_id))
        self.post("collaborator.offboarded", collaborator_payload(axis_id, status="desligado", active=False,
                                                                  offboarded_at="2026-11-08"), occurred_at=later())
        collaborator = Collaborator.objects.get(axis_collaborator_id=axis_id)
        self.assertFalse(collaborator.is_active)
        self.assertEqual(collaborator.axis_status, "desligado")

    def test_casamento_por_email_vem_antes_da_criacao(self):
        existing = self.make_collaborator(name="Nome Antigo", email="TECNICO.NOVO@lgc.test")
        axis_id = str(uuid.uuid4())
        self.post("collaborator.created", collaborator_payload(axis_id))
        self.assertEqual(Collaborator.objects.count(), 1)
        existing.refresh_from_db()
        self.assertEqual(str(existing.axis_collaborator_id), axis_id)
        self.assertEqual(existing.person.name, "Técnico Novo")


class UserMirrorTests(WebhookBase):
    def test_usuario_casa_por_email_espelha_ativo_e_nao_e_criado(self):
        user = User.objects.create_user(username="ana", email="ana@lgc.test", password="x")
        axis_id = str(uuid.uuid4())
        base = {"user_id": axis_id, "email": "ANA@lgc.test", "name": "Ana", "collaborator_id": None, "roles": ["Técnico"]}
        self.post("user.created", {**base, "status": "active", "active": True})
        user.refresh_from_db()
        self.assertEqual(str(user.axis_user_id), axis_id)
        self.post("user.disabled", {**base, "status": "disabled", "active": False}, occurred_at=later())
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.post("user.updated", {**base, "status": "active", "active": True}, occurred_at=later(2))
        user.refresh_from_db()
        self.assertTrue(user.is_active)

        self.post("user.created", {"user_id": str(uuid.uuid4()), "email": "novo@lgc.test", "status": "active", "active": True})
        self.assertEqual(User.objects.count(), 1)  # o Field não cria usuário (login pelo Core pendente)


class HolidayTests(WebhookBase):
    def test_feriado_do_core_entra_na_contagem_de_dias_uteis(self):
        friday = date(2026, 11, 20)  # sexta-feira (Consciência Negra)
        thursday, monday = date(2026, 11, 19), date(2026, 11, 23)
        self.assertEqual(business_days_between(thursday, monday), 2)
        self.assertEqual(previous_business_day(monday), friday)

        axis_id = str(uuid.uuid4())
        self.post("holiday.created", {"holiday_id": axis_id, "date": "2026-11-20", "name": "Consciência Negra", "active": True})
        holiday = Holiday.objects.get(axis_holiday_id=axis_id)
        self.assertEqual(holiday.date, friday)
        self.assertEqual(business_days_between(thursday, monday), 1)
        self.assertEqual(previous_business_day(monday), thursday)

        self.post("holiday.deleted", {"holiday_id": axis_id, "date": "2026-11-20", "name": "Consciência Negra",
                                      "active": False, "deleted": True}, occurred_at=later())
        holiday.refresh_from_db()
        self.assertFalse(holiday.is_active)
        self.assertEqual(business_days_between(thursday, monday), 2)


class LockTests(WebhookBase):
    def setUp(self):
        super().setUp()
        self.admin_user = User.objects.create_superuser(username="adm", email="adm@lgc.test", password="x")
        self.api = APIClient()
        self.api.force_authenticate(user=self.admin_user)
        self.client_axis = str(uuid.uuid4())
        self.post("client.created", client_payload(self.client_axis))
        self.linked = Client.objects.get(axis_client_id=self.client_axis)

    def test_api_expoe_o_vinculo_e_os_campos_bloqueados(self):
        data = self.api.get(f"/api/registry/clients/{self.linked.pk}/").json()
        self.assertEqual(data["axis_client_id"], self.client_axis)
        self.assertIn("legal_name", data["axis_locked_fields"])
        self.assertNotIn("notes", data["axis_locked_fields"])
        free = self.make_client(legal_name="Sem Vínculo")
        self.assertEqual(self.api.get(f"/api/registry/clients/{free.pk}/").json()["axis_locked_fields"], [])

    def test_campo_do_core_e_recusado_e_campo_do_field_passa(self):
        response = self.api.patch(f"/api/registry/clients/{self.linked.pk}/", {"legal_name": "Outro"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Mantido no Axis Core", response.json()["legal_name"][0])
        # o formulário manda o registro inteiro: valores iguais aos do Core passam
        full = self.api.get(f"/api/registry/clients/{self.linked.pk}/").json()
        full["notes"] = "Portaria pelo lado B"
        response = self.api.put(f"/api/registry/clients/{self.linked.pk}/", full, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.linked.refresh_from_db()
        self.assertEqual((self.linked.notes, self.linked.legal_name), ("Portaria pelo lado B", "Hyperscale Brasil Ltda"))

    def test_registro_sem_vinculo_continua_editavel(self):
        free = self.make_client(legal_name="Sem Vínculo")
        response = self.api.patch(f"/api/registry/clients/{free.pk}/", {"legal_name": "Editado"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_tecnico_casado_bloqueia_nome_e_libera_sites(self):
        axis_id = str(uuid.uuid4())
        self.post("collaborator.created", collaborator_payload(axis_id))
        collaborator = Collaborator.objects.get(axis_collaborator_id=axis_id)
        site = Site.objects.create(client=self.linked, code="ZZ1", name="Site Field", manual_coordinates=True)
        url = f"/api/registry/collaborators/{collaborator.pk}/"
        response = self.api.patch(url, {"name": "Outro Nome"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json())
        response = self.api.patch(url, {"sites": [site.pk]}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(list(collaborator.sites.all()), [site])
        self.assertEqual(response.json()["axis_status"], "ativo")

    def test_exclusao_de_registro_casado_e_recusada(self):
        response = self.api.delete(f"/api/registry/clients/{self.linked.pk}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Client.objects.filter(pk=self.linked.pk).exists())

    def test_admin_deixa_campos_do_core_somente_leitura(self):
        request = RequestFactory().get("/admin/")
        request.user = self.admin_user
        client_admin = ClientAdmin(Client, admin.site)
        self.assertIn("legal_name", client_admin.get_readonly_fields(request, self.linked))
        self.assertNotIn("legal_name", client_admin.get_readonly_fields(request, self.make_client(legal_name="Livre")))
        self.assertNotIn("notes", client_admin.get_readonly_fields(request, self.linked))

        site = Site.objects.create(client=self.linked, code="ZZ2", name="S", axis_site_id=uuid.uuid4(), manual_coordinates=True)
        site_ro = SiteAdmin(Site, admin.site).get_readonly_fields(request, site)
        self.assertIn("latitude", site_ro)
        self.assertNotIn("region", site_ro)

        axis_id = str(uuid.uuid4())
        self.post("collaborator.created", collaborator_payload(axis_id))
        collaborator = Collaborator.objects.get(axis_collaborator_id=axis_id)
        collab_admin = CollaboratorAdmin(Collaborator, admin.site)
        readonly = collab_admin.get_readonly_fields(request, collaborator)
        self.assertIn("registration", readonly)
        self.assertNotIn("sites", readonly)
        form = collab_admin.get_form(request, collaborator)(instance=collaborator)
        self.assertTrue(form.fields["name"].disabled)

    def test_csv_nao_completa_dados_de_pessoa_casada(self):
        axis_id = str(uuid.uuid4())
        self.post("collaborator.created", collaborator_payload(axis_id, phone=None))
        person = Collaborator.objects.get(axis_collaborator_id=axis_id).person
        csv_content = "Nome;E-mail;Telefone;Empresa;Matrícula\nTécnico Novo;tecnico.novo@lgc.test;11999998888;;X-1\n"
        import_csv_rows(Collaborator, csv_content)
        person.refresh_from_db()
        self.assertEqual(person.phone, "")


class AxisSyncV1ResourcesTests(WebhookBase):
    class FakeClient:
        def __init__(self, data):
            self.data = data
            self.calls = []

        def iter_all(self, resource, per_page=200):
            self.calls.append(resource)
            yield from self.data.get(resource, [])

    def test_carga_le_cargos_feriados_e_usuarios_e_cria_o_que_falta(self):
        from django.core.management import call_command

        user = User.objects.create_user(username="bia", email="bia@lgc.test", password="x")
        jt_id, collab_id, user_id, holiday_id = (str(uuid.uuid4()) for _ in range(4))
        fake = self.FakeClient({
            "job-titles": [{"id": jt_id, "name": "Técnico de Fibra", "isTechnician": True}],
            "collaborators": [{
                "id": collab_id, "fullName": "Bia Campos", "corporateEmail": "bia@lgc.test", "matricula": "M-1",
                "status": "ativo", "jobTitleId": jt_id, "jobTitle": {"name": "Técnico de Fibra", "isTechnician": True},
                "supervisorId": None, "managementLevel": "colaborador",
            }],
            "users": [{"id": user_id, "email": "bia@lgc.test", "status": "disabled", "roles": ["Técnico"],
                       "collaborator_id": collab_id}],
            "holidays": [{"id": holiday_id, "date": "2026-12-25T00:00:00.000Z", "name": "Natal"}],
        })
        out = io.StringIO()
        with override_settings(AXIS_API_URL="http://core.test/api/v1", AXIS_API_KEY="k"), mock.patch(
            "axis_integration.management.commands.axis_sync.AxisApiClient", return_value=fake
        ):
            call_command("axis_sync", stdout=out)
        for resource in ("job-titles", "users", "holidays"):
            self.assertIn(resource, fake.calls)
        job_title = JobTitle.objects.get(axis_job_title_id=jt_id)
        collaborator = Collaborator.objects.get(axis_collaborator_id=collab_id)
        self.assertEqual(collaborator.job_title, job_title)
        self.assertEqual(collaborator.registration, "M-1")
        user.refresh_from_db()
        self.assertEqual(str(user.axis_user_id), user_id)
        self.assertFalse(user.is_active)
        self.assertEqual(Holiday.objects.get(axis_holiday_id=holiday_id).date, date(2026, 12, 25))
        self.assertIn("criados no Field", out.getvalue())
        self.assertEqual(AxisMasterRecord.objects.get(axis_id=holiday_id).code, "2026-12-25")
        self.assertTrue(Person.objects.filter(email="bia@lgc.test").exists())

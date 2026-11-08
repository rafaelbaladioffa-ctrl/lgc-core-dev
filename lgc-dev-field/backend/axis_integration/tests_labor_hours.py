"""`GET /api/integration/labor-hours` (PT-10): horas reais por técnico, projeto e dia para o Financeiro."""

import uuid
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from core.models import Collaborator, Company, Person
from projects.models import Project, ProjectHourEntry, ProjectTask, ProjectTaskAssignment

URL = "/api/integration/labor-hours"
KEY = "chave-de-teste"


def sp(day, hour, minute=0):
    """Instante no fuso de São Paulo (America/Sao_Paulo)."""
    return datetime(2026, 11, day, hour, minute, tzinfo=timezone.get_current_timezone())


@override_settings(FIELD_INTEGRATION_API_KEY=KEY)
class LaborHoursBase(TestCase):
    def setUp(self):
        patcher = mock.patch("core.geocoding.geocode_site_address", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.company = Company.objects.create(legal_name="LGC Teste Ltda", tax_id="00.000.000/0001-91")
        self.project = Project.objects.create(company=self.company, name="Obra A", axis_project_id=uuid.uuid4())
        self.tech_a = self.make_tech("Técnico A", axis_id=uuid.uuid4())
        self.tech_b = self.make_tech("Técnico B", axis_id=uuid.uuid4())

    def make_tech(self, name, axis_id=None):
        person = Person.objects.create(name=name, company=self.company)
        return Collaborator.objects.create(person=person, axis_collaborator_id=axis_id)

    def task(self, project=None, **kwargs):
        return ProjectTask.objects.create(project=project or self.project, custom_name="Tarefa", order=1, **kwargs)

    def assign(self, task, tech, start, end, pauses=(), adjusted=False):
        assignment = ProjectTaskAssignment.objects.create(
            project_task=task, collaborator=tech, assignment_start=start, assignment_end=end,
            pause_log=[[ps.isoformat(), pe.isoformat()] for ps, pe in pauses], is_adjusted=adjusted,
            status=ProjectTask.STATUS_COMPLETED,
        )
        intervals = assignment.working_intervals()
        assignment.actual_hours = round(sum((e - s).total_seconds() for s, e in intervals) / 3600, 2)
        assignment.save()
        return assignment

    def get(self, frm="2026-11-01", to="2026-11-30", key=KEY):
        headers = {"HTTP_X_API_KEY": key} if key is not None else {}
        return self.client.get(URL, {"from": frm, "to": to}, **headers)

    def rows(self, **kwargs):
        response = self.get(**kwargs)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()


@override_settings(FIELD_INTEGRATION_API_KEY=KEY)
class AuthAndPeriodTests(LaborHoursBase):
    def test_sem_chave_configurada_responde_503(self):
        with override_settings(FIELD_INTEGRATION_API_KEY=""):
            self.assertEqual(self.get().status_code, 503)

    def test_chave_ausente_ou_errada_responde_401(self):
        self.assertEqual(self.get(key=None).status_code, 401)
        self.assertEqual(self.get(key="outra").status_code, 401)

    def test_periodo_invalido_responde_400(self):
        self.assertEqual(self.get(frm="2026-11-30", to="2026-11-01").status_code, 400)
        self.assertEqual(self.get(frm="x", to="2026-11-01").status_code, 400)
        self.assertEqual(self.get(frm="2026-01-01", to="2026-03-31").status_code, 400)

    def test_periodo_de_62_dias_e_aceito_e_63_nao(self):
        self.assertEqual(self.get(frm="2026-09-01", to="2026-11-01").status_code, 200)
        self.assertEqual(self.get(frm="2026-09-01", to="2026-11-02").status_code, 400)

    def test_post_nao_e_permitido(self):
        self.assertEqual(self.client.post(URL, HTTP_X_API_KEY=KEY).status_code, 405)


@override_settings(FIELD_INTEGRATION_API_KEY=KEY)
class HoursTests(LaborHoursBase):
    def test_horas_do_tecnico_descontam_pausas_e_somam_no_dia(self):
        # 08:00–12:00 com pausa de 30 min = 3,50 h; 13:00–15:00 = 2,00 h no mesmo dia, em outra tarefa.
        self.assign(self.task(), self.tech_a, sp(4, 8), sp(4, 12), pauses=[(sp(4, 9), sp(4, 9, 30))])
        self.assign(self.task(), self.tech_a, sp(4, 13), sp(4, 15))
        self.assertEqual(self.rows(), [{
            "axis_project_id": str(self.project.axis_project_id),
            "axis_collaborator_id": str(self.tech_a.axis_collaborator_id),
            "date": "2026-11-04",
            "hours": "5.50",
            "adjusted": False,
        }])

    def test_cada_tecnico_da_equipe_conta_suas_horas_regra_1(self):
        task = self.task()
        self.assign(task, self.tech_a, sp(4, 8), sp(4, 10))
        self.assign(task, self.tech_b, sp(4, 8), sp(4, 10))
        rows = self.rows()
        self.assertEqual(
            sorted((r["axis_collaborator_id"], r["hours"]) for r in rows),
            sorted([(str(self.tech_a.axis_collaborator_id), "2.00"), (str(self.tech_b.axis_collaborator_id), "2.00")]),
        )
        # O total bate com o HH do projeto (real_man_hours).
        task = ProjectTask.objects.prefetch_related("assignments").get(pk=task.pk)
        self.assertEqual(sum(Decimal(r["hours"]) for r in rows), Decimal(str(task.real_man_hours)))

    def test_despacho_que_atravessa_a_meia_noite_reparte_por_dia_em_sao_paulo(self):
        # 22:00 de 4/11 até 02:00 de 5/11 (SP) = 4 h: 2 h em cada dia.
        self.assign(self.task(), self.tech_a, sp(4, 22), sp(5, 2))
        self.assertEqual([(r["date"], r["hours"]) for r in self.rows()], [("2026-11-04", "2.00"), ("2026-11-05", "2.00")])

    def test_dia_e_o_de_sao_paulo_e_nao_o_utc(self):
        # 22:30 em SP = 01:30 UTC do dia seguinte; precisa ficar no dia 4.
        start, end = sp(4, 21), sp(4, 22, 30)
        self.assertEqual(end.astimezone(dt_timezone.utc).day, 5)
        self.assign(self.task(), self.tech_a, start, end)
        self.assertEqual([r["date"] for r in self.rows()], ["2026-11-04"])

    def test_reparticao_preserva_o_total_do_despacho(self):
        # 23:00 de 4/11 até 01:00 de 6/11 = 26 h em 3 dias (1 h, 24 h, 1 h).
        self.assign(self.task(), self.tech_a, sp(4, 23), sp(6, 1))
        rows = self.rows()
        self.assertEqual([(r["date"], r["hours"]) for r in rows], [("2026-11-04", "1.00"), ("2026-11-05", "24.00"), ("2026-11-06", "1.00")])
        self.assertEqual(sum(Decimal(r["hours"]) for r in rows), Decimal("26.00"))

    def test_periodo_filtra_por_dia_e_inclui_os_dois_extremos(self):
        for day in (3, 4, 5):
            self.assign(self.task(), self.tech_a, sp(day, 8), sp(day, 9))
        self.assertEqual([r["date"] for r in self.rows(frm="2026-11-04", to="2026-11-04")], ["2026-11-04"])
        self.assertEqual(len(self.rows(frm="2026-11-03", to="2026-11-05")), 3)

    def test_adjusted_quando_houve_ajuste_de_timeline(self):
        self.assign(self.task(), self.tech_a, sp(4, 8), sp(4, 9), adjusted=True)
        self.assign(self.task(), self.tech_a, sp(4, 10), sp(4, 11))
        self.assign(self.task(), self.tech_b, sp(4, 10), sp(4, 11))
        by_collab = {r["axis_collaborator_id"]: r for r in self.rows()}
        a = by_collab[str(self.tech_a.axis_collaborator_id)]
        self.assertTrue(a["adjusted"])
        self.assertEqual(a["hours"], "2.00")
        self.assertFalse(by_collab[str(self.tech_b.axis_collaborator_id)]["adjusted"])

    def test_despacho_ainda_aberto_nao_conta(self):
        ProjectTaskAssignment.objects.create(
            project_task=self.task(), collaborator=self.tech_a, assignment_start=sp(4, 8), status=ProjectTask.STATUS_IN_PROGRESS
        )
        self.assertEqual(self.rows(), [])


@override_settings(FIELD_INTEGRATION_API_KEY=KEY)
class RulesTests(LaborHoursBase):
    def test_tarefa_com_apontamento_mas_sem_tecnico_nao_gera_hh_regra_8(self):
        self.task(actual_start=sp(4, 8), actual_end=sp(4, 12), actual_hours=Decimal("4.00"))
        self.assertEqual(self.rows(), [])

    def test_horas_de_planilha_do_supervisor_ficam_de_fora_regra_9(self):
        ProjectHourEntry.objects.create(
            project=self.project, work_date=datetime(2026, 11, 4).date(), person_name="Supervisor", total_hours=Decimal("8.00")
        )
        self.assertEqual(self.rows(), [])

    def test_tarefa_historica_sem_horas_por_tecnico_usa_o_mesmo_fallback_do_hh(self):
        # Apontamento completo da tarefa, despachos sem actual_hours: cada técnico vinculado recebe as horas de relógio.
        task = self.task(actual_start=sp(4, 8), actual_end=sp(4, 10), actual_hours=Decimal("2.00"))
        ProjectTaskAssignment.objects.create(project_task=task, collaborator=self.tech_a)
        ProjectTaskAssignment.objects.create(project_task=task, collaborator=self.tech_b)
        rows = self.rows()
        self.assertEqual(sorted(r["hours"] for r in rows), ["2.00", "2.00"])
        task = ProjectTask.objects.prefetch_related("assignments").get(pk=task.pk)
        self.assertEqual(sum(Decimal(r["hours"]) for r in rows), Decimal(str(task.real_man_hours)))

    def test_projeto_ou_colaborador_sem_vinculo_fica_fora_da_lista(self):
        loose_project = Project.objects.create(company=self.company, name="Obra sem vínculo")
        loose_tech = self.make_tech("Sem vínculo")
        self.assign(self.task(project=loose_project), self.tech_a, sp(4, 8), sp(4, 9))
        self.assign(self.task(), loose_tech, sp(4, 8), sp(4, 10))
        self.assign(self.task(), self.tech_a, sp(4, 8), sp(4, 11))
        with self.assertLogs("axis_integration.labor_hours", level="WARNING") as logs:
            response = self.get()
        rows = response.json()
        self.assertEqual([(r["axis_project_id"], r["hours"]) for r in rows], [(str(self.project.axis_project_id), "3.00")])
        self.assertIn("projeto_sem_vinculo", logs.output[0])
        self.assertIn("colaborador_sem_vinculo", logs.output[0])
        self.assertIn("projeto_sem_vinculo=1.00", response["X-Unlinked-Hours"])
        self.assertIn("colaborador_sem_vinculo=2.00", response["X-Unlinked-Hours"])

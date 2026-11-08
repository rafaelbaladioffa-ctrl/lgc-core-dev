"""Status de presença do técnico (TechnicianDailyPresence) x despachos.

Invariante coberta: o status "Em Execução" só existe enquanto o técnico tem ao
menos um despacho dele em andamento. Qualquer caminho que tire o último
despacho em andamento do técnico (desalocar, devolver ao pool, excluir a
tarefa, trocar responsáveis, ajuste do admin) precisa liberar o status — antes
ele ficava preso em "Em Execução". Também cobre as regras do dropdown: pausar
ou concluir uma tarefa não pode atropelar um status escolhido pelo técnico
(Café, Almoço, Fim de Expediente...).
"""
from datetime import datetime
from unittest.mock import patch

from django.contrib.auth.models import Permission
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Collaborator, Company, Person
from dispatch.models import TechnicianDailyPresence, TechnicianStatusEvent
from projects.models import Project, ProjectTask, ProjectTaskAssignment
from users.models import User

P = TechnicianDailyPresence


class TechnicianPresenceStatusTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Presença", status=Project.STATUS_IN_PROGRESS)
        self.task1 = ProjectTask.objects.create(project=self.project, custom_name="Tarefa 1", order=1)
        self.task2 = ProjectTask.objects.create(project=self.project, custom_name="Tarefa 2", order=2)

        self.admin = User.objects.create_superuser(username="presence_admin", email="presence_admin@example.com", password="test-password")
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)

        self.tech_a, self.client_a = self._make_technician("Técnico A")
        self.tech_b, self.client_b = self._make_technician("Técnico B")

        self._dispatch(self.task1, self.tech_a, self.tech_b)
        self._dispatch(self.task2, self.tech_a)

        self.clock = datetime(2026, 10, 5, 7, 0, tzinfo=timezone.get_current_timezone())
        patcher = patch("django.utils.timezone.now", side_effect=lambda: self.clock)
        patcher.start()
        self.addCleanup(patcher.stop)

    # --- helpers -------------------------------------------------------

    def _make_technician(self, name):
        slug = name.lower().replace(" ", "_")
        user = User.objects.create_user(username=slug, email=f"{slug}@example.com", password="test-password", company=self.company)
        for codename in ("view_mytask", "change_mytask"):
            user.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label="technical"))
        for codename in ("view_techniciandailypresence", "add_techniciandailypresence", "change_techniciandailypresence"):
            user.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label="dispatch"))
        person = Person.objects.create(name=name, company=self.company, user=user)
        collaborator = Collaborator.objects.create(person=person)
        client = APIClient()
        client.force_authenticate(user=user)
        return collaborator, client

    def _dispatch(self, task, *collaborators):
        response = self.admin_client.post(
            f"/api/project-tasks/{task.pk}/dispatch/", {"collaborator_ids": [c.pk for c in collaborators]}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)

    def _tick(self, hours=1):
        from datetime import timedelta

        self.clock = self.clock + timedelta(hours=hours)

    def _start(self, client, task):
        response = client.patch(f"/api/my-tasks/{task.pk}/", {"status": ProjectTask.STATUS_IN_PROGRESS}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def _set_own(self, client, task, status):
        response = client.patch(f"/api/my-tasks/{task.pk}/", {"status": status}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def _set_presence(self, client, status):
        response = client.post("/api/technician-presence/set-status/", {"status": status}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def _presence(self, collaborator):
        presence = TechnicianDailyPresence.objects.filter(collaborator=collaborator, date=timezone.localdate()).first()
        return presence.status if presence else None

    def _events(self, collaborator):
        return list(
            TechnicianStatusEvent.objects.filter(collaborator=collaborator, date=timezone.localdate())
            .order_by("changed_at", "id")
            .values_list("status", flat=True)
        )

    def _undispatch(self, task, *collaborators):
        return self.admin_client.post(
            f"/api/project-tasks/{task.pk}/undispatch/", {"collaborator_ids": [c.pk for c in collaborators]}, format="json"
        )

    def _return_to_pool(self, task, *collaborators):
        return self.admin_client.post(
            f"/api/project-tasks/{task.pk}/return-to-pool/", {"collaborator_ids": [c.pk for c in collaborators]}, format="json"
        )

    # --- desalocar / devolver ao pool ---------------------------------

    def test_undispatch_of_running_task_releases_in_progress_presence(self):
        self._start(self.client_a, self.task2)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_IN_PROGRESS)

        self._tick()
        self.assertEqual(self._undispatch(self.task2, self.tech_a).status_code, 200)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)
        # a execução que só existia por causa da tarefa removida é apagada do histórico (sem barra fantasma)
        self.assertEqual(self._events(self.tech_a), [P.STATUS_NOT_STARTED, P.STATUS_AVAILABLE])

    def test_undispatch_without_ids_releases_every_technician_of_the_task(self):
        self._start(self.client_a, self.task1)
        self._start(self.client_b, self.task1)

        response = self.admin_client.post(f"/api/project-tasks/{self.task1.pk}/undispatch/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)
        self.assertEqual(self._presence(self.tech_b), P.STATUS_AVAILABLE)

    def test_undispatch_of_one_technician_keeps_the_colleague_executing(self):
        self._start(self.client_a, self.task1)
        self._start(self.client_b, self.task1)

        self._undispatch(self.task1, self.tech_a)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)
        self.assertEqual(self._presence(self.tech_b), P.STATUS_IN_PROGRESS)

    def test_undispatch_keeps_executing_when_another_task_is_still_running(self):
        self._start(self.client_a, self.task1)
        self._start(self.client_a, self.task2)

        self._undispatch(self.task1, self.tech_a)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_IN_PROGRESS)
        self._undispatch(self.task2, self.tech_a)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)

    def test_undispatch_of_paused_or_queued_task_does_not_touch_other_statuses(self):
        self._start(self.client_a, self.task1)
        self._set_own(self.client_a, self.task1, ProjectTask.STATUS_PAUSED)
        self._set_presence(self.client_a, P.STATUS_LUNCH)

        self._undispatch(self.task1, self.tech_a)
        self._undispatch(self.task2, self.tech_a)  # na fila (não iniciada)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_LUNCH)

    def test_return_to_pool_releases_in_progress_presence_for_chosen_technician_only(self):
        self._start(self.client_a, self.task1)
        self._start(self.client_b, self.task1)

        self._return_to_pool(self.task1, self.tech_a)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)
        self.assertEqual(self._presence(self.tech_b), P.STATUS_IN_PROGRESS)

    def test_return_to_pool_of_everyone_releases_all(self):
        self._start(self.client_a, self.task1)
        self._start(self.client_b, self.task1)

        response = self.admin_client.post(f"/api/project-tasks/{self.task1.pk}/return-to-pool/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)
        self.assertEqual(self._presence(self.tech_b), P.STATUS_AVAILABLE)

    def test_return_to_pool_of_completed_task_does_not_change_presence(self):
        self._start(self.client_a, self.task2)
        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_COMPLETED)
        self._set_presence(self.client_a, P.STATUS_MEAL)

        self._return_to_pool(self.task2, self.tech_a)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_MEAL)

    # --- outros caminhos que removem/encerram o despacho ----------------

    def test_deleting_a_running_task_releases_presence(self):
        self._start(self.client_a, self.task2)

        response = self.admin_client.delete(f"/api/project-tasks/{self.task2.pk}/")

        self.assertIn(response.status_code, (200, 204), getattr(response, "data", None))
        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)

    def test_replacing_collaborators_releases_the_removed_technician(self):
        self._start(self.client_a, self.task2)

        self.task2.collaborators.set([self.tech_b])

        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)

    def test_admin_adjusting_technician_status_releases_presence(self):
        for status in (
            ProjectTask.STATUS_COMPLETED,
            ProjectTask.STATUS_PAUSED,
            ProjectTask.STATUS_CANCELED,
            ProjectTask.STATUS_NOT_STARTED,
        ):
            with self.subTest(status=status):
                ProjectTaskAssignment.objects.filter(project_task=self.task2).update(status=ProjectTask.STATUS_NOT_STARTED)
                TechnicianDailyPresence.objects.filter(collaborator=self.tech_a).update(status=P.STATUS_AVAILABLE)
                self._set_own(self.client_a, self.task2, ProjectTask.STATUS_IN_PROGRESS)
                self.assertEqual(self._presence(self.tech_a), P.STATUS_IN_PROGRESS)

                response = self.admin_client.post(
                    f"/api/project-tasks/{self.task2.pk}/assignment-status/",
                    {"collaborator_id": self.tech_a.pk, "status": status},
                    format="json",
                )

                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)

    def test_admin_adjusting_whole_task_status_releases_presence(self):
        self._start(self.client_a, self.task1)
        self._start(self.client_b, self.task1)

        response = self.admin_client.patch(
            f"/api/project-tasks/{self.task1.pk}/", {"status": ProjectTask.STATUS_COMPLETED}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)
        self.assertEqual(self._presence(self.tech_b), P.STATUS_AVAILABLE)

    # --- pausar / concluir não atropela o status escolhido -------------

    def test_pausing_while_on_coffee_break_keeps_the_chosen_status(self):
        # Pausar manualmente uma tarefa que já ficou "em andamento" por outro caminho
        # (ex.: ajuste do admin) com o técnico em Café não pode virar "Disponível".
        self._set_presence(self.client_a, P.STATUS_MEAL)
        ProjectTaskAssignment.objects.filter(project_task=self.task2, collaborator=self.tech_a).update(
            status=ProjectTask.STATUS_IN_PROGRESS, assignment_start=self.clock
        )

        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_PAUSED)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_MEAL)

    def test_completing_while_off_duty_keeps_off_duty(self):
        self._start(self.client_a, self.task2)
        self._set_presence(self.client_a, P.STATUS_OFF_DUTY)

        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_COMPLETED)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_OFF_DUTY)

    def test_pause_and_complete_release_when_still_executing_status(self):
        self._start(self.client_a, self.task2)
        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_PAUSED)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)

        self._start(self.client_a, self.task2)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_IN_PROGRESS)
        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_COMPLETED)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)
        self.assertEqual(
            self._events(self.tech_a),
            [P.STATUS_IN_PROGRESS, P.STATUS_AVAILABLE, P.STATUS_IN_PROGRESS, P.STATUS_AVAILABLE],
        )

    def test_pausing_one_of_two_running_tasks_keeps_executing(self):
        self._start(self.client_a, self.task1)
        self._start(self.client_a, self.task2)

        self._set_own(self.client_a, self.task1, ProjectTask.STATUS_PAUSED)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_IN_PROGRESS)

    def test_colleague_pausing_does_not_change_my_presence(self):
        self._start(self.client_a, self.task1)
        self._start(self.client_b, self.task1)

        self._set_own(self.client_b, self.task1, ProjectTask.STATUS_PAUSED)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_IN_PROGRESS)
        self.assertEqual(self._presence(self.tech_b), P.STATUS_AVAILABLE)

    # --- regras do dropdown ---------------------------------------------

    # --- escolher um status pausa as tarefas em andamento -----------------

    def _assignment_status(self, task, collaborator):
        return ProjectTaskAssignment.objects.get(project_task=task, collaborator=collaborator).status

    def test_every_selectable_status_pauses_running_tasks(self):
        for status in P.SELECTABLE_STATUSES:
            if status == P.STATUS_OFF_DUTY:
                continue
            with self.subTest(status=status):
                ProjectTaskAssignment.objects.filter(collaborator=self.tech_a).update(status=ProjectTask.STATUS_NOT_STARTED)
                self._start(self.client_a, self.task1)
                self._start(self.client_a, self.task2)

                self._set_presence(self.client_a, status)

                self.assertEqual(self._presence(self.tech_a), status)
                self.assertEqual(self._assignment_status(self.task1, self.tech_a), ProjectTask.STATUS_PAUSED)
                self.assertEqual(self._assignment_status(self.task2, self.tech_a), ProjectTask.STATUS_PAUSED)

    def test_end_of_shift_pauses_running_tasks_too(self):
        self._start(self.client_a, self.task2)

        self._set_presence(self.client_a, P.STATUS_OFF_DUTY)

        self.assertEqual(self._assignment_status(self.task2, self.tech_a), ProjectTask.STATUS_PAUSED)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_OFF_DUTY)

    def test_status_change_pauses_only_my_running_tasks(self):
        self._start(self.client_a, self.task1)
        self._start(self.client_b, self.task1)
        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_IN_PROGRESS)
        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_COMPLETED)

        self._set_presence(self.client_a, P.STATUS_MEAL)

        self.assertEqual(self._assignment_status(self.task1, self.tech_a), ProjectTask.STATUS_PAUSED)
        self.assertEqual(self._assignment_status(self.task1, self.tech_b), ProjectTask.STATUS_IN_PROGRESS)  # colega segue
        self.assertEqual(self._assignment_status(self.task2, self.tech_a), ProjectTask.STATUS_COMPLETED)  # concluída intacta
        self.assertEqual(self._presence(self.tech_b), P.STATUS_IN_PROGRESS)
        self.task1.refresh_from_db()
        self.assertEqual(self.task1.status, ProjectTask.STATUS_IN_PROGRESS)  # agregado: o colega ainda executa

    def test_paused_time_is_not_counted_and_resume_is_manual(self):
        self._start(self.client_a, self.task2)
        self._tick(2)
        self._set_presence(self.client_a, P.STATUS_LUNCH)
        paused_at = ProjectTaskAssignment.objects.get(project_task=self.task2, collaborator=self.tech_a).paused_at
        self.assertEqual(paused_at, self.clock)

        self._tick(1)
        self._set_presence(self.client_a, P.STATUS_AVAILABLE)  # voltar do almoço não retoma sozinho
        self.assertEqual(self._assignment_status(self.task2, self.tech_a), ProjectTask.STATUS_PAUSED)

        self._start(self.client_a, self.task2)
        assignment = ProjectTaskAssignment.objects.get(project_task=self.task2, collaborator=self.tech_a)
        self.assertEqual(assignment.status, ProjectTask.STATUS_IN_PROGRESS)
        self.assertEqual(assignment.paused_seconds, 3600)  # 1h de almoço descontada
        self.assertEqual(self._presence(self.tech_a), P.STATUS_IN_PROGRESS)

    def test_changing_status_without_running_tasks_changes_nothing_else(self):
        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_IN_PROGRESS)
        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_PAUSED)

        self._set_presence(self.client_a, P.STATUS_MEAL)

        self.assertEqual(self._assignment_status(self.task2, self.tech_a), ProjectTask.STATUS_PAUSED)
        self.assertEqual(self._assignment_status(self.task1, self.tech_a), ProjectTask.STATUS_NOT_STARTED)

    def test_in_progress_cannot_be_chosen_manually(self):
        response = self.client_a.post("/api/technician-presence/set-status/", {"status": P.STATUS_IN_PROGRESS}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_site_block_pauses_task_and_presence_stays_blocked_until_resume(self):
        self._start(self.client_a, self.task2)

        self._set_presence(self.client_a, P.STATUS_SITE_BLOCKED)

        self.assertEqual(self._presence(self.tech_a), P.STATUS_SITE_BLOCKED)
        self.assertEqual(ProjectTaskAssignment.objects.get(project_task=self.task2, collaborator=self.tech_a).status, ProjectTask.STATUS_PAUSED)

        self._start(self.client_a, self.task2)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_IN_PROGRESS)

    def test_starting_after_off_duty_reopens_the_day(self):
        self._set_presence(self.client_a, P.STATUS_OFF_DUTY)

        self._start(self.client_a, self.task2)

        presence = TechnicianDailyPresence.objects.get(collaborator=self.tech_a, date=timezone.localdate())
        self.assertEqual(presence.status, P.STATUS_IN_PROGRESS)
        self.assertIsNone(presence.checked_out_at)

    def test_starting_twice_is_a_noop_and_pausing_one_not_running_is_refused(self):
        self._start(self.client_a, self.task2)
        started_at = ProjectTaskAssignment.objects.get(project_task=self.task2, collaborator=self.tech_a).assignment_start
        self._tick()
        self._start(self.client_a, self.task2)  # idempotente: não reinicia o relógio
        self.assertEqual(
            ProjectTaskAssignment.objects.get(project_task=self.task2, collaborator=self.tech_a).assignment_start, started_at
        )

        response = self.client_a.patch(f"/api/my-tasks/{self.task1.pk}/", {"status": ProjectTask.STATUS_PAUSED}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_IN_PROGRESS)

    # --- autocorreção de registros já presos -----------------------------

    def test_me_endpoint_heals_a_stuck_in_progress_presence(self):
        P.objects.create(collaborator=self.tech_a, date=timezone.localdate(), status=P.STATUS_IN_PROGRESS, checked_in_at=self.clock)

        response = self.client_a.get("/api/technician-presence/me/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], P.STATUS_AVAILABLE)
        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)

    def test_me_endpoint_keeps_in_progress_when_a_task_is_really_running(self):
        self._start(self.client_a, self.task2)

        response = self.client_a.get("/api/technician-presence/me/")

        self.assertEqual(response.data["status"], P.STATUS_IN_PROGRESS)

    def test_heal_command_releases_every_stuck_presence_and_only_those(self):
        self._start(self.client_b, self.task1)  # execução legítima
        P.objects.create(collaborator=self.tech_a, date=timezone.localdate(), status=P.STATUS_IN_PROGRESS, checked_in_at=self.clock)

        call_command("heal_technician_presence")

        self.assertEqual(self._presence(self.tech_a), P.STATUS_AVAILABLE)
        self.assertEqual(self._presence(self.tech_b), P.STATUS_IN_PROGRESS)


class TimelineWorkingIntervalsTests(TestCase):
    """Timeline: a barra da tarefa tem um vão enquanto o técnico está em outro status
    (almoço, café...) e recomeça com barra nova ao voltar."""

    # Reaproveita só o cenário e os auxiliares da classe acima (sem reexecutar os testes dela).
    setUp = TechnicianPresenceStatusTests.setUp
    _make_technician = TechnicianPresenceStatusTests._make_technician
    _dispatch = TechnicianPresenceStatusTests._dispatch
    _tick = TechnicianPresenceStatusTests._tick
    _start = TechnicianPresenceStatusTests._start
    _set_own = TechnicianPresenceStatusTests._set_own
    _set_presence = TechnicianPresenceStatusTests._set_presence

    def _blocks(self, collaborator):
        from api.operations import build_timeline_data

        data = build_timeline_data(None, timezone.localdate(), user=self.admin)
        tech = next(t for t in data["technicians"] if t["id"] == collaborator.pk)
        return {b["id"]: b for b in tech["blocks"]}

    def test_lunch_splits_the_task_bar_and_return_starts_a_new_one(self):
        self._start(self.client_a, self.task2)             # 07:00
        self._tick(4)                                       # 11:00
        self._set_presence(self.client_a, P.STATUS_LUNCH)  # pausa automática
        self._tick(1)                                       # 12:00
        self._start(self.client_a, self.task2)             # volta
        self._tick(2)                                       # 14:00
        self._set_own(self.client_a, self.task2, ProjectTask.STATUS_COMPLETED)

        intervals = self._blocks(self.tech_a)[self.task2.pk]["working_intervals"]

        self.assertEqual(
            [(timezone.localtime(i["start"]).hour, timezone.localtime(i["end"]).hour) for i in intervals],
            [(7, 11), (12, 14)],
        )

    def test_open_interval_while_running_and_none_while_paused(self):
        self._start(self.client_a, self.task2)
        self._tick(1)
        running = self._blocks(self.tech_a)[self.task2.pk]["working_intervals"]
        self.assertEqual(len(running), 1)
        self.assertIsNone(running[0]["end"])

        self._set_presence(self.client_a, P.STATUS_MEAL)
        paused = self._blocks(self.tech_a)[self.task2.pk]["working_intervals"]
        self.assertEqual(len(paused), 1)
        self.assertIsNotNone(paused[0]["end"])  # fechado na hora em que pausou

    def test_assignment_without_own_tracking_has_no_intervals(self):
        ProjectTask.objects.filter(pk=self.task1.pk).update(planned_start=self.clock)  # aparece na timeline do dia
        self.assertIsNone(self._blocks(self.tech_a)[self.task1.pk]["working_intervals"])

"""Status por técnico em uma mesma tarefa (ProjectTaskAssignment.status).

Regras cobertas:
- cada técnico inicia, pausa e conclui a própria parte; o colega não é afetado;
- a tarefa só fica concluída quando todos os técnicos concluírem;
- horas são do próprio técnico (descontando as pausas dele); a duração da
  tarefa é o tempo em que ao menos um técnico esteve em execução;
- ajuste do administrador aplica status SEM apontamento de horas;
- bloqueio de site pausa só o técnico bloqueado.
"""
from datetime import datetime, timedelta
from unittest.mock import patch

from django.contrib.auth.models import Permission
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Collaborator, Company, Person
from dispatch.models import TechnicianDailyPresence, TechnicianStatusEvent
from projects.models import Project, ProjectTask, ProjectTaskAssignment
from users.models import User


class TaskAssignmentStatusTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Equipe", status=Project.STATUS_IN_PROGRESS)
        self.task = ProjectTask.objects.create(project=self.project, custom_name="Lançamento em equipe", order=1)

        self.admin = User.objects.create_superuser(username="assign_admin", email="assign_admin@example.com", password="test-password")
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)

        self.tech_a, self.client_a = self._make_technician("Técnico A")
        self.tech_b, self.client_b = self._make_technician("Técnico B")

        response = self.admin_client.post(
            f"/api/project-tasks/{self.task.pk}/dispatch/",
            {"collaborator_ids": [self.tech_a.pk, self.tech_b.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

        # Relógio controlado: o teste avança o tempo explicitamente.
        self.clock = datetime(2026, 10, 5, 9, 0, tzinfo=timezone.get_current_timezone())
        patcher = patch("django.utils.timezone.now", side_effect=lambda: self.clock)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _make_technician(self, name):
        user = User.objects.create_user(
            username=name.lower().replace(" ", "_"), email=f"{name.lower().replace(' ', '_')}@example.com",
            password="test-password", company=self.company,
        )
        for codename in ("view_mytask", "change_mytask"):
            user.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label="technical"))
        for codename in ("view_techniciandailypresence", "add_techniciandailypresence", "change_techniciandailypresence"):
            user.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label="dispatch"))
        person = Person.objects.create(name=name, company=self.company, user=user)
        collaborator = Collaborator.objects.create(person=person)
        client = APIClient()
        client.force_authenticate(user=user)
        return collaborator, client

    def _own_status(self, collaborator):
        return ProjectTaskAssignment.objects.get(project_task=self.task, collaborator=collaborator).status

    def _my_task(self, client):
        response = client.get("/api/my-tasks/")
        rows = response.data["results"] if "results" in response.data else response.data
        return next(row for row in rows if row["id"] == self.task.pk)

    def _patch_my_task(self, client, **data):
        return client.patch(f"/api/my-tasks/{self.task.pk}/", data, format="json")

    def _task(self):
        self.task.refresh_from_db()
        return self.task

    def test_start_by_one_technician_does_not_start_for_colleague(self):
        response = self._patch_my_task(self.client_a, status=ProjectTask.STATUS_IN_PROGRESS)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._own_status(self.tech_a), ProjectTask.STATUS_IN_PROGRESS)
        self.assertEqual(self._own_status(self.tech_b), ProjectTask.STATUS_NOT_STARTED)
        self.assertEqual(self._task().status, ProjectTask.STATUS_IN_PROGRESS)
        colleague_view = self._my_task(self.client_b)
        self.assertEqual(colleague_view["status"], ProjectTask.STATUS_NOT_STARTED)
        self.assertEqual(colleague_view["task_status"], ProjectTask.STATUS_IN_PROGRESS)

    def test_pause_and_complete_are_individual_and_task_closes_only_with_everyone(self):
        self._patch_my_task(self.client_a, status=ProjectTask.STATUS_IN_PROGRESS)
        self._patch_my_task(self.client_b, status=ProjectTask.STATUS_IN_PROGRESS)
        self._patch_my_task(self.client_a, status=ProjectTask.STATUS_COMPLETED, completion_outcome="completed")

        self.assertEqual(self._own_status(self.tech_a), ProjectTask.STATUS_COMPLETED)
        self.assertEqual(self._task().status, ProjectTask.STATUS_IN_PROGRESS)
        self.assertIsNone(self._task().actual_end)

        # Um concluiu e o outro pausou: a tarefa segue aberta, marcada como pausada.
        self._patch_my_task(self.client_b, status=ProjectTask.STATUS_PAUSED)
        self.assertEqual(self._own_status(self.tech_a), ProjectTask.STATUS_COMPLETED)
        self.assertEqual(self._task().status, ProjectTask.STATUS_PAUSED)

        self._patch_my_task(self.client_b, status=ProjectTask.STATUS_IN_PROGRESS)
        self._patch_my_task(self.client_b, status=ProjectTask.STATUS_COMPLETED, completion_outcome="completed")
        self.assertEqual(self._task().status, ProjectTask.STATUS_COMPLETED)
        self.assertIsNotNone(self._task().actual_end)

    def test_hours_are_per_technician_and_task_duration_is_union_without_pauses(self):
        base = self.clock
        # A: 09:00 → 11:00 (2h). B: 10:00 → 12:00 com pausa 12:00–12:30, retoma e termina 13:00 (2,5h).
        self._patch_my_task(self.client_a, status=ProjectTask.STATUS_IN_PROGRESS)
        self.clock = base + timedelta(hours=1)
        self._patch_my_task(self.client_b, status=ProjectTask.STATUS_IN_PROGRESS)
        self.clock = base + timedelta(hours=2)
        self._patch_my_task(self.client_a, status=ProjectTask.STATUS_COMPLETED, completion_outcome="completed")
        self.clock = base + timedelta(hours=3)
        self._patch_my_task(self.client_b, status=ProjectTask.STATUS_PAUSED)
        self.clock = base + timedelta(hours=3, minutes=30)
        self._patch_my_task(self.client_b, status=ProjectTask.STATUS_IN_PROGRESS)
        self.clock = base + timedelta(hours=4)
        self._patch_my_task(self.client_b, status=ProjectTask.STATUS_COMPLETED, completion_outcome="completed")

        a = ProjectTaskAssignment.objects.get(project_task=self.task, collaborator=self.tech_a)
        b = ProjectTaskAssignment.objects.get(project_task=self.task, collaborator=self.tech_b)
        self.assertEqual(float(a.actual_hours), 2.0)
        self.assertEqual(float(b.actual_hours), 2.5)
        task = self._task()
        # 09:00–11:00 ∪ 10:00–12:00 ∪ 12:30–13:00 → 09:00–12:00 + 12:30–13:00 = 3,5h
        self.assertEqual(float(task.actual_hours), 3.5)
        self.assertEqual(float(task.real_man_hours), 4.5)
        self.assertEqual(task.actual_start, base)
        self.assertEqual(task.actual_end, base + timedelta(hours=4))

    def test_admin_status_applies_to_everyone_without_hours(self):
        response = self.admin_client.patch(
            f"/api/project-tasks/{self.task.pk}/", {"status": ProjectTask.STATUS_COMPLETED}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._task().status, ProjectTask.STATUS_COMPLETED)
        for collaborator in (self.tech_a, self.tech_b):
            assignment = ProjectTaskAssignment.objects.get(project_task=self.task, collaborator=collaborator)
            self.assertEqual(assignment.status, ProjectTask.STATUS_COMPLETED)
            self.assertIsNone(assignment.assignment_end)
            self.assertIsNone(assignment.actual_hours)

    def test_admin_can_set_status_of_one_technician(self):
        response = self.admin_client.post(
            f"/api/project-tasks/{self.task.pk}/assignment-status/",
            {"collaborator_id": self.tech_b.pk, "status": ProjectTask.STATUS_COMPLETED, "completion_outcome": "partial"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._own_status(self.tech_a), ProjectTask.STATUS_NOT_STARTED)
        assignment_b = ProjectTaskAssignment.objects.get(project_task=self.task, collaborator=self.tech_b)
        self.assertEqual(assignment_b.status, ProjectTask.STATUS_COMPLETED)
        self.assertEqual(assignment_b.completion_outcome, "partial")
        self.assertIsNone(assignment_b.assignment_end)
        self.assertEqual(self._task().status, ProjectTask.STATUS_IN_PROGRESS)
        self.assertEqual(self._task().completion_outcome, "partial")

    def test_admin_per_technician_status_rejects_unknown_technician(self):
        outsider, _ = self._make_technician("Técnico Fora")

        response = self.admin_client.post(
            f"/api/project-tasks/{self.task.pk}/assignment-status/",
            {"collaborator_id": outsider.pk, "status": ProjectTask.STATUS_COMPLETED},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    def test_undispatch_recomputes_task_status_from_remaining_technicians(self):
        self._patch_my_task(self.client_a, status=ProjectTask.STATUS_IN_PROGRESS)
        self._patch_my_task(self.client_a, status=ProjectTask.STATUS_COMPLETED, completion_outcome="completed")
        self.assertEqual(self._task().status, ProjectTask.STATUS_IN_PROGRESS)

        response = self.admin_client.post(
            f"/api/project-tasks/{self.task.pk}/undispatch/", {"collaborator_ids": [self.tech_b.pk]}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._task().status, ProjectTask.STATUS_COMPLETED)

    def test_cannot_complete_a_task_that_was_not_started(self):
        response = self._patch_my_task(self.client_a, status=ProjectTask.STATUS_COMPLETED)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._own_status(self.tech_a), ProjectTask.STATUS_NOT_STARTED)

    def test_presence_follows_only_the_technicians_own_work(self):
        self._patch_my_task(self.client_a, status=ProjectTask.STATUS_IN_PROGRESS)

        presence_a = TechnicianDailyPresence.objects.get(collaborator=self.tech_a, date=timezone.localdate())
        self.assertEqual(presence_a.status, TechnicianDailyPresence.STATUS_IN_PROGRESS)
        presence_b = TechnicianDailyPresence.objects.filter(collaborator=self.tech_b, date=timezone.localdate()).first()
        self.assertFalse(presence_b and presence_b.status == TechnicianDailyPresence.STATUS_IN_PROGRESS)

    def test_status_since_is_when_the_current_status_started_not_the_checkin(self):
        P = TechnicianDailyPresence
        day = timezone.localdate()

        def at(hour, minute=0):
            return timezone.make_aware(datetime(day.year, day.month, day.day, hour, minute))

        presence = P.objects.create(collaborator=self.tech_a, date=day, status=P.STATUS_IN_PROGRESS, checked_in_at=at(7))
        # Execução de verdade: sem despacho em andamento a presença seria curada ao abrir o app.
        ProjectTaskAssignment.objects.filter(project_task=self.task, collaborator=self.tech_a).update(
            status=ProjectTask.STATUS_IN_PROGRESS, assignment_start=at(7)
        )
        for status, when in (
            (P.STATUS_IN_PROGRESS, at(7)),
            (P.STATUS_MEAL, at(9)),
            (P.STATUS_IN_PROGRESS, at(9, 30)),
            (P.STATUS_IN_PROGRESS, at(10)),  # reselecionar o mesmo status não reinicia o horário
        ):
            TechnicianStatusEvent.objects.create(collaborator=self.tech_a, date=day, status=status, changed_at=when)

        response = self.client_a.get("/api/technician-presence/me/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status_since"], at(9, 30))
        self.assertEqual(presence.checked_in_at, at(7))

    def test_site_block_pauses_only_the_blocked_technician(self):
        self._patch_my_task(self.client_a, status=ProjectTask.STATUS_IN_PROGRESS)
        self._patch_my_task(self.client_b, status=ProjectTask.STATUS_IN_PROGRESS)

        response = self.client_a.post(
            "/api/technician-presence/set-status/", {"status": TechnicianDailyPresence.STATUS_SITE_BLOCKED}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._own_status(self.tech_a), ProjectTask.STATUS_PAUSED)
        self.assertEqual(self._own_status(self.tech_b), ProjectTask.STATUS_IN_PROGRESS)
        self.assertEqual(self._task().status, ProjectTask.STATUS_IN_PROGRESS)

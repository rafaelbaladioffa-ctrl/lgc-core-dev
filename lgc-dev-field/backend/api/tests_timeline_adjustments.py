"""Ajustes administrativos da timeline: horas válidas, só superusuário, motivo obrigatório,
histórico e marca de "ajustado" (dispatch.adjustments)."""
from datetime import datetime, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.reports import presence_durations
from core.models import Collaborator, Company, Person
from dispatch.models import TechnicianDailyPresence, TechnicianStatusEvent, TimelineAdjustment
from projects.models import Project, ProjectTask, ProjectTaskAssignment
from users.models import User

P = TechnicianDailyPresence


class TimelineAdjustmentTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Ajuste", status=Project.STATUS_IN_PROGRESS)
        self.task = ProjectTask.objects.create(project=self.project, custom_name="Esqueceu de iniciar", order=1)
        user = User.objects.create_user(username="tech_adj", email="tech_adj@example.com", password="x", company=self.company)
        self.tech = Collaborator.objects.create(person=Person.objects.create(name="Técnico Ajuste", company=self.company, user=user))
        self.admin = User.objects.create_superuser(username="adj_admin", email="adj_admin@example.com", password="x")
        self.client_admin = APIClient()
        self.client_admin.force_authenticate(user=self.admin)
        self.client_user = APIClient()
        self.client_user.force_authenticate(user=user)
        self.day = timezone.localdate() - timedelta(days=3)

    def at(self, hour, minute=0):
        return timezone.make_aware(datetime(self.day.year, self.day.month, self.day.day, hour, minute))

    def iso(self, hour, minute=0):
        return self.at(hour, minute).isoformat()

    def add_event(self, status, hour, minute=0):
        return TechnicianStatusEvent.objects.create(
            collaborator=self.tech, date=self.day, status=status, changed_at=self.at(hour, minute)
        )

    def hours_by_status(self):
        per_day, _ = presence_durations([self.tech.pk], self.day, self.day, timezone.now())
        return {status: round(hours, 2) for status, hours in per_day.get((self.tech.pk, self.day), {}).items()}

    def post(self, path, payload, client=None):
        return (client or self.client_admin).post(f"/api/operations/adjustments/{path}/", payload, format="json")

    # --- status esquecido (almoço) ----------------------------------------

    def test_status_window_fixes_a_lunch_left_open_for_hours(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        self.add_event(P.STATUS_LUNCH, 11, 44)
        self.add_event(P.STATUS_OFF_DUTY, 16, 21)
        self.assertEqual(self.hours_by_status()[P.STATUS_LUNCH], 4.62)  # ficou "no almoço" até o fim do dia

        response = self.post(
            "status-window",
            {"collaborator_id": self.tech.pk, "start": self.iso(12, 44), "end": self.iso(16, 21), "status": P.STATUS_AVAILABLE, "reason": "Esqueceu de sair do almoço"},
        )

        self.assertEqual(response.status_code, 200, response.data)
        durations = self.hours_by_status()
        self.assertEqual(durations[P.STATUS_LUNCH], 1.0)  # 11:44–12:44
        self.assertEqual(durations[P.STATUS_AVAILABLE], 7.35)  # 8:00–11:44 + 12:44–16:21
        adjusted = TechnicianStatusEvent.objects.get(collaborator=self.tech, changed_at=self.at(12, 44))
        self.assertTrue(adjusted.is_adjusted)
        self.assertEqual(adjusted.status, P.STATUS_AVAILABLE)
        log = TimelineAdjustment.objects.get()
        self.assertEqual(log.reason, "Esqueceu de sair do almoço")
        self.assertEqual(log.user, self.admin)
        self.assertEqual(len(log.before["events"]), 3)
        presence = P.objects.get(collaborator=self.tech, date=self.day)
        self.assertEqual(presence.status, P.STATUS_OFF_DUTY)
        self.assertEqual(presence.checked_out_at, self.at(16, 21))

    def test_status_window_overrides_events_inside_and_restores_after(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        self.add_event(P.STATUS_MEAL, 9, 30)
        self.add_event(P.STATUS_LUNCH, 10)
        self.add_event(P.STATUS_OFF_DUTY, 15)

        self.post(
            "status-window",
            {"collaborator_id": self.tech.pk, "start": self.iso(9), "end": self.iso(10, 30), "status": P.STATUS_IN_PROGRESS, "reason": "Executou nesse horário"},
        )

        events = list(TechnicianStatusEvent.objects.filter(collaborator=self.tech).order_by("changed_at").values_list("status", "changed_at"))
        self.assertEqual(
            [(s, timezone.localtime(t).strftime("%H:%M")) for s, t in events],
            [(P.STATUS_AVAILABLE, "08:00"), (P.STATUS_IN_PROGRESS, "09:00"), (P.STATUS_LUNCH, "10:30"), (P.STATUS_OFF_DUTY, "15:00")],
        )

    # --- editor da lista de status do dia ----------------------------------

    def post_events(self, events, reason="Corrigindo o dia", client=None):
        payload = {
            "collaborator_id": self.tech.pk,
            "date": str(self.day),
            "events": [{"status": s, "changed_at": self.iso(h, m)} for s, h, m in events],
            "reason": reason,
        }
        return (client or self.client_admin).post("/api/operations/adjustments/status-events/", payload, format="json")

    def test_editor_changes_an_existing_status_instead_of_only_adding(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        lunch = self.add_event(P.STATUS_LUNCH, 11, 44)
        self.add_event(P.STATUS_OFF_DUTY, 16, 21)

        # o almoço na verdade terminou 12:44 → vira "Disponível" até o fim; o almoço (11:44) segue igual
        response = self.post_events(
            [(P.STATUS_AVAILABLE, 8, 0), (P.STATUS_LUNCH, 11, 44), (P.STATUS_AVAILABLE, 12, 44), (P.STATUS_OFF_DUTY, 16, 21)]
        )

        self.assertEqual(response.status_code, 200, response.data)
        events = list(TechnicianStatusEvent.objects.filter(collaborator=self.tech).order_by("changed_at"))
        self.assertEqual(len(events), 4)
        self.assertEqual(events[1].pk, lunch.pk)         # registro original mantido
        self.assertFalse(events[1].is_adjusted)
        self.assertTrue(events[2].is_adjusted)            # o novo entra marcado
        self.assertEqual(self.hours_by_status()[P.STATUS_LUNCH], 1.0)

    def test_editor_edits_time_and_type_of_a_registered_status_and_can_delete(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        lunch = self.add_event(P.STATUS_LUNCH, 11, 44)
        wrong = self.add_event(P.STATUS_MEETING, 13)
        self.add_event(P.STATUS_OFF_DUTY, 16)

        # troca o tipo e o horário do almoço e exclui o status errado (reunião 13:00)
        response = self.post_events([(P.STATUS_AVAILABLE, 8, 0), (P.STATUS_MEAL, 12, 0), (P.STATUS_OFF_DUTY, 16, 0)])

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(TechnicianStatusEvent.objects.filter(pk__in=[lunch.pk, wrong.pk]).exists())
        durations = self.hours_by_status()
        self.assertEqual(durations[P.STATUS_MEAL], 4.0)
        self.assertNotIn(P.STATUS_MEETING, durations)
        log = TimelineAdjustment.objects.get()
        self.assertEqual(len(log.before["events"]), 4)
        self.assertEqual(len(log.after["events"]), 3)
        presence = P.objects.get(collaborator=self.tech, date=self.day)
        self.assertEqual(presence.status, P.STATUS_OFF_DUTY)

    def test_editor_can_register_a_status_for_a_day_without_records(self):
        response = self.post_events([(P.STATUS_AVAILABLE, 8, 0), (P.STATUS_LUNCH, 12, 0), (P.STATUS_OFF_DUTY, 17, 0)])

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.hours_by_status()[P.STATUS_LUNCH], 5.0)
        self.assertEqual(TechnicianStatusEvent.objects.filter(collaborator=self.tech, is_adjusted=True).count(), 3)

    def test_editor_validations(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        self.assertEqual(self.post_events([]).status_code, 400)
        self.assertEqual(self.post_events([(P.STATUS_AVAILABLE, 8, 0)], reason=" ").status_code, 400)
        self.assertEqual(self.post_events([(P.STATUS_AVAILABLE, 8, 0), (P.STATUS_LUNCH, 8, 0)]).status_code, 400)
        self.assertEqual(self.post_events([("inexistente", 8, 0)]).status_code, 400)
        other_day = self.client_admin.post(
            "/api/operations/adjustments/status-events/",
            {"collaborator_id": self.tech.pk, "date": str(self.day), "reason": "motivo ok",
             "events": [{"status": P.STATUS_AVAILABLE, "changed_at": (self.at(8) + timedelta(days=1)).isoformat()}]},
            format="json",
        )
        self.assertEqual(other_day.status_code, 400)
        future = self.client_admin.post(
            "/api/operations/adjustments/status-events/",
            {"collaborator_id": self.tech.pk, "date": str(timezone.localdate()), "reason": "motivo ok",
             "events": [{"status": P.STATUS_AVAILABLE, "changed_at": (timezone.now() + timedelta(hours=2)).isoformat()}]},
            format="json",
        )
        self.assertEqual(future.status_code, 400)
        self.assertEqual(TimelineAdjustment.objects.count(), 0)
        self.assertEqual(TechnicianStatusEvent.objects.filter(collaborator=self.tech).count(), 1)  # nada foi alterado

    def test_editor_get_lists_the_days_events_and_is_admin_only(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        self.add_event(P.STATUS_LUNCH, 12)

        url = f"/api/operations/adjustments/status-events/?collaborator={self.tech.pk}&date={self.day}"
        rows = self.client_admin.get(url)
        self.assertEqual([r["status"] for r in rows.data], [P.STATUS_AVAILABLE, P.STATUS_LUNCH])
        self.assertEqual(self.client_user.get(url).status_code, 403)
        self.assertEqual(self.post_events([(P.STATUS_AVAILABLE, 8, 0)], client=self.client_user).status_code, 403)

    # --- atividade executada sem iniciar --------------------------------

    def test_execution_registered_by_admin_counts_as_real_hours(self):
        ProjectTaskAssignment.objects.create(project_task=self.task, collaborator=self.tech)
        self.add_event(P.STATUS_AVAILABLE, 8)
        self.add_event(P.STATUS_OFF_DUTY, 17)

        response = self.post(
            "execution",
            {
                "collaborator_id": self.tech.pk, "task_id": self.task.pk,
                "start": self.iso(9), "end": self.iso(11),
                "pauses": [{"start": self.iso(10), "end": self.iso(10, 15)}],
                "reason": "Executou e esqueceu de iniciar",
            },
        )

        self.assertEqual(response.status_code, 200, response.data)
        assignment = ProjectTaskAssignment.objects.get(project_task=self.task, collaborator=self.tech)
        self.assertEqual(assignment.status, ProjectTask.STATUS_COMPLETED)
        self.assertEqual(float(assignment.actual_hours), 1.75)
        self.assertTrue(assignment.is_adjusted)
        self.assertEqual(assignment.paused_seconds, 900)
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, ProjectTask.STATUS_COMPLETED)
        self.assertEqual(float(self.task.actual_hours), 1.75)
        # as horas também viram "Em Execução" na presença — de onde saem as horas produtivas
        self.assertEqual(self.hours_by_status()[P.STATUS_IN_PROGRESS], 1.75)
        self.assertTrue(TimelineAdjustment.objects.filter(kind=TimelineAdjustment.KIND_EXECUTION).exists())

    def test_execution_on_a_task_not_dispatched_creates_the_assignment(self):
        response = self.post(
            "execution",
            {"collaborator_id": self.tech.pk, "task_id": self.task.pk, "start": self.iso(9), "end": self.iso(10), "reason": "Sem despacho no sistema"},
        )

        self.assertEqual(response.status_code, 200, response.data)
        assignment = ProjectTaskAssignment.objects.get(project_task=self.task, collaborator=self.tech)
        self.assertEqual(float(assignment.actual_hours), 1.0)
        self.assertEqual(assignment.dispatched_by, self.admin)

    def test_execution_replaces_a_previous_wrong_record(self):
        ProjectTaskAssignment.objects.create(
            project_task=self.task, collaborator=self.tech, status=ProjectTask.STATUS_COMPLETED,
            assignment_start=self.at(9), assignment_end=self.at(9, 10), actual_hours=0.17,
        )

        self.post(
            "execution",
            {"collaborator_id": self.tech.pk, "task_id": self.task.pk, "start": self.iso(9), "end": self.iso(12), "reason": "Corrigindo fim"},
        )

        assignment = ProjectTaskAssignment.objects.get(project_task=self.task, collaborator=self.tech)
        self.assertEqual(float(assignment.actual_hours), 3.0)
        log = TimelineAdjustment.objects.get()
        self.assertEqual(log.before["assignment"]["actual_hours"], "0.17")

    # --- regras: só admin, motivo, validações ----------------------------

    def test_only_superuser_can_adjust(self):
        payload = {"collaborator_id": self.tech.pk, "start": self.iso(9), "end": self.iso(10), "status": P.STATUS_LUNCH, "reason": "x"}
        self.assertEqual(self.post("status-window", payload, client=self.client_user).status_code, 403)
        self.assertEqual(self.post("execution", {**payload, "task_id": self.task.pk}, client=self.client_user).status_code, 403)
        self.assertEqual(self.client_user.get("/api/operations/adjustments/").status_code, 403)
        self.assertEqual(TimelineAdjustment.objects.count(), 0)

    def test_reason_is_required_and_invalid_windows_are_refused(self):
        base = {"collaborator_id": self.tech.pk, "status": P.STATUS_LUNCH, "start": self.iso(9), "end": self.iso(10)}
        self.assertEqual(self.post("status-window", {**base, "reason": "  "}).status_code, 400)
        self.assertEqual(self.post("status-window", {**base, "reason": "ok motivo", "end": self.iso(8)}).status_code, 400)
        future = (timezone.now() + timedelta(days=1)).isoformat()
        self.assertEqual(self.post("status-window", {**base, "reason": "ok motivo", "start": self.iso(9), "end": future}).status_code, 400)
        self.assertEqual(self.post("status-window", {**base, "reason": "ok motivo", "status": "inexistente"}).status_code, 400)
        two_days = {**base, "reason": "ok motivo", "end": (self.at(9) + timedelta(days=1)).isoformat()}
        self.assertEqual(self.post("status-window", two_days).status_code, 400)
        self.assertEqual(TimelineAdjustment.objects.count(), 0)

    def test_execution_pauses_must_be_inside_and_not_overlap(self):
        base = {"collaborator_id": self.tech.pk, "task_id": self.task.pk, "start": self.iso(9), "end": self.iso(12), "reason": "motivo ok"}
        outside = {**base, "pauses": [{"start": self.iso(8), "end": self.iso(9, 30)}]}
        overlap = {**base, "pauses": [{"start": self.iso(10), "end": self.iso(11)}, {"start": self.iso(10, 30), "end": self.iso(11, 30)}]}
        self.assertEqual(self.post("execution", outside).status_code, 400)
        self.assertEqual(self.post("execution", overlap).status_code, 400)
        self.assertFalse(ProjectTaskAssignment.objects.filter(project_task=self.task, collaborator=self.tech, is_adjusted=True).exists())

    def test_history_and_task_list_for_the_adjust_form(self):
        ProjectTaskAssignment.objects.create(project_task=self.task, collaborator=self.tech)
        self.post(
            "status-window",
            {"collaborator_id": self.tech.pk, "start": self.iso(9), "end": self.iso(10), "status": P.STATUS_LUNCH, "reason": "Almoço não registrado"},
        )

        history = self.client_admin.get(f"/api/operations/adjustments/?collaborator={self.tech.pk}&date={self.day}")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.data[0]["reason"], "Almoço não registrado")
        self.assertEqual(history.data[0]["user"], "adj_admin")
        tasks = self.client_admin.get(f"/api/operations/adjustments/tasks/?collaborator={self.tech.pk}&date={self.day}")
        self.assertEqual([t["task_id"] for t in tasks.data], [self.task.pk])

    def test_timeline_marks_adjusted_blocks_and_events(self):
        from api.operations import build_timeline_data

        self.post(
            "execution",
            {"collaborator_id": self.tech.pk, "task_id": self.task.pk, "start": self.iso(9), "end": self.iso(10), "reason": "Sem apontamento"},
        )
        data = build_timeline_data(None, self.day, user=self.admin)
        tech = next(t for t in data["technicians"] if t["id"] == self.tech.pk)
        self.assertTrue(tech["blocks"][0]["adjusted"])
        self.assertTrue(any(e["adjusted"] for e in tech["status_events"]))


class ErasedBarsTests(TestCase):
    """Excluir um status ou uma tarefa apaga a barra (e as horas) da timeline."""

    # Reaproveita só o cenário e os auxiliares da classe acima (sem reexecutar os testes dela).
    setUp = TimelineAdjustmentTests.setUp
    at = TimelineAdjustmentTests.at
    iso = TimelineAdjustmentTests.iso
    add_event = TimelineAdjustmentTests.add_event
    hours_by_status = TimelineAdjustmentTests.hours_by_status
    post = TimelineAdjustmentTests.post

    def make_execution(self, task, start_h, end_h):
        response = self.post(
            "execution",
            {"collaborator_id": self.tech.pk, "task_id": task.pk, "start": self.iso(start_h), "end": self.iso(end_h), "reason": "Apontamento de teste"},
        )
        self.assertEqual(response.status_code, 200, response.data)

    def second_task(self):
        return ProjectTask.objects.create(project=self.project, custom_name="Segunda tarefa", order=2)

    def test_removing_the_task_from_the_technician_erases_the_execution_bar_and_hours(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        self.add_event(P.STATUS_OFF_DUTY, 17)
        self.make_execution(self.task, 9, 11)
        self.assertEqual(self.hours_by_status()[P.STATUS_IN_PROGRESS], 2.0)

        response = self.client_admin.post(f"/api/project-tasks/{self.task.pk}/undispatch/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn(P.STATUS_IN_PROGRESS, self.hours_by_status())
        statuses = list(TechnicianStatusEvent.objects.filter(collaborator=self.tech).order_by("changed_at").values_list("status", flat=True))
        self.assertNotIn(P.STATUS_IN_PROGRESS, statuses)

    def test_removing_one_of_two_overlapping_tasks_keeps_the_other_ones_time(self):
        other = self.second_task()
        self.add_event(P.STATUS_AVAILABLE, 8)
        self.add_event(P.STATUS_OFF_DUTY, 17)
        self.make_execution(self.task, 9, 11)
        self.make_execution(other, 10, 12)  # 10–11 em paralelo; presença em execução 9–12 = 3h

        self.client_admin.post(f"/api/project-tasks/{self.task.pk}/undispatch/", {}, format="json")

        self.assertEqual(self.hours_by_status()[P.STATUS_IN_PROGRESS], 2.0)  # só 10–12 da tarefa que ficou

    def test_remove_execution_endpoint_resets_the_record_and_erases_the_bar(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        self.add_event(P.STATUS_OFF_DUTY, 17)
        self.make_execution(self.task, 9, 11)

        response = self.post("execution/remove", {"collaborator_id": self.tech.pk, "task_id": self.task.pk, "reason": "Lançado por engano"})

        self.assertEqual(response.status_code, 200, response.data)
        assignment = ProjectTaskAssignment.objects.get(project_task=self.task, collaborator=self.tech)
        self.assertEqual(assignment.status, ProjectTask.STATUS_NOT_STARTED)  # continua despachada, pendente
        self.assertIsNone(assignment.assignment_start)
        self.assertIsNone(assignment.actual_hours)
        self.assertFalse(assignment.is_adjusted)
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, ProjectTask.STATUS_NOT_STARTED)
        self.assertNotIn(P.STATUS_IN_PROGRESS, self.hours_by_status())
        log = TimelineAdjustment.objects.latest("created_at")
        self.assertEqual(log.reason, "Lançado por engano")
        self.assertTrue(log.after["removed"])

    def test_remove_execution_needs_admin_a_reason_and_an_existing_record(self):
        payload = {"collaborator_id": self.tech.pk, "task_id": self.task.pk, "reason": "motivo ok"}
        self.assertEqual(self.post("execution/remove", payload, client=self.client_user).status_code, 403)
        self.assertEqual(self.post("execution/remove", payload).status_code, 400)  # sem apontamento
        self.make_execution(self.task, 9, 10)
        self.assertEqual(self.post("execution/remove", {**payload, "reason": " "}).status_code, 400)

    def test_deleting_a_status_in_the_editor_blanks_its_bar_instead_of_extending_the_previous(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        in_progress = self.add_event(P.STATUS_IN_PROGRESS, 9)
        self.add_event(P.STATUS_OFF_DUTY, 17)

        response = self.client_admin.post(
            "/api/operations/adjustments/status-events/",
            {
                "collaborator_id": self.tech.pk, "date": str(self.day), "reason": "Status errado",
                "events": [{"status": P.STATUS_AVAILABLE, "changed_at": self.iso(8)}, {"status": P.STATUS_OFF_DUTY, "changed_at": self.iso(17)}],
                "deleted": [in_progress.changed_at.isoformat()],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        durations = self.hours_by_status()
        self.assertEqual(durations[P.STATUS_AVAILABLE], 1.0)  # só 8–9: o trecho 9–17 ficou em branco
        self.assertNotIn(P.STATUS_IN_PROGRESS, durations)
        marker = TechnicianStatusEvent.objects.get(collaborator=self.tech, changed_at=self.at(9))
        self.assertEqual(marker.status, P.STATUS_NOT_STARTED)

    def test_editing_a_status_time_does_not_blank_anything(self):
        self.add_event(P.STATUS_AVAILABLE, 8)
        self.add_event(P.STATUS_LUNCH, 11)
        self.add_event(P.STATUS_OFF_DUTY, 17)

        response = self.client_admin.post(
            "/api/operations/adjustments/status-events/",
            {
                "collaborator_id": self.tech.pk, "date": str(self.day), "reason": "Almoço foi às 12",
                "events": [
                    {"status": P.STATUS_AVAILABLE, "changed_at": self.iso(8)},
                    {"status": P.STATUS_LUNCH, "changed_at": self.iso(12)},
                    {"status": P.STATUS_OFF_DUTY, "changed_at": self.iso(17)},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        durations = self.hours_by_status()
        self.assertEqual(durations[P.STATUS_AVAILABLE], 4.0)
        self.assertEqual(durations[P.STATUS_LUNCH], 5.0)
        self.assertFalse(TechnicianStatusEvent.objects.filter(collaborator=self.tech, status=P.STATUS_NOT_STARTED).exists())

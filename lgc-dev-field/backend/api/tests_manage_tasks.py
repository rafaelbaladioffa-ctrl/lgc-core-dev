from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.operations import build_board_data
from core.models import Client, Collaborator, Company, JobTitle, Person, Responsible, Site, Task
from projects.models import Project, ProjectTask, ProjectTaskAssignment

User = get_user_model()


class ManageProjectTasksPermissionTests(TestCase):
    """Permissão 'projects.manage_project_tasks': gestor despacha e ajusta tarefas dos projetos em que é
    Responsável CSTR, só com técnicos da própria equipe, sem poder criar/excluir tarefas."""

    def setUp(self):
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        title = JobTitle.objects.create(company=company, name="Supervisor de Infraestrutura de Redes")
        client = Client.objects.create(company=company, legal_name="Cliente")
        site = Site.objects.create(client=client, name="GRU65", code="GRU65")

        supervisor_person = Person.objects.create(name="SUPER", company=company)
        self.user = User.objects.create_user(username="super", email="s@x.com", password="x")
        supervisor_person.user = self.user
        supervisor_person.save(update_fields=["user"])
        self.supervisor = Collaborator.objects.create(person=supervisor_person, job_title=title)
        self.member = Collaborator.objects.create(person=Person.objects.create(name="TEC TIME", company=company), manager=self.supervisor)
        self.outsider = Collaborator.objects.create(person=Person.objects.create(name="TEC FORA", company=company))

        other_person = Person.objects.create(name="OUTRO RESP", company=company)
        mine_resp = Responsible.objects.create(person=supervisor_person, kind=Responsible.KIND_CSTR)
        other_resp = Responsible.objects.create(person=other_person, kind=Responsible.KIND_CSTR)
        self.mine = Project.objects.create(
            company=company, client=client, site=site, name="Meu", status=Project.STATUS_IN_PROGRESS, responsible_cstr=mine_resp
        )
        self.other = Project.objects.create(
            company=company, client=client, site=site, name="Dele", status=Project.STATUS_IN_PROGRESS, responsible_cstr=other_resp
        )
        catalog = Task.objects.create(name="Tarefa")
        self.mine_task = ProjectTask.objects.create(project=self.mine, task=catalog, order=1, status=ProjectTask.STATUS_NOT_STARTED)
        self.other_task = ProjectTask.objects.create(project=self.other, task=catalog, order=1, status=ProjectTask.STATUS_NOT_STARTED)

        for codename in ("view_project", "view_projecttask", "view_projecttaskassignment", "manage_project_tasks"):
            self.user.user_permissions.add(Permission.objects.get(content_type__app_label="projects", codename=codename))
        self.api = APIClient()
        self.api.force_authenticate(User.objects.get(pk=self.user.pk))

    def test_dispatch_to_team_member_works_and_reflects_on_board(self):
        response = self.api.post(f"/api/project-tasks/{self.mine_task.pk}/dispatch/", {"collaborator_ids": [self.member.pk]}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(ProjectTaskAssignment.objects.filter(project_task=self.mine_task, collaborator=self.member).exists())

        # a tarefa precisa de início no dia para entrar no pool; a fila do técnico já reflete o despacho
        board = build_board_data(None, user=User.objects.get(pk=self.user.pk))
        member_row = next(t for t in board["technicians"] if t["id"] == self.member.pk)
        self.assertEqual({q["task_id"] for q in member_row["queue"]}, {self.mine_task.pk})

    def test_cannot_dispatch_to_technician_outside_team(self):
        response = self.api.post(f"/api/project-tasks/{self.mine_task.pk}/dispatch/", {"collaborator_ids": [self.outsider.pk]}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(ProjectTaskAssignment.objects.filter(project_task=self.mine_task).exists())

    def test_cannot_touch_tasks_of_projects_owned_by_someone_else(self):
        response = self.api.post(f"/api/project-tasks/{self.other_task.pk}/dispatch/", {"collaborator_ids": [self.member.pk]}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.api.patch(f"/api/project-tasks/{self.other_task.pk}/", {"status": "paused"}, format="json").status_code, 404)

    def test_can_change_status_and_dates_of_own_task_and_pool_shows_it(self):
        today = timezone.localdate()
        start = timezone.make_aware(datetime.combine(today, datetime.min.time())) + timedelta(hours=8)
        response = self.api.patch(
            f"/api/project-tasks/{self.mine_task.pk}/",
            {"planned_start": start.isoformat(), "planned_end": (start + timedelta(hours=4)).isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        board = build_board_data(None, user=User.objects.get(pk=self.user.pk))
        self.assertIn(self.mine_task.pk, {t["id"] for t in board["pool"]})

    def test_bulk_update_allowed_but_bulk_delete_and_outside_team_are_not(self):
        url = f"/api/projects/{self.mine.pk}/tasks/bulk/"
        today = timezone.localdate()
        start = (timezone.make_aware(datetime.combine(today, datetime.min.time())) + timedelta(hours=8)).isoformat()

        ok = self.api.post(
            url,
            {"action": "update", "task_ids": [self.mine_task.pk], "planned_start": start, "collaborator_ids": [self.member.pk]},
            format="json",
        )
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertTrue(ProjectTaskAssignment.objects.filter(project_task=self.mine_task, collaborator=self.member).exists())

        outside = self.api.post(url, {"action": "update", "task_ids": [self.mine_task.pk], "collaborator_ids": [self.outsider.pk]}, format="json")
        self.assertEqual(outside.status_code, 403)
        delete = self.api.post(url, {"action": "delete", "task_ids": [self.mine_task.pk]}, format="json")
        self.assertEqual(delete.status_code, 403)
        self.assertTrue(ProjectTask.objects.filter(pk=self.mine_task.pk).exists())

    def test_without_the_permission_dispatch_is_still_denied(self):
        plain = User.objects.create_user(username="plain", email="p@x.com", password="x")
        plain.user_permissions.add(
            Permission.objects.get(content_type__app_label="projects", codename="change_projecttask"),
            Permission.objects.get(content_type__app_label="projects", codename="view_projecttask"),
        )
        api = APIClient()
        api.force_authenticate(User.objects.get(pk=plain.pk))
        response = api.post(f"/api/project-tasks/{self.mine_task.pk}/dispatch/", {"collaborator_ids": [self.member.pk]}, format="json")
        self.assertEqual(response.status_code, 403)

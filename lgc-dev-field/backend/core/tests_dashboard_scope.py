from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from core.models import Client, Collaborator, Company, JobTitle, Person, Responsible, Site
from projects.analytics import build_projects_performance
from projects.models import Project

User = get_user_model()


class DashboardProjectsScopeTests(TestCase):
    """Dashboard de projetos: supervisor só enxerga os projetos em que é Responsável CSTR."""

    def setUp(self):
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        title = JobTitle.objects.create(company=company, name="Supervisor de Infraestrutura de Redes")
        client = Client.objects.create(company=company, legal_name="Cliente")
        site = Site.objects.create(client=client, name="GRU65", code="GRU65")

        def collaborator(name, with_user=False):
            person = Person.objects.create(name=name, company=company)
            if with_user:
                person.user = User.objects.create_user(username=name.lower(), email=f"{name}@x.com", password="x")
                person.save(update_fields=["user"])
            return Collaborator.objects.create(person=person, job_title=title)

        mine = collaborator("Meu", with_user=True)
        other = collaborator("Outro")
        self.user = User.objects.get(pk=mine.person.user_id)

        def project(name, responsible):
            return Project.objects.create(
                company=company, client=client, site=site, name=name, status=Project.STATUS_IN_PROGRESS,
                responsible_cstr=Responsible.objects.create(person=responsible.person, kind=Responsible.KIND_CSTR),
            )

        self.mine = project("Projeto Meu", mine)
        self.other = project("Projeto Outro", other)

    def project_ids(self, **kwargs):
        return {row["id"] for row in build_projects_performance(**kwargs)["projects"]}

    def test_supervisor_sees_only_own_projects(self):
        self.assertEqual(self.project_ids(user=self.user), {self.mine.pk})

    def test_without_user_everything_is_listed(self):
        self.assertEqual(self.project_ids(), {self.mine.pk, self.other.pk})


class SitesPanelSupervisorScopeTests(DashboardProjectsScopeTests):
    """Gestão de Sites: mesma regra do dashboard (supervisor só vê os projetos em que é Responsável CSTR)."""

    def panel_ids(self, user):
        from projects.sites_panel import build_sites_panel

        data = build_sites_panel(user, include_technicians=False)
        return {row["id"] for row in data["projects"]}

    def test_supervisor_sees_only_own_projects_in_sites_panel(self):
        self.assertEqual(self.panel_ids(self.user), {self.mine.pk})

    def test_non_supervisor_sees_all_projects_in_sites_panel(self):
        admin = User.objects.create_superuser(username="adm", email="adm@x.com", password="x")
        self.assertEqual(self.panel_ids(admin), {self.mine.pk, self.other.pk})


class ProjectsListSupervisorScopeTests(DashboardProjectsScopeTests):
    """API de Projetos: supervisor só lista e abre os projetos em que é Responsável CSTR."""

    def api(self, user):
        from django.contrib.auth.models import Permission
        from rest_framework.test import APIClient

        user.user_permissions.add(Permission.objects.get(codename="view_project", content_type__app_label="projects"))
        client = APIClient()
        client.force_authenticate(User.objects.get(pk=user.pk))
        return client

    def test_supervisor_lists_only_own_projects_and_cannot_open_others(self):
        client = self.api(self.user)
        listed = client.get("/api/projects/", {"page_size": "100"}).json()
        ids = {row["id"] for row in listed["results"]}
        self.assertEqual(ids, {self.mine.pk})
        self.assertEqual(client.get(f"/api/projects/{self.mine.pk}/").status_code, 200)
        self.assertEqual(client.get(f"/api/projects/{self.other.pk}/").status_code, 404)

    def test_admin_lists_all_projects(self):
        admin = User.objects.create_superuser(username="adm2", email="adm2@x.com", password="x")
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(admin)
        ids = {row["id"] for row in client.get("/api/projects/", {"page_size": "100"}).json()["results"]}
        self.assertEqual(ids, {self.mine.pk, self.other.pk})


class OperationsBoardSupervisorScopeTests(DashboardProjectsScopeTests):
    """Central de Operações: supervisor vê só técnicos sob sua gestão e tarefas dos projetos em que é Responsável CSTR."""

    def test_board_and_timeline_limited_to_own_projects_and_team(self):
        from datetime import timedelta

        from core.models import Collaborator, Task
        from api.operations import build_board_data, build_timeline_data
        from projects.models import ProjectTask, ProjectTaskAssignment

        today = timezone.localdate()
        start = timezone.make_aware(timezone.datetime.combine(today, timezone.datetime.min.time())) + timedelta(hours=8)
        catalog = Task.objects.create(name="Tarefa")
        supervisor = Collaborator.objects.get(person__user=self.user)
        company = self.mine.company
        team_person = Person.objects.create(name="Tec Time", company=company)
        team_member = Collaborator.objects.create(person=team_person, manager=supervisor)
        outsider = Collaborator.objects.create(person=Person.objects.create(name="Tec Fora", company=company))

        def task(project, collaborator, order):
            t = ProjectTask.objects.create(
                project=project, task=catalog, order=order, status=ProjectTask.STATUS_NOT_STARTED, planned_start=start
            )
            ProjectTaskAssignment.objects.create(project_task=t, collaborator=collaborator)
            return t

        mine_task = task(self.mine, team_member, 1)
        other_task = task(self.other, team_member, 2)
        outsider_task = task(self.mine, outsider, 3)

        board = build_board_data(None, user=self.user)
        # pool do dia: só tarefas dos projetos do supervisor (a do projeto do colega fica de fora)
        self.assertEqual({t["id"] for t in board["pool"]}, {mine_task.id, outsider_task.id})
        names = {t["name"] for t in board["technicians"]}
        self.assertIn("Tec Time", names)
        self.assertNotIn("Tec Fora", names)
        team = next(t for t in board["technicians"] if t["name"] == "Tec Time")
        self.assertEqual({q["task_id"] for q in team["queue"]}, {mine_task.id})

        timeline = build_timeline_data(None, today, user=self.user)
        team_tl = next(t for t in timeline["technicians"] if t["name"] == "Tec Time")
        self.assertEqual({b["id"] for b in team_tl["blocks"]}, {mine_task.id})
        self.assertNotIn(other_task.id, {b["id"] for b in team_tl["blocks"]})

        admin = User.objects.create_superuser(username="adm3", email="adm3@x.com", password="x")
        self.assertEqual(
            {t["id"] for t in build_board_data(None, user=admin)["pool"]},
            {mine_task.id, other_task.id, outsider_task.id},
        )

    def test_reports_count_only_tasks_of_supervisor_projects(self):
        from datetime import timedelta

        from core.models import Collaborator, Task
        from api.operations import _log_entries
        from api.reports import build_operations_reports
        from projects.models import ProjectTask, ProjectTaskAssignment

        today = timezone.localdate()
        # horários fixos ao meio do dia: evitam flutuar entre dias perto da meia-noite
        started = timezone.make_aware(timezone.datetime.combine(today, timezone.datetime.min.time())) + timedelta(hours=10)
        ended = started + timedelta(hours=1)
        catalog = Task.objects.create(name="Tarefa")
        supervisor = Collaborator.objects.get(person__user=self.user)
        member = Collaborator.objects.create(
            person=Person.objects.create(name="Tec Time", company=self.mine.company), manager=supervisor
        )

        def completed(project, order):
            t = ProjectTask.objects.create(
                project=project, task=catalog, order=order, status=ProjectTask.STATUS_COMPLETED,
                actual_start=started, actual_end=ended,
            )
            ProjectTaskAssignment.objects.create(
                project_task=t, collaborator=member, status=ProjectTask.STATUS_COMPLETED,
                assignment_start=started, assignment_end=ended,
            )
            return t

        completed(self.mine, 1)
        completed(self.other, 2)
        completed(self.other, 3)

        def run(user):
            return build_operations_reports(
                site_id=None, date_from=today - timedelta(days=7), date_to=today, log_entries_fn=_log_entries, user=user
            )

        data = run(self.user)
        self.assertEqual(data["stats"]["period_completed_count"], 1)
        self.assertEqual(data["stats"]["completed_this_month"], 1)
        scoped_log = _log_entries([member.id], today, project_ids={self.mine.pk})
        self.assertEqual(sum(1 for e in scoped_log if e["type"] in ("start", "complete")), 2)  # só a tarefa do projeto dele
        self.assertEqual(sum(1 for e in _log_entries([member.id], today) if e["type"] in ("start", "complete")), 6)

        admin = User.objects.create_superuser(username="adm4", email="adm4@x.com", password="x")
        self.assertEqual(run(admin)["stats"]["period_completed_count"], 3)

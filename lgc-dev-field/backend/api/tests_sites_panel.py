from datetime import date, datetime, timedelta

from django.contrib.auth.models import Permission
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Client, Collaborator, Company, JobTitle, Person, Region, Site
from dispatch.models import TechnicianAbsence, TechnicianDailyPresence
from projects.models import Project, ProjectOccurrence, ProjectTask, ProjectTaskAssignment
from projects.sites_panel import (
    HEALTH_LATE,
    HEALTH_NO_DATA,
    HEALTH_OK,
    HEALTH_RISK,
    compute_progress,
    compute_project_health,
)
from users.models import User

# Quinta-feira — evita fim de semana nas contas de dias úteis.
TODAY = date(2026, 10, 1)


def aware(day, hour=12):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hour, 0))


NOW = aware(TODAY, 14)


class ProjectHealthRuleTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")

    def _project(self, **kwargs):
        defaults = {"company": self.company, "name": "P", "status": Project.STATUS_IN_PROGRESS}
        defaults.update(kwargs)
        return Project.objects.create(**defaults)

    def _tasks(self, project, specs):
        tasks = []
        for status, planned_end, actual_end in specs:
            tasks.append(
                ProjectTask.objects.create(
                    project=project, custom_name="T", status=status, planned_end=planned_end, actual_end=actual_end
                )
            )
        return tasks

    def test_canceled_tasks_are_ignored_in_progress(self):
        project = self._project()
        tasks = self._tasks(
            project,
            [
                (ProjectTask.STATUS_COMPLETED, aware(TODAY - timedelta(days=2)), aware(TODAY - timedelta(days=2))),
                (ProjectTask.STATUS_NOT_STARTED, aware(TODAY + timedelta(days=3)), None),
                (ProjectTask.STATUS_CANCELED, aware(TODAY - timedelta(days=5)), None),
            ],
        )
        real, planned = compute_progress(tasks, NOW)
        self.assertEqual(real, 50)
        self.assertEqual(planned, 50)

    def test_planned_without_base_when_many_tasks_without_date(self):
        project = self._project()
        tasks = self._tasks(
            project,
            [(ProjectTask.STATUS_NOT_STARTED, None, None), (ProjectTask.STATUS_NOT_STARTED, aware(TODAY), None)],
        )
        self.assertEqual(compute_progress(tasks, NOW), (0, None))

    def test_end_date_passed_is_late(self):
        project = self._project(planned_end=TODAY - timedelta(days=3))
        tasks = self._tasks(project, [(ProjectTask.STATUS_COMPLETED, aware(TODAY - timedelta(days=4)), aware(TODAY - timedelta(days=1)))])
        tasks += self._tasks(project, [(ProjectTask.STATUS_NOT_STARTED, aware(TODAY - timedelta(days=4)), None)])
        health, reasons, _ = compute_project_health(project, tasks, [], TODAY, NOW)
        self.assertEqual(health, HEALTH_LATE)
        self.assertEqual(reasons[0]["code"], "end_passed")
        self.assertIn("já passou", reasons[0]["text"])

    def test_small_deviation_is_risk(self):
        project = self._project(planned_end=TODAY + timedelta(days=30))
        specs = [(ProjectTask.STATUS_COMPLETED, aware(TODAY - timedelta(days=1)), aware(TODAY - timedelta(days=1)))] * 9
        specs += [(ProjectTask.STATUS_NOT_STARTED, aware(TODAY - timedelta(days=1)), None)]
        specs += [(ProjectTask.STATUS_NOT_STARTED, aware(TODAY + timedelta(days=5)), None)] * 10
        tasks = self._tasks(project, specs)
        health, reasons, metrics = compute_project_health(project, tasks, [], TODAY, NOW)
        self.assertEqual(metrics["deviation_pp"], 5)
        self.assertEqual(health, HEALTH_RISK)
        self.assertEqual([r["code"] for r in reasons], ["deviation"])

    def test_start_late_for_planning_project(self):
        project = self._project(status=Project.STATUS_PLANNING, planned_start=TODAY - timedelta(days=2))
        health, reasons, _ = compute_project_health(project, [], [], TODAY, NOW)
        self.assertEqual(health, HEALTH_RISK)
        self.assertEqual(reasons[0]["code"], "start_late")

    def test_stalled_project_is_risk(self):
        project = self._project(planned_end=TODAY + timedelta(days=40))
        tasks = self._tasks(
            project,
            [
                (ProjectTask.STATUS_COMPLETED, aware(TODAY - timedelta(days=10)), aware(TODAY - timedelta(days=7))),
                (ProjectTask.STATUS_NOT_STARTED, aware(TODAY + timedelta(days=10)), None),
            ],
        )
        health, reasons, _ = compute_project_health(project, tasks, [], TODAY, NOW)
        self.assertEqual(health, HEALTH_RISK)
        self.assertIn("stalled", [r["code"] for r in reasons])

    def test_severe_open_occurrence_is_risk(self):
        project = self._project(planned_end=TODAY + timedelta(days=40))
        tasks = self._tasks(project, [(ProjectTask.STATUS_COMPLETED, aware(TODAY), aware(TODAY))] + [(ProjectTask.STATUS_NOT_STARTED, aware(TODAY + timedelta(days=9)), None)])
        occurrence = ProjectOccurrence.objects.create(
            project=project, title="Bandeja sem liberação", severity=ProjectOccurrence.SEVERITY_HIGH, occurred_at=TODAY
        )
        health, reasons, _ = compute_project_health(project, tasks, [occurrence], TODAY, NOW)
        self.assertEqual(health, HEALTH_RISK)
        self.assertEqual(reasons[0]["code"], "occurrence")

    def test_executing_without_tasks_is_no_data(self):
        project = self._project(planned_end=TODAY + timedelta(days=10))
        health, reasons, _ = compute_project_health(project, [], [], TODAY, NOW)
        self.assertEqual(health, HEALTH_NO_DATA)
        self.assertEqual(reasons[0]["code"], "no_tasks")

    def test_on_track_is_ok(self):
        project = self._project(planned_end=TODAY + timedelta(days=30))
        tasks = self._tasks(
            project,
            [
                (ProjectTask.STATUS_COMPLETED, aware(TODAY - timedelta(days=1)), aware(TODAY)),
                (ProjectTask.STATUS_NOT_STARTED, aware(TODAY + timedelta(days=5)), None),
            ],
        )
        health, reasons, _ = compute_project_health(project, tasks, [], TODAY, NOW)
        self.assertEqual(health, HEALTH_OK)
        self.assertEqual(reasons, [])


class SitesPanelApiTests(TestCase):
    def setUp(self):
        self.api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.client_a = Client.objects.create(company=self.company, legal_name="Cliente A")
        self.client_b = Client.objects.create(company=self.company, legal_name="Cliente B")
        self.region = Region.objects.create(name="SP Interior", code="SPI")
        self.site_1 = Site.objects.create(client=self.client_a, name="Campinas", code="CPS-02", region=self.region)
        self.site_2 = Site.objects.create(client=self.client_b, name="Barueri", code="BRR-01")
        self.project_1 = Project.objects.create(
            company=self.company, client=self.client_a, site=self.site_1, name="Expansão DH3",
            status=Project.STATUS_IN_PROGRESS, planned_end=timezone.localdate() - timedelta(days=2),
        )
        self.project_2 = Project.objects.create(
            company=self.company, client=self.client_b, site=self.site_2, name="Cross-connect",
            status=Project.STATUS_PLANNING,
        )
        Project.objects.create(
            company=self.company, client=self.client_b, site=self.site_2, name="Concluído",
            status=Project.STATUS_COMPLETED,
        )
        self.task_1 = ProjectTask.objects.create(project=self.project_1, custom_name="Lançamento", status=ProjectTask.STATUS_IN_PROGRESS)
        self.task_2 = ProjectTask.objects.create(project=self.project_2, custom_name="Patch", status=ProjectTask.STATUS_NOT_STARTED)

        manager_title = JobTitle.objects.create(company=self.company, name="Supervisor de Campo")
        tech_title = JobTitle.objects.create(company=self.company, name="Técnico")
        # Técnico lotado nos dois sites, despachado (em execução) no site 1.
        self.tech_multi = self._collab("Carlos", tech_title, [self.site_1, self.site_2])
        assignment = ProjectTaskAssignment.objects.create(project_task=self.task_1, collaborator=self.tech_multi)
        assignment.assignment_start = timezone.now()
        assignment.save()
        TechnicianDailyPresence.objects.create(
            collaborator=self.tech_multi, status=TechnicianDailyPresence.STATUS_IN_PROGRESS
        )
        # Técnico sem despacho, lotação única no site 2, sem acesso ao site.
        self.tech_single = self._collab("Diego", tech_title, [self.site_2])
        TechnicianDailyPresence.objects.create(
            collaborator=self.tech_single, status=TechnicianDailyPresence.STATUS_SITE_BLOCKED
        )
        # Técnico de férias no site 1.
        self.tech_leave = self._collab("Lucas", tech_title, [self.site_1])
        TechnicianAbsence.objects.create(
            collaborator=self.tech_leave, date_from=timezone.localdate(), date_to=timezone.localdate() + timedelta(days=3)
        )
        # Supervisor lotado no site 1: não conta como técnico.
        self.supervisor = self._collab("Marcos", manager_title, [self.site_1])
        TechnicianDailyPresence.objects.create(
            collaborator=self.supervisor, status=TechnicianDailyPresence.STATUS_AVAILABLE
        )

    def _collab(self, name, title, sites):
        person = Person.objects.create(name=name, company=self.company)
        collaborator = Collaborator.objects.create(person=person, job_title=title)
        collaborator.sites.set(sites)
        return collaborator

    def _login_superuser(self):
        user = User.objects.create_superuser(username="panel_admin", email="panel@example.com", password="x")
        self.api.force_authenticate(user=user)
        return user

    def test_requires_authentication(self):
        self.assertEqual(self.api.get(reverse("dashboard-sites")).status_code, 401)

    def test_requires_view_project_permission(self):
        user = User.objects.create_user(username="nop", email="nop@example.com", password="x", company=self.company)
        self.api.force_authenticate(user=user)
        self.assertEqual(self.api.get(reverse("dashboard-sites")).status_code, 403)

    def test_site_view_counts_projects_and_technicians(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites")).json()

        summary = data["summary"]
        self.assertEqual(summary["in_progress"], 1)
        self.assertEqual(summary["planning"], 1)
        self.assertEqual(summary["late"], 1)
        # Supervisor fora; técnico multi-site contado uma vez só.
        self.assertEqual(summary["technicians"]["total"], 3)
        self.assertEqual(summary["technicians"]["executing"], 1)
        self.assertEqual(summary["technicians"]["unproductive"], 1)
        self.assertEqual(summary["technicians"]["on_leave"], 1)

        groups = {g["key"]: g for g in data["groups"]}
        site_1 = groups[f"site:{self.site_1.id}"]
        site_2 = groups[f"site:{self.site_2.id}"]
        self.assertEqual(site_1["health"], HEALTH_LATE)
        self.assertEqual(data["groups"][0]["key"], f"site:{self.site_1.id}")  # mais crítico primeiro
        # Técnico multi-site fica no site da tarefa despachada.
        self.assertEqual(site_1["technicians"]["executing"], 1)
        self.assertEqual(site_1["technicians"]["on_leave"], 1)
        self.assertEqual(site_2["technicians"]["executing"], 0)
        self.assertEqual(site_2["technicians"]["unproductive"], 1)
        self.assertEqual(site_2["projects"]["planning"], 1)

        row = next(p for p in data["projects"] if p["id"] == self.project_1.id)
        self.assertEqual(row["health"], HEALTH_LATE)
        self.assertTrue(row["reasons"])
        self.assertEqual([t["name"] for t in row["technicians_today"]], ["Carlos"])

    def test_region_view_groups_sites_without_region(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites"), {"group_by": "region"}).json()
        keys = {g["key"]: g for g in data["groups"]}
        self.assertIn(f"region:{self.region.id}", keys)
        self.assertEqual(keys["region:none"]["label"], "Sem regional")

    def test_group_by_accepts_several_dimensions_combined(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites"), {"group_by": "site,client"}).json()
        self.assertEqual(data["group_by"], "client,site")  # hierarquia fixa: Cliente antes de Site
        groups = {g["key"]: g for g in data["groups"]}
        key = f"client:{self.client_a.id}|site:{self.site_1.id}"
        self.assertIn(key, groups)
        self.assertTrue(groups[key]["label"].startswith("Cliente A · "))
        self.assertIn("Campinas", groups[key]["label"])
        self.assertIn(self.project_1.id, groups[key]["project_ids"])

    def test_group_by_region_and_site_keeps_technicians_without_dispatch(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites"), {"group_by": "region,site"}).json()
        groups = {g["key"]: g for g in data["groups"]}
        site_2_group = groups[f"region:none|site:{self.site_2.id}"]
        self.assertEqual(site_2_group["technicians"]["unproductive"], 1)

    def test_group_by_invalid_values_fall_back_to_site(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites"), {"group_by": "foo,bar"}).json()
        self.assertEqual(data["group_by"], "site")

    def test_country_filter_accepts_several_countries(self):
        self._login_superuser()
        country = self.region.country
        both = self.api.get(reverse("dashboard-sites"), {"country": f"{country},ZZ"}).json()
        self.assertEqual([p["id"] for p in both["projects"]], [self.project_1.id])
        none = self.api.get(reverse("dashboard-sites"), {"country": "ZZ"}).json()
        self.assertEqual(none["projects"], [])

    def test_client_view_counts_only_dispatched_technicians(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites"), {"group_by": "client"}).json()
        groups = {g["key"]: g for g in data["groups"]}
        self.assertEqual(groups[f"client:{self.client_a.id}"]["technicians"]["total"], 1)
        self.assertEqual(groups[f"client:{self.client_b.id}"]["technicians"]["total"], 0)

    def test_technicians_hidden_without_operations_permission(self):
        user = User.objects.create_user(username="viewer", email="viewer@example.com", password="x", company=self.company)
        user.user_permissions.add(Permission.objects.get(codename="view_project"))
        self.api.force_authenticate(user=user)
        data = self.api.get(reverse("dashboard-sites")).json()
        self.assertFalse(data["include_technicians"])
        self.assertIsNone(data["summary"]["technicians"])
        self.assertTrue(all(g["technicians"] is None for g in data["groups"]))

    def test_manager_scope_limits_sites(self):
        user = User.objects.create_user(username="mgr", email="mgr@example.com", password="x", company=self.company)
        user.user_permissions.add(
            Permission.objects.get(codename="view_project"),
            Permission.objects.get(codename="view_projecttaskassignment"),
        )
        user.manager_sites.set([self.site_2])
        self.api.force_authenticate(user=user)
        data = self.api.get(reverse("dashboard-sites")).json()
        self.assertEqual([g["key"] for g in data["groups"]], [f"site:{self.site_2.id}"])
        self.assertEqual(data["summary"]["technicians"]["total"], 1)

    def test_exceptions_include_late_project(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites")).json()
        first = data["exceptions"][0]
        self.assertEqual(first["level"], HEALTH_LATE)
        self.assertEqual(first["action"], {"type": "project", "project_id": self.project_1.id})

    def test_default_status_filter_excludes_finished(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites")).json()
        self.assertEqual(data["status_filters"], ["active", "paused", "planning"])
        self.assertNotIn("Concluído", [p["name"] for p in data["projects"]])
        self.assertEqual(data["summary"]["finished"], 0)

    def test_status_filter_combination(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites"), {"status": "planning,finished"}).json()
        self.assertEqual(data["status_filters"], ["planning", "finished"])
        self.assertEqual(sorted(p["name"] for p in data["projects"]), ["Concluído", "Cross-connect"])
        self.assertEqual(data["summary"]["finished"], 1)
        finished = next(p for p in data["projects"] if p["name"] == "Concluído")
        self.assertEqual(finished["health"], HEALTH_OK)

    def test_invalid_status_filter_falls_back_to_default(self):
        self._login_superuser()
        data = self.api.get(reverse("dashboard-sites"), {"status": "xyz"}).json()
        self.assertEqual(data["status_filters"], ["active", "paused", "planning"])

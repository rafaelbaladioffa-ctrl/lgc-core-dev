from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from audit.models import AuditLog
from core.models import Client, Collaborator, Company, Person, Site
from projects.models import Project
from users.models import User
from .models import DailyUpdate, DailyUpdateAllocation


def make_collaborator(company, name, **kwargs):
    person = Person.objects.create(name=name, company=company)
    return Collaborator.objects.create(person=person, **kwargs)


class DailyUpdateTests(TestCase):
    def setUp(self):
        self.supervisor = User.objects.create_superuser(
            username="daily_supervisor",
            email="daily@example.com",
            password="test-password",
        )
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.client_record = Client.objects.create(company=self.company, legal_name="Cliente Teste")
        self.site = Site.objects.create(client=self.client_record, name="GRU65", code="GRU65")
        self.project = Project.objects.create(
            company=self.company,
            site=self.site,
            name="Projeto Alocação",
            po="PO-1001",
            status=Project.STATUS_IN_PROGRESS,
        )
        self.second_project = Project.objects.create(
            company=self.company,
            site=self.site,
            name="Segundo Projeto",
            po="PO-1002",
            status=Project.STATUS_PLANNING,
        )
        self.technicians = [
            make_collaborator(self.company, f"Técnico {number}")
            for number in range(1, 3)
        ]
        AuditLog.objects.all().delete()
        self.client.force_login(self.supervisor)

    def test_default_allocation_date_is_tomorrow(self):
        update = DailyUpdate()
        self.assertEqual(update.allocation_date, timezone.localdate() + timedelta(days=1))

    def test_supervisor_creates_daily_allocation_with_multiple_technicians(self):
        allocation_date = timezone.localdate() + timedelta(days=1)
        response = self.client.post(
            "/admin/updates/dailyupdate/add/",
            {
                "allocation_date": allocation_date.isoformat(),
                "allocations-TOTAL_FORMS": "2",
                "allocations-INITIAL_FORMS": "0",
                "allocations-MIN_NUM_FORMS": "1",
                "allocations-MAX_NUM_FORMS": "1000",
                "allocations-0-project": str(self.project.pk),
                "allocations-0-collaborators": [str(self.technicians[0].pk)],
                "allocations-1-project": str(self.second_project.pk),
                "allocations-1-collaborators": [str(self.technicians[1].pk)],
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 302)
        update = DailyUpdate.objects.get()
        self.assertEqual(update.created_by, self.supervisor)
        self.assertQuerySetEqual(
            update.allocations.order_by("project_id").values_list("project_id", flat=True),
            [self.project.pk, self.second_project.pk],
        )
        self.assertEqual(list(update.sites), [self.site.name])
        self.assertQuerySetEqual(
            update.allocations.get(project=self.project).collaborators.all(),
            [self.technicians[0]],
        )
        self.assertQuerySetEqual(
            update.allocations.get(project=self.second_project).collaborators.all(),
            [self.technicians[1]],
        )
        self.assertIn("ATUALIZAÇÃO DIÁRIA", update.description)
        self.assertIn(allocation_date.strftime("%d/%m/%Y"), update.description)
        self.assertIn(self.project.name, update.description)
        self.assertIn(self.project.po, update.description)
        self.assertIn(self.second_project.name, update.description)
        self.assertIn(self.second_project.po, update.description)
        self.assertIn(self.site.name, update.description)
        for technician in self.technicians:
            self.assertIn(technician.person.name, update.description)
        self.assertTrue(
            AuditLog.objects.filter(
                app_label="updates",
                object_pk=str(update.pk),
                actor=self.supervisor,
                origin="Django Admin",
            ).exists()
        )

    def test_collaborator_from_another_company_is_rejected(self):
        another_company = Company.objects.create(legal_name="Outra Empresa")
        outsider = make_collaborator(another_company, "Técnico Externo")
        response = self.client.post(
            "/admin/updates/dailyupdate/add/",
            {
                "allocation_date": (timezone.localdate() + timedelta(days=1)).isoformat(),
                "allocations-TOTAL_FORMS": "1",
                "allocations-INITIAL_FORMS": "0",
                "allocations-MIN_NUM_FORMS": "1",
                "allocations-MAX_NUM_FORMS": "1000",
                "allocations-0-project": str(self.project.pk),
                "allocations-0-collaborators": [str(outsider.pk)],
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "mesma Empresa do Projeto selecionado")
        self.assertFalse(DailyUpdate.objects.exists())

    def test_completed_project_is_not_available_for_allocation(self):
        completed = Project.objects.create(
            company=self.company,
            site=self.site,
            name="Projeto Concluído",
            status=Project.STATUS_COMPLETED,
        )
        paused = Project.objects.create(
            company=self.company,
            site=self.site,
            name="Projeto Pausado",
            status=Project.STATUS_PAUSED,
        )
        response = self.client.get("/admin/updates/dailyupdate/add/")

        self.assertEqual(response.status_code, 200)
        project_field = response.context["inline_admin_formsets"][0].formset.forms[0].fields["project"]
        self.assertIn(self.project, project_field.queryset)
        self.assertIn(self.second_project, project_field.queryset)
        self.assertNotIn(completed, project_field.queryset)
        self.assertNotIn(paused, project_field.queryset)

    def test_consolidated_pdf_is_generated_for_selected_date(self):
        allocation_date = timezone.localdate() + timedelta(days=1)
        update = DailyUpdate.objects.create(
            allocation_date=allocation_date,
            created_by=self.supervisor,
        )
        allocation = DailyUpdateAllocation.objects.create(
            daily_update=update,
            project=self.project,
        )
        allocation.collaborators.set(self.technicians)

        response = self.client.get(
            "/admin/updates/dailyupdate/pdf-consolidado/",
            {"date": allocation_date.isoformat()},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(b"".join(response.streaming_content).startswith(b"%PDF"))


class WeeklyUpdateTests(TestCase):
    def setUp(self):
        from core.models import Responsible

        self.user = User.objects.create_superuser(username="weekly", email="weekly@example.com", password="x")
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.client_record = Client.objects.create(company=company, legal_name="Cliente Teste")
        site = Site.objects.create(client=self.client_record, name="GRU65", code="GRU65")
        self.projects = [
            Project.objects.create(
                company=company, site=site, client=self.client_record, name=name, po=f"PO-{i}",
                status=Project.STATUS_IN_PROGRESS,
            )
            for i, name in enumerate(["Projeto Alfa", "Projeto Beta"], start=1)
        ]
        person = Person.objects.create(name="CONTATO CLIENTE", email="contato@cliente.com")
        Responsible.objects.create(person=person, kind=Responsible.KIND_CLIENT, client=self.client_record)
        from rest_framework.test import APIClient

        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.today = timezone.localdate()

    def post(self, **extra):
        payload = {
            "project_ids": [p.pk for p in self.projects],
            "start": (self.today - timedelta(days=6)).isoformat(),
            "end": self.today.isoformat(),
            "language": "pt",
            **extra,
        }
        return self.api.post("/api/project-updates/send-weekly/", payload, format="json")

    def test_sends_single_email_with_all_projects(self):
        from django.core import mail

        response = self.post(emails=["extra@exemplo.com"])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["projects"], 2)
        self.assertEqual(len(mail.outbox), 2)  # contato do cliente + e-mail avulso, um e-mail cada
        for message in mail.outbox:
            html = message.alternatives[0][0]
            self.assertIn("Projeto Alfa", html)
            self.assertIn("Projeto Beta", html)
            self.assertIn("Update Semanal", message.subject)
            self.assertIn("2 projetos", message.subject)
            pdfs = [att for att in message.attachments if isinstance(att, tuple) and att[2] == "application/pdf"]
            self.assertEqual(len(pdfs), 1)
            self.assertTrue(pdfs[0][0].startswith("update-semanal-"))
            self.assertTrue(pdfs[0][1].startswith(b"%PDF"))
        from .models import ProjectDailyUpdate

        self.assertEqual(ProjectDailyUpdate.objects.filter(sent_at__isnull=False).count(), 2)

    def test_reuses_existing_update_in_the_week(self):
        from .models import ProjectDailyUpdate

        existing = ProjectDailyUpdate.objects.create(project=self.projects[0], date=self.today - timedelta(days=2))
        self.post(emails=["extra@exemplo.com"])
        self.assertEqual(ProjectDailyUpdate.objects.filter(project=self.projects[0]).count(), 1)
        existing.refresh_from_db()
        self.assertIsNotNone(existing.sent_at)

    def test_rejects_missing_projects_and_bad_period(self):
        self.assertEqual(self.post(project_ids=[]).status_code, 400)
        self.assertEqual(self.post(start=self.today.isoformat(), end=(self.today - timedelta(days=1)).isoformat()).status_code, 400)

class WeeklyAdvanceTests(TestCase):
    def task(self, status, day=None):
        from datetime import datetime
        from types import SimpleNamespace

        end = timezone.make_aware(datetime.combine(day, datetime.min.time())) if day else None
        return SimpleNamespace(status=status, actual_end=end, updated_at=end)

    def test_advance_counts_only_tasks_completed_since_start(self):
        from projects.models import ProjectTask
        from .project_client_mail import weekly_advance

        today = timezone.localdate()
        start = today - timedelta(days=6)
        done = ProjectTask.STATUS_COMPLETED
        tasks = [
            self.task(done, start - timedelta(days=3)),  # antes da semana
            self.task(done, start),  # na semana
            self.task(done, today),  # na semana
            self.task(ProjectTask.STATUS_NOT_STARTED),
        ]
        self.assertEqual(weekly_advance(tasks, 75, start), 50)  # 75% agora - 25% antes

    def test_advance_is_never_negative_and_handles_no_tasks(self):
        from .project_client_mail import weekly_advance

        self.assertEqual(weekly_advance([], 0, timezone.localdate()), 0)
        self.assertEqual(weekly_advance([self.task('not_started')], 0, timezone.localdate()), 0)

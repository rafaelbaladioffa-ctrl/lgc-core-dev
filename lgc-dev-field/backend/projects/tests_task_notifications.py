from django.test import TestCase

from core.models import Company, Notification, Person, Responsible, Task
from projects.models import Project, ProjectTask
from users.models import User


class TaskCompletedNotificationTests(TestCase):
    """O responsável CSTR do projeto é avisado quando uma tarefa é finalizada."""

    def setUp(self):
        self.company = Company.objects.create(legal_name="Empresa Notif", tax_id="12.345.678/0001-90")
        self.user = User.objects.create_user(username="sup", email="sup@example.com", company=self.company)
        person = Person.objects.create(company=self.company, name="Supervisor Teste", user=self.user)
        responsible = Responsible.objects.create(person=person, kind=Responsible.KIND_CSTR)
        self.project = Project.objects.create(company=self.company, name="Projeto Notif", responsible_cstr=responsible)
        self.task = ProjectTask.objects.create(project=self.project, task=Task.objects.create(name="Tarefa X"), order=1)
        Notification.objects.all().delete()

    def test_completing_a_task_notifies_the_project_supervisor(self):
        self.task.status = ProjectTask.STATUS_COMPLETED
        self.task.save()
        notes = Notification.objects.filter(user=self.user, title="Tarefa finalizada")
        self.assertEqual(notes.count(), 1)
        self.assertIn("Tarefa X", notes.first().message)
        self.assertEqual(notes.first().url, f"/projetos/{self.project.pk}")

    def test_saving_an_already_completed_task_does_not_notify_again(self):
        self.task.status = ProjectTask.STATUS_COMPLETED
        self.task.save()
        self.task.notes = "ajuste"
        self.task.save()
        self.assertEqual(Notification.objects.filter(title="Tarefa finalizada").count(), 1)

    def test_other_status_changes_do_not_notify(self):
        self.task.status = ProjectTask.STATUS_IN_PROGRESS
        self.task.save()
        self.assertFalse(Notification.objects.filter(title="Tarefa finalizada").exists())

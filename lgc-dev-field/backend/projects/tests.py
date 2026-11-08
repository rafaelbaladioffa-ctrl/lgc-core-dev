from datetime import datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone

from users.models import User
from core.models import Client, Collaborator, Company, Person, ProjectType, Responsible, Site, Task
from .models import Project, ProjectHistory, ProjectTask, RackPosition


def make_collaborator(company, name, **kwargs):
    person = Person.objects.create(name=name, company=company)
    return Collaborator.objects.create(person=person, **kwargs)


def make_responsible(company, name, **kwargs):
    person = Person.objects.create(name=name, company=company)
    return Responsible.objects.create(person=person, kind=Responsible.KIND_CSTR, **kwargs)


def make_client_responsible(client, name, **kwargs):
    person = Person.objects.create(name=name)
    return Responsible.objects.create(client=client, person=person, kind=Responsible.KIND_CLIENT, **kwargs)


class ProjectTests(TestCase):
    def test_project_tasks_are_hidden_from_admin_modules(self):
        admin_user = User.objects.create_superuser(
            username="hidden_tasks_admin",
            email="hidden-tasks@example.com",
            password="test-password",
        )
        self.client.force_login(admin_user)

        admin_home = self.client.get("/admin/")
        projects_home = self.client.get("/admin/projects/")

        self.assertEqual(admin_home.status_code, 200)
        self.assertEqual(projects_home.status_code, 200)
        self.assertNotContains(admin_home, 'href="/admin/projects/projecttask/"')
        self.assertNotContains(projects_home, 'href="/admin/projects/projecttask/"')

    def test_project_admin_lists_all_statuses_except_completed_and_canceled(self):
        """A listagem padrão de Projetos usa o mesmo critério de "ativos" do
        frontend: tudo exceto Concluído/Cancelado. Um projeto "Não Iniciado"
        precisa aparecer aqui — antes ficava escondido do Admin mesmo
        existindo no banco e aparecendo no frontend (bug reportado)."""
        admin_user = User.objects.create_superuser(
            username="project_list_admin",
            email="project-list@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="Empresa dos Projetos")
        visible_projects = [
            Project.objects.create(company=company, name="Projeto Ativo", status=Project.STATUS_IN_PROGRESS),
            Project.objects.create(company=company, name="Projeto Planejado", status=Project.STATUS_PLANNING),
            Project.objects.create(company=company, name="Projeto Pausado", status=Project.STATUS_PAUSED),
            Project.objects.create(company=company, name="Projeto Não Iniciado", status=Project.STATUS_NOT_STARTED),
        ]
        hidden_projects = [
            Project.objects.create(company=company, name="Projeto Concluído", status=Project.STATUS_COMPLETED),
            Project.objects.create(company=company, name="Projeto Cancelado", status=Project.STATUS_CANCELED),
        ]
        self.client.force_login(admin_user)

        response = self.client.get("/admin/projects/project/")

        self.assertEqual(response.status_code, 200)
        for project in visible_projects:
            self.assertContains(response, project.name)
        for project in hidden_projects:
            self.assertNotContains(response, project.name)
        self.assertContains(response, "Ativo")

    def test_project_history_admin_only_lists_completed_projects(self):
        admin_user = User.objects.create_superuser(
            username="history_admin",
            email="history@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        completed = Project.objects.create(
            company=company,
            name="Projeto Finalizado",
            status=Project.STATUS_COMPLETED,
        )
        Project.objects.create(
            company=company,
            name="Projeto em Planejamento",
            status=Project.STATUS_PLANNING,
        )
        self.client.force_login(admin_user)

        response = self.client.get("/admin/projects/projecthistory/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Histórico de Projetos")
        self.assertContains(response, "Projeto Finalizado")
        self.assertNotContains(response, "Projeto em Planejamento")
        self.assertContains(response, f"/admin/projects/project/{completed.pk}/overview/")
        self.assertContains(response, f"/admin/projects/project/{completed.pk}/change/")
        self.assertEqual(ProjectHistory.objects.count(), 2)
        self.assertEqual(
            self.client.get(f"/admin/projects/project/{completed.pk}/overview/").status_code,
            200,
        )

    def test_project_code_is_generated_sequentially_per_year(self):
        company = Company.objects.create(legal_name="Empresa de Projetos")
        first = Project.objects.create(company=company, name="Projeto A")
        second = Project.objects.create(company=company, name="Projeto B")
        year = timezone.localdate().year
        self.assertEqual(first.code, f"CSTR-PROJ-{year}0001")
        self.assertEqual(second.code, f"CSTR-PROJ-{year}0002")

    def test_structured_project_code_uses_type_client_site_month_and_yearly_sequence(self):
        from core.models import ConsultimerProjectType
        from projects.models import ProjectCodeSequence

        company = Company.objects.create(legal_name="Empresa de Projetos")
        client = Client.objects.create(company=company, legal_name="Cliente")
        site = Site.objects.create(client=client, name="GRU65", code="GRU65")
        deploy = ConsultimerProjectType.objects.create(name="Deployment", code="DP")
        fitout = ConsultimerProjectType.objects.create(name="Fitout", code="FO")
        first = Project.objects.create(company=company, name="A", client=client, site=site, consultimer_type=deploy)
        second = Project.objects.create(company=company, name="B", client=client, site=site, consultimer_type=fitout)
        today = timezone.localdate()
        self.assertEqual(first.code, f"DP001GRU65{today:%y%m}0001")
        self.assertEqual(second.code, f"FO001GRU65{today:%y%m}0002")
        ProjectCodeSequence.objects.filter(year=today.year).delete()
        other_site = Site.objects.create(client=client, name="GRU50", code="GRU50")
        third = Project.objects.create(company=company, name="C", client=client, site=other_site, consultimer_type=deploy)
        self.assertTrue(third.code.endswith("0001"))

    def test_project_has_po_and_two_responsible_fields(self):
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        client = Client.objects.create(company=company, legal_name="Cliente")
        responsible_client = make_client_responsible(client, "Responsável do Cliente")
        responsible_cstr = make_responsible(company, "Responsável CSTR")
        project = Project.objects.create(
            company=company,
            name="Projeto com PO",
            po="PO-12345",
            client=client,
            responsible_client=responsible_client,
            responsible_cstr=responsible_cstr,
        )
        self.assertEqual(project.po, "PO-12345")
        self.assertEqual(project.responsible_client, responsible_client)
        self.assertEqual(project.responsible_cstr, responsible_cstr)

    def test_project_allows_client_and_site_from_same_client(self):
        cstr = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        customer = Company.objects.create(legal_name="A100 ROW SERVICOS DE DADOS BRASIL LTDA", trade_name="AWS")
        client = Client.objects.create(company=customer, legal_name=customer.legal_name, trade_name="AWS")
        site = Site.objects.create(client=client, name="GRU65", code="GRU65")

        project = Project(company=cstr, name="Projeto AWS", client=client, site=site)
        project.full_clean()

    def test_project_rejects_site_from_client_other_than_project_client(self):
        cstr = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        customer = Company.objects.create(legal_name="Cliente AWS")
        client = Client.objects.create(company=customer, legal_name="AWS")
        another_client = Client.objects.create(company=customer, legal_name="Outro Cliente")
        site = Site.objects.create(client=another_client, name="Site externo", code="EXT")

        with self.assertRaises(ValidationError):
            Project(company=cstr, name="Projeto inválido", client=client, site=site).full_clean()

    def test_project_task_links_catalog_task_and_collaborator(self):
        company = Company.objects.create(legal_name="Empresa Tarefas")
        project = Project.objects.create(company=company, name="Projeto Operacional")
        task = Task.objects.create(name="Instalação")
        collaborator = make_collaborator(company, "Colaborador")
        project_task = ProjectTask(project=project, task=task)
        project_task.full_clean()
        project_task.save()
        project_task.collaborators.add(collaborator)
        self.assertEqual(project_task.task, task)

    def test_project_task_accepts_multiple_collaborators(self):
        company_a = Company.objects.create(legal_name="Empresa A")
        project = Project.objects.create(company=company_a, name="Projeto")
        task = Task.objects.create(name="Tarefa")
        first = make_collaborator(company_a, "Primeiro Responsável")
        second = make_collaborator(company_a, "Segundo Responsável")
        project_task = ProjectTask.objects.create(project=project, task=task)
        project_task.collaborators.set([first, second])
        self.assertEqual(project_task.collaborators.count(), 2)

    def test_admin_can_import_all_tasks_from_project_type(self):
        admin_user = User.objects.create_superuser(username="project_admin", email="project@example.com", password="test-password")
        company = Company.objects.create(legal_name="Empresa de Importação")
        project_type = ProjectType.objects.create(name="BRICK")
        first_task = Task.objects.create(name="Primeira Tarefa", estimated_hours=2)
        second_task = Task.objects.create(name="Segunda Tarefa", estimated_hours=4)
        unrelated_task = Task.objects.create(name="Outra Tarefa")
        first_task.project_types.add(project_type)
        second_task.project_types.add(project_type)
        self.client.force_login(admin_user)

        response = self.client.post(
            "/admin/projects/project/add/",
            {
                "company": str(company.pk),
                "name": "Projeto com Tarefas",
                "project_type": str(project_type.pk),
                "import_tasks_from_project_type": "on",
                "status": Project.STATUS_PLANNING,
                "is_active": "on",
                "rack_positions-TOTAL_FORMS": "0",
                "rack_positions-INITIAL_FORMS": "0",
                "rack_positions-MIN_NUM_FORMS": "0",
                "rack_positions-MAX_NUM_FORMS": "1000",
                "project_tasks-TOTAL_FORMS": "0",
                "project_tasks-INITIAL_FORMS": "0",
                "project_tasks-MIN_NUM_FORMS": "0",
                "project_tasks-MAX_NUM_FORMS": "1000",
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 302)
        project = Project.objects.get(name="Projeto com Tarefas")
        self.assertQuerySetEqual(
            project.project_tasks.order_by("order").values_list("task", flat=True),
            [first_task.pk, second_task.pk],
        )
        self.assertFalse(project.project_tasks.filter(task=unrelated_task).exists())

    def test_project_overview_links_to_full_edit_form(self):
        admin_user = User.objects.create_superuser(
            username="overview_admin",
            email="overview@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        project = Project.objects.create(company=company, name="Projeto Visão Geral")
        self.client.force_login(admin_user)

        response = self.client.get(f"/admin/projects/project/{project.pk}/overview/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Visão Geral")
        self.assertContains(response, "Editar Projeto")
        self.assertContains(response, f'/admin/projects/project/{project.pk}/change/')

        changelist_response = self.client.get("/admin/projects/project/")
        overview_url = f"/admin/projects/project/{project.pk}/overview/"
        self.assertContains(changelist_response, overview_url, count=2)
        self.assertNotContains(changelist_response, ">Visão Geral</th>")

    def test_admin_bulk_updates_all_project_tasks(self):
        admin_user = User.objects.create_superuser(
            username="bulk_admin",
            email="bulk@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        collaborator = make_collaborator(company, "Responsável em Massa")
        project = Project.objects.create(company=company, name="Projeto em Massa")
        task = Task.objects.create(name="Tarefa em Massa")
        project_task = ProjectTask.objects.create(project=project, task=task, order=1)
        self.client.force_login(admin_user)

        response = self.client.post(
            f"/admin/projects/project/{project.pk}/change/",
            {
                "company": str(company.pk),
                "name": project.name,
                "status": Project.STATUS_PLANNING,
                "is_active": "on",
                "bulk_task_action": "update",
                "bulk_tasks": [str(project_task.pk)],
                "bulk_collaborators": [str(collaborator.pk)],
                "bulk_status": ProjectTask.STATUS_IN_PROGRESS,
                "bulk_start": "2026-08-17T08:30",
                "bulk_end": "2026-08-17T17:45",
                "bulk_estimated_hours": "8.50",
                "rack_positions-TOTAL_FORMS": "0",
                "rack_positions-INITIAL_FORMS": "0",
                "rack_positions-MIN_NUM_FORMS": "0",
                "rack_positions-MAX_NUM_FORMS": "1000",
                "project_tasks-TOTAL_FORMS": "1",
                "project_tasks-INITIAL_FORMS": "1",
                "project_tasks-MIN_NUM_FORMS": "0",
                "project_tasks-MAX_NUM_FORMS": "1000",
                "project_tasks-0-id": str(project_task.pk),
                "project_tasks-0-task": str(task.pk),
                "project_tasks-0-order": "1",
                "project_tasks-0-status": ProjectTask.STATUS_NOT_STARTED,
                "project_tasks-0-estimated_hours": "0.00",
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 302)
        project_task.refresh_from_db()
        self.assertQuerySetEqual(project_task.collaborators.all(), [collaborator])
        self.assertEqual(project_task.status, ProjectTask.STATUS_IN_PROGRESS)
        self.assertEqual(project_task.planned_start, timezone.make_aware(datetime(2026, 8, 17, 8, 30)))
        self.assertEqual(project_task.planned_end, timezone.make_aware(datetime(2026, 8, 17, 17, 45)))
        self.assertEqual(str(project_task.estimated_hours), "8.50")

    def test_overview_does_not_count_planned_dates_as_worked_hours(self):
        admin_user = User.objects.create_superuser(username="no_hours_admin", email="no_hours@example.com", password="test-password")
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        project = Project.objects.create(company=company, name="Projeto sem apontamento")
        ProjectTask.objects.create(
            project=project,
            task=Task.objects.create(name="Concluída sem apontamento"),
            order=1,
            status=ProjectTask.STATUS_COMPLETED,
            planned_start=timezone.make_aware(datetime(2026, 8, 17, 8, 30)),
            planned_end=timezone.make_aware(datetime(2026, 8, 17, 17, 45)),
        )
        self.client.force_login(admin_user)

        response = self.client.get(f"/admin/projects/project/{project.pk}/overview/")

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "9h15min")  # as datas planejadas não viram horas trabalhadas
        self.assertContains(response, "Horas Trabalhadas")

    def test_overview_calculates_worked_hours_from_completed_tasks(self):
        admin_user = User.objects.create_superuser(
            username="hours_admin",
            email="hours@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        project = Project.objects.create(company=company, name="Projeto com Horas")
        completed_catalog_task = Task.objects.create(name="Tarefa Concluída")
        open_catalog_task = Task.objects.create(name="Tarefa Aberta")
        completed_project_task = ProjectTask.objects.create(
            project=project,
            task=completed_catalog_task,
            order=1,
            status=ProjectTask.STATUS_COMPLETED,
            planned_start=timezone.make_aware(datetime(2026, 8, 17, 8, 30)),
            planned_end=timezone.make_aware(datetime(2026, 8, 17, 17, 45)),
            # Só apontamento real vale como hora trabalhada (o planejado nunca é fallback).
            actual_start=timezone.make_aware(datetime(2026, 8, 17, 8, 30)),
            actual_end=timezone.make_aware(datetime(2026, 8, 17, 17, 45)),
            actual_hours=Decimal("9.25"),
        )
        collaborators = [
            make_collaborator(company, f"Responsável {number}")
            for number in range(1, 4)
        ]
        completed_project_task.collaborators.set(collaborators)
        ProjectTask.objects.create(
            project=project,
            task=open_catalog_task,
            order=2,
            status=ProjectTask.STATUS_IN_PROGRESS,
            planned_start=timezone.make_aware(datetime(2026, 8, 18, 8, 0)),
            planned_end=timezone.make_aware(datetime(2026, 8, 18, 18, 0)),
        )
        self.client.force_login(admin_user)

        response = self.client.get(f"/admin/projects/project/{project.pk}/overview/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "9h15min")
        self.assertNotContains(response, "19h15min")
        self.assertContains(response, "Horas Trabalhadas")
        self.assertContains(response, ">+1</summary>")
        self.assertContains(response, 'data-project-panel="tarefas" role="tabpanel" hidden')
        self.assertContains(response, 'data-project-panel="equipe" role="tabpanel" hidden')

    def test_admin_exports_projects_as_csv(self):
        admin_user = User.objects.create_superuser(
            username="csv_export_admin",
            email="csv-export@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        Project.objects.create(company=company, name="Projeto Exportado", po="PO-CSV")
        self.client.force_login(admin_user)

        response = self.client.get("/admin/projects/project/export-csv/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn("Projeto Exportado", response.content.decode("utf-8-sig"))

    def test_admin_imports_projects_from_csv(self):
        admin_user = User.objects.create_superuser(
            username="csv_import_admin",
            email="csv-import@example.com",
            password="test-password",
        )
        Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.client.force_login(admin_user)
        csv_content = (
            "nome;po;empresa;status;ativo\n"
            "Projeto Importado;PO-IMPORT;CONSULTIMER BRASIL LTDA;Planejamento;Sim\n"
        )
        uploaded_file = SimpleUploadedFile("projetos.csv", csv_content.encode("utf-8"), content_type="text/csv")

        response = self.client.post(
            "/admin/projects/project/import-csv/",
            {"csv_file": uploaded_file},
        )

        self.assertEqual(response.status_code, 302)
        imported = Project.objects.get(name="Projeto Importado")
        self.assertEqual(imported.po, "PO-IMPORT")
        self.assertTrue(imported.code.startswith("CSTR-PROJ-"))

    def test_csv_import_page_has_explicit_file_picker(self):
        admin_user = User.objects.create_superuser(
            username="csv_picker_admin",
            email="csv-picker@example.com",
            password="test-password",
        )
        self.client.force_login(admin_user)

        response = self.client.get("/admin/projects/project/import-csv/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'for="id_csv_file"')
        self.assertContains(response, "Selecionar arquivo")
        self.assertContains(response, 'accept=".csv,text/csv"')

    def test_bulk_rack_positions_are_created_from_pasted_text(self):
        admin_user = User.objects.create_superuser(
            username="rack_bulk_admin",
            email="rack-bulk@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        project = Project.objects.create(company=company, name="Projeto Rack", has_rack_positions=True)
        self.client.force_login(admin_user)

        response = self.client.post(
            f"/admin/projects/project/{project.pk}/change/",
            {
                "company": str(company.pk),
                "name": project.name,
                "status": Project.STATUS_PLANNING,
                "is_active": "on",
                "has_rack_positions": "on",
                "bulk_rack_positions": "RACK01;DH1;24;48\nRACK02;;12;\nRACK03",
                "rack_positions-TOTAL_FORMS": "0",
                "rack_positions-INITIAL_FORMS": "0",
                "rack_positions-MIN_NUM_FORMS": "0",
                "rack_positions-MAX_NUM_FORMS": "1000",
                "project_tasks-TOTAL_FORMS": "0",
                "project_tasks-INITIAL_FORMS": "0",
                "project_tasks-MIN_NUM_FORMS": "0",
                "project_tasks-MAX_NUM_FORMS": "1000",
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 302)
        positions = {rp.position: rp for rp in project.rack_positions.all()}
        self.assertEqual(set(positions), {"RACK01", "RACK02", "RACK03"})
        self.assertEqual(positions["RACK01"].dh, "DH1")
        self.assertEqual(positions["RACK01"].links, 24)
        self.assertEqual(positions["RACK01"].utp, 48)
        self.assertEqual(positions["RACK02"].links, 12)
        self.assertEqual(positions["RACK03"].links, 0)

    def test_bulk_rack_positions_requires_has_rack_positions_enabled(self):
        admin_user = User.objects.create_superuser(
            username="rack_bulk_admin2",
            email="rack-bulk2@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        project = Project.objects.create(company=company, name="Projeto Sem Rack")
        self.client.force_login(admin_user)

        response = self.client.post(
            f"/admin/projects/project/{project.pk}/change/",
            {
                "company": str(company.pk),
                "name": project.name,
                "status": Project.STATUS_PLANNING,
                "is_active": "on",
                "bulk_rack_positions": "RACK01",
                "rack_positions-TOTAL_FORMS": "0",
                "rack_positions-INITIAL_FORMS": "0",
                "rack_positions-MIN_NUM_FORMS": "0",
                "rack_positions-MAX_NUM_FORMS": "1000",
                "project_tasks-TOTAL_FORMS": "0",
                "project_tasks-INITIAL_FORMS": "0",
                "project_tasks-MIN_NUM_FORMS": "0",
                "project_tasks-MAX_NUM_FORMS": "1000",
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(project.rack_positions.exists())

    def test_rack_positions_must_belong_to_same_project(self):
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        project_a = Project.objects.create(company=company, name="Projeto A", has_rack_positions=True)
        project_b = Project.objects.create(company=company, name="Projeto B", has_rack_positions=True)
        rack_position_a = RackPosition.objects.create(project=project_a, position="RACK-A")
        rack_position_b = RackPosition.objects.create(project=project_b, position="RACK-B")
        task = Task.objects.create(name="Instalação")
        project_task = ProjectTask.objects.create(project=project_a, task=task)

        with self.assertRaises(ValidationError):
            project_task.validate_rack_positions([rack_position_a, rack_position_b])

        # Não levanta erro quando todos pertencem ao projeto da tarefa.
        project_task.validate_rack_positions([rack_position_a])

    def test_bulk_task_action_assigns_multiple_rack_positions(self):
        """A tarefa pode ser alocada em vários Rack Positions ao mesmo
        tempo (M2M), não só um."""
        admin_user = User.objects.create_superuser(
            username="rack_task_admin",
            email="rack-task@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        project = Project.objects.create(company=company, name="Projeto Rack Tarefas", has_rack_positions=True)
        rack_position_1 = RackPosition.objects.create(project=project, position="RACK01")
        rack_position_2 = RackPosition.objects.create(project=project, position="RACK02")
        task = Task.objects.create(name="Lançamento de Cabos")
        project_task = ProjectTask.objects.create(project=project, task=task, order=1)
        self.client.force_login(admin_user)

        response = self.client.post(
            f"/admin/projects/project/{project.pk}/change/",
            {
                "company": str(company.pk),
                "name": project.name,
                "status": Project.STATUS_PLANNING,
                "is_active": "on",
                "has_rack_positions": "on",
                "bulk_task_action": "update",
                "bulk_tasks": [str(project_task.pk)],
                "bulk_task_rack_positions": [str(rack_position_1.pk), str(rack_position_2.pk)],
                "rack_positions-TOTAL_FORMS": "0",
                "rack_positions-INITIAL_FORMS": "0",
                "rack_positions-MIN_NUM_FORMS": "0",
                "rack_positions-MAX_NUM_FORMS": "1000",
                "project_tasks-TOTAL_FORMS": "1",
                "project_tasks-INITIAL_FORMS": "1",
                "project_tasks-MIN_NUM_FORMS": "0",
                "project_tasks-MAX_NUM_FORMS": "1000",
                "project_tasks-0-id": str(project_task.pk),
                "project_tasks-0-task": str(task.pk),
                "project_tasks-0-order": "1",
                "project_tasks-0-status": ProjectTask.STATUS_NOT_STARTED,
                "project_tasks-0-estimated_hours": "0.00",
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 302)
        project_task.refresh_from_db()
        self.assertQuerySetEqual(
            project_task.rack_positions.order_by("position"), [rack_position_1, rack_position_2]
        )

    def test_admin_add_with_blank_link_count_defaults_to_zero(self):
        """Regressão: link_count é opcional no formulário (blank=True) mas a
        coluna não aceita NULL — deixar em branco não pode gerar
        IntegrityError, deve cair para 0."""
        admin_user = User.objects.create_superuser(
            username="link_count_admin",
            email="link-count@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.client.force_login(admin_user)

        response = self.client.post(
            "/admin/projects/project/add/",
            {
                "company": str(company.pk),
                "name": "Projeto Sem Quantidade de Links",
                "link_count": "",
                "status": Project.STATUS_PLANNING,
                "is_active": "on",
                "rack_positions-TOTAL_FORMS": "0",
                "rack_positions-INITIAL_FORMS": "0",
                "rack_positions-MIN_NUM_FORMS": "0",
                "rack_positions-MAX_NUM_FORMS": "1000",
                "project_tasks-TOTAL_FORMS": "0",
                "project_tasks-INITIAL_FORMS": "0",
                "project_tasks-MIN_NUM_FORMS": "0",
                "project_tasks-MAX_NUM_FORMS": "1000",
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 302)
        project = Project.objects.get(name="Projeto Sem Quantidade de Links")
        self.assertEqual(project.link_count, 0)

    def test_admin_add_rack_position_with_blank_links_utp_defaults_to_zero(self):
        """Regressão: mesmo caso de link_count, mas para RackPosition.links
        e RackPosition.utp preenchidos via inline do Projeto."""
        admin_user = User.objects.create_superuser(
            username="rack_blank_admin",
            email="rack-blank@example.com",
            password="test-password",
        )
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        project = Project.objects.create(company=company, name="Projeto Rack Vazio", has_rack_positions=True)
        self.client.force_login(admin_user)

        response = self.client.post(
            f"/admin/projects/project/{project.pk}/change/",
            {
                "company": str(company.pk),
                "name": project.name,
                "status": Project.STATUS_PLANNING,
                "is_active": "on",
                "has_rack_positions": "on",
                "rack_positions-TOTAL_FORMS": "1",
                "rack_positions-INITIAL_FORMS": "0",
                "rack_positions-MIN_NUM_FORMS": "0",
                "rack_positions-MAX_NUM_FORMS": "1000",
                "rack_positions-0-project": str(project.pk),
                "rack_positions-0-position": "RACKVAZIO",
                "rack_positions-0-dh": "",
                "rack_positions-0-links": "",
                "rack_positions-0-utp": "",
                "project_tasks-TOTAL_FORMS": "0",
                "project_tasks-INITIAL_FORMS": "0",
                "project_tasks-MIN_NUM_FORMS": "0",
                "project_tasks-MAX_NUM_FORMS": "1000",
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 302)
        rack_position = RackPosition.objects.get(project=project, position="RACKVAZIO")
        self.assertEqual(rack_position.links, 0)
        self.assertEqual(rack_position.utp, 0)

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils.translation import gettext, override
from django.utils import timezone
from django.urls import reverse
from django.db import IntegrityError, transaction
from users.models import User
from .models import Category, Client, Collaborator, Company, ConsultimerProjectType, JobTitle, Person, ProjectType, Responsible, Site, Task


def make_collaborator(company, name, **kwargs):
    person = Person.objects.create(name=name, company=company)
    return Collaborator.objects.create(person=person, **kwargs)


class UnfoldTranslationTests(TestCase):
    def test_global_unfold_messages_are_translated_to_brazilian_portuguese(self):
        with override("pt-br"):
            self.assertEqual(gettext("Type to search"), "Digite para pesquisar")
            self.assertEqual(gettext("No results found"), "Nenhum resultado encontrado")
            self.assertEqual(gettext("Apply Filters"), "Aplicar filtros")
            self.assertEqual(gettext("Select value"), "Selecione um valor")


class CompanyTests(TestCase):
    def test_company_uses_trade_name_as_label(self):
        company = Company.objects.create(legal_name="Empresa Teste Ltda", trade_name="Empresa Teste", tax_id="00.000.000/0001-00")
        self.assertEqual(str(company), "Empresa Teste")

    def test_health_check(self):
        response = self.client.get(reverse("health-check"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_site_code_is_unique_inside_client(self):
        company = Company.objects.create(legal_name="Empresa A", tax_id="11.111.111/0001-11")
        client = Client.objects.create(company=company, legal_name="Cliente A", tax_id="11.111.111/0002-11")
        Site.objects.create(client=client, code="SP", name="Sao Paulo")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Site.objects.create(client=client, code="SP", name="Outro site")

    def test_category_and_client_labels(self):
        company = Company.objects.create(legal_name="Empresa B", tax_id="22.222.222/0001-22")
        category = Category.objects.create(name="Implantacao")
        client = Client.objects.create(
            company=company,
            legal_name="Cliente Exemplo Ltda",
            trade_name="Cliente Exemplo",
            tax_id="33.333.333/0001-33",
        )
        self.assertEqual(str(category), "Implantacao")
        self.assertEqual(str(client), "Cliente Exemplo")

    def test_incomplete_records_can_be_saved(self):
        Company.objects.create()
        company = Company.objects.create()
        client = Client.objects.create(company=company)
        Site.objects.create(client=client)
        Site.objects.create(client=client)
        Category.objects.create()

    def test_collaborator_selects_registered_job_title(self):
        company = Company.objects.create(legal_name="Empresa C", tax_id="44.444.444/0001-44")
        job_title = JobTitle.objects.create(company=company, name="Analista")
        collaborator = make_collaborator(company, "Pessoa Teste", job_title=job_title)
        self.assertEqual(collaborator.job_title, job_title)
        self.assertEqual(str(collaborator.job_title), "Analista")

    def test_only_leadership_roles_are_available_as_managers(self):
        company = Company.objects.create(legal_name="Empresa D", tax_id="55.555.555/0001-55")
        manager_role = JobTitle.objects.create(company=company, name="Supervisor de Operacoes")
        regular_role = JobTitle.objects.create(company=company, name="Analista")
        manager = make_collaborator(company, "Gestor Teste", job_title=manager_role)
        make_collaborator(company, "Pessoa Regular", job_title=regular_role)

        manager_field = Collaborator._meta.get_field("manager")
        eligible_managers = Collaborator.objects.complex_filter(manager_field.get_limit_choices_to())
        self.assertQuerySetEqual(eligible_managers, [manager])

    def test_manager_must_belong_to_same_company(self):
        company_a = Company.objects.create(legal_name="Empresa E", tax_id="66.666.666/0001-66")
        company_b = Company.objects.create(legal_name="Empresa F", tax_id="77.777.777/0001-77")
        role = JobTitle.objects.create(company=company_b, name="Gerente")
        manager = make_collaborator(company_b, "Gestor Externo", job_title=role)
        person = Person.objects.create(name="Pessoa Teste", company=company_a)
        collaborator = Collaborator(person=person, manager=manager)
        with self.assertRaises(ValidationError):
            collaborator.full_clean()

    def test_responsible_links_to_user_from_same_company(self):
        company = Company.objects.create(legal_name="Empresa G", tax_id="88.888.888/0001-88")
        user = User.objects.create_user(username="responsavel", email="responsavel@example.com", company=company)
        person = Person(company=company, name="Responsavel Teste", user=user)
        person.full_clean()
        person.save()
        responsible = Responsible.objects.create(person=person)
        self.assertEqual(responsible.person.user, user)

    def test_responsible_rejects_user_from_another_company(self):
        company_a = Company.objects.create(legal_name="Empresa H", tax_id="99.999.999/0001-99")
        company_b = Company.objects.create(legal_name="Empresa I", tax_id="10.000.000/0001-10")
        user = User.objects.create_user(username="outra_empresa", email="outra@example.com", company=company_b)
        person = Person(company=company_a, user=user)
        with self.assertRaises(ValidationError):
            person.full_clean()

    def test_project_types_can_be_created_in_bulk_through_admin(self):
        admin_user = User.objects.create_superuser(username="bulk_admin", email="bulk@example.com", password="test-password")
        self.client.force_login(admin_user)
        response = self.client.post(
            "/admin/core/projecttype/add/",
            {
                "name": "",
                "bulk_names": "AZNG\nBLOCO\nBRICK",
                "description": "",
                "is_active": "on",
                "_save": "Salvar",
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertQuerySetEqual(ProjectType.objects.order_by("name").values_list("name", flat=True), ["AZNG", "BLOCO", "BRICK"])

    def test_project_type_list_has_explicit_edit_link(self):
        admin_user = User.objects.create_superuser(username="edit_admin", email="edit@example.com", password="test-password")
        project_type = ProjectType.objects.create(name="TURNKEY")
        self.client.force_login(admin_user)
        response = self.client.get("/admin/core/projecttype/")
        self.assertContains(response, f'/admin/core/projecttype/{project_type.pk}/change/')
        self.assertContains(response, "Editar")

    def test_admin_lists_allow_selecting_page_size(self):
        admin_user = User.objects.create_superuser(username="page_admin", email="page@example.com", password="test-password")
        ProjectType.objects.bulk_create(ProjectType(name=f"Tipo {index:02d}") for index in range(12))
        self.client.force_login(admin_user)

        default_response = self.client.get("/admin/core/projecttype/")
        self.assertEqual(len(default_response.context["cl"].result_list), 10)
        self.assertContains(default_response, "Por Página")

        fifty_response = self.client.get("/admin/core/projecttype/?per_page=50")
        self.assertEqual(len(fifty_response.context["cl"].result_list), 12)

        all_response = self.client.get("/admin/core/projecttype/?per_page=all")
        self.assertEqual(len(all_response.context["cl"].result_list), 12)

    def test_task_codes_are_generated_sequentially_per_year(self):
        first = Task.objects.create(name="Primeira tarefa")
        second = Task.objects.create(name="Segunda tarefa")
        year = timezone.localdate().year
        self.assertEqual(first.code, f"CSTR-TASK-{year}0001")
        self.assertEqual(second.code, f"CSTR-TASK-{year}0002")

    def test_tasks_can_be_created_in_bulk_with_sequential_codes(self):
        admin_user = User.objects.create_superuser(username="task_admin", email="task_admin@example.com", password="test-password")
        project_type = ProjectType.objects.create(name="FITOUT")
        self.client.force_login(admin_user)
        response = self.client.post(
            "/admin/core/task/add/",
            {
                "name": "",
                "bulk_names": "Levantamento\nInstalacao\nValidacao",
                "description": "Etapa padrao",
                "estimated_hours": "8.00",
                "project_types": [str(project_type.pk)],
                "is_active": "on",
                "_save": "Salvar",
            },
        )
        self.assertEqual(response.status_code, 302)
        tasks = list(Task.objects.order_by("code"))
        year = timezone.localdate().year
        self.assertEqual([task.code for task in tasks], [f"CSTR-TASK-{year}0001", f"CSTR-TASK-{year}0002", f"CSTR-TASK-{year}0003"])
        self.assertTrue(all(task.project_types.filter(pk=project_type.pk).exists() for task in tasks))

    def test_task_list_displays_linked_project_types(self):
        admin_user = User.objects.create_superuser(username="task_list_admin", email="task_list@example.com", password="test-password")
        project_type = ProjectType.objects.create(name="BRICK ML")
        task = Task.objects.create(name="Conexao Brick")
        task.project_types.add(project_type)
        self.client.force_login(admin_user)
        response = self.client.get("/admin/core/task/")
        self.assertContains(response, "BRICK ML")
        self.assertContains(response, "Tipos de Projeto")
        self.assertContains(response, f'/admin/core/task/{task.pk}/change/')
        self.assertContains(response, "Editar")


class ClientIpAndLockoutTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.user = User.objects.create_user(username="lock_target", email="lock@example.com", password="certa-123")

    def _login(self, password, ip, **extra):
        return self.client.post(
            "/api/token/",
            {"username": "lock_target", "password": password},
            content_type="application/json",
            REMOTE_ADDR=ip,
            **extra,
        )

    def test_cf_header_ignored_when_not_from_trusted_proxy(self):
        from django.test import RequestFactory, override_settings
        from core.client_ip import get_client_ip
        request = RequestFactory().get("/", REMOTE_ADDR="10.0.0.5", HTTP_CF_CONNECTING_IP="1.2.3.4")
        with override_settings(TRUSTED_PROXY_IPS=set()):
            self.assertEqual(get_client_ip(request), "10.0.0.5")
        with override_settings(TRUSTED_PROXY_IPS={"10.0.0.5"}):
            self.assertEqual(get_client_ip(request), "1.2.3.4")

    def test_invalid_cf_header_falls_back_to_remote_addr(self):
        from django.test import RequestFactory, override_settings
        from core.client_ip import get_client_ip
        request = RequestFactory().get("/", REMOTE_ADDR="10.0.0.5", HTTP_CF_CONNECTING_IP="nao-e-ip")
        with override_settings(TRUSTED_PROXY_IPS={"10.0.0.5"}):
            self.assertEqual(get_client_ip(request), "10.0.0.5")

    def test_lockout_is_per_username_and_ip_pair(self):
        from unittest import mock
        from api.auth_views import ClientIpScopedRateThrottle
        with mock.patch.object(ClientIpScopedRateThrottle, "THROTTLE_RATES", {"login": "1000/min"}):
            for _ in range(5):
                self._login("errada", "203.0.113.10")
            self.assertNotEqual(self._login("certa-123", "203.0.113.10").status_code, 200)
            self.assertEqual(self._login("certa-123", "198.51.100.20").status_code, 200)


class ClientNumberTests(TestCase):
    def test_client_number_is_sequential_starting_at_001(self):
        company = Company.objects.create(legal_name="Empresa", trade_name="Empresa")
        first = Client.objects.create(company=company, trade_name="A")
        second = Client.objects.create(company=company, trade_name="B")
        self.assertEqual(first.number_code, "001")
        self.assertEqual(second.number_code, "002")


class ConsultimerProjectTypeTests(TestCase):
    def test_code_is_normalized_to_uppercase(self):
        item = ConsultimerProjectType.objects.create(name="Deployment", code=" dp ")
        self.assertEqual(item.code, "DP")



class EmailLanguageTests(TestCase):
    def test_normalize_language_accepts_locales_and_defaults_to_portuguese(self):
        from core.emailing import normalize_language

        self.assertEqual(normalize_language("en-US"), "en")
        self.assertEqual(normalize_language("ES"), "es")
        self.assertEqual(normalize_language("pt-BR"), "pt")
        self.assertEqual(normalize_language(None), "pt")
        self.assertEqual(normalize_language("fr"), "pt")

    def test_html_email_uses_selected_language_footer_and_inline_logo(self):
        from core.emailing import build_email, render_html

        html = render_html(title="Teste", lang="en")
        self.assertIn("Consultimer Group", html)
        self.assertIn("project management system", html)
        message = build_email(subject="s", to=["a@b.com"], text="t", html=html)
        self.assertEqual(message.alternatives[0][1], "text/html")
        self.assertTrue(any(part.get("Content-ID") == "<consultimer-logo>" for part in message.attachments))

    def test_password_reset_email_is_always_english(self):
        from django.core import mail

        company = Company.objects.create(legal_name="Empresa", trade_name="Empresa")
        User.objects.create_user(username="reset", email="reset@example.com", password="x")
        response = self.client.post("/api/password-reset/request/", {"email": "reset@example.com"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, "Consultimer · Password reset")
        self.assertIn("Reset password", mail.outbox[0].alternatives[0][0])


class ProjectUpdateEmailContentTests(TestCase):
    def test_subject_has_site_and_project_and_observations_come_from_occurrences(self):
        from datetime import date

        from projects.models import Project, ProjectOccurrence
        from updates.models import ProjectDailyUpdate
        from updates.project_client_mail import build_project_update_message

        company = Company.objects.create(legal_name="Empresa", trade_name="Empresa")
        client = Client.objects.create(company=company, trade_name="Cliente")
        site = Site.objects.create(client=client, name="Site 65", code="GRU65")
        project = Project.objects.create(company=company, name="Projeto X", client=client, site=site)
        ProjectOccurrence.objects.create(project=project, title="Falta de acesso", description="Porta trancada", occurred_at=date(2026, 10, 4))
        ProjectOccurrence.objects.create(
            project=project, title="Cancelada", status=ProjectOccurrence.STATUS_CANCELED, occurred_at=date(2026, 10, 4)
        )
        update = ProjectDailyUpdate.objects.create(project=project, date=date(2026, 10, 4))

        message = build_project_update_message(update, "a@b.com", b"pdf", "x.pdf", "pt")

        self.assertEqual(message.subject, "Atualização de Projeto | GRU65 | Projeto X")
        html = message.alternatives[0][0]
        self.assertIn("Atualização de Projeto", html)
        self.assertIn("Falta de acesso", html)
        self.assertIn("Porta trancada", html)
        self.assertNotIn("Cancelada", html)
        self.assertNotIn("Atividades executadas", html)


class SupervisorProjectScopeTests(TestCase):
    def test_supervisor_only_sees_projects_where_is_responsible_cstr(self):
        from core.collaborator_scope import scope_supervisor_projects
        from core.models import Responsible
        from projects.models import Project

        company = Company.objects.create(legal_name="Empresa", trade_name="Empresa")
        title = JobTitle.objects.create(company=company, name="Supervisor de Campo")
        user = User.objects.create_user(username="sup", password="x")
        person = Person.objects.create(name="Sup", company=company, user=user)
        Collaborator.objects.create(person=person, job_title=title)
        own = Responsible.objects.create(person=person, kind=Responsible.KIND_CSTR)
        other = Responsible.objects.create(person=Person.objects.create(name="Outro", company=company), kind=Responsible.KIND_CSTR)
        mine = Project.objects.create(company=company, name="Meu", responsible_cstr=own)
        Project.objects.create(company=company, name="Alheio", responsible_cstr=other)
        Project.objects.create(company=company, name="Sem responsavel")

        visible = scope_supervisor_projects(Project.objects.all(), user)
        self.assertEqual(list(visible), [mine])

        admin = User.objects.create_superuser(username="adm", password="x", email="a@b.com")
        self.assertEqual(scope_supervisor_projects(Project.objects.all(), admin).count(), 3)

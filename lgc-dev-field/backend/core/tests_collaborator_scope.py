from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIClient

from core.collaborator_scope import managed_collaborator_ids, scope_collaborators
from core.models import Collaborator, Company, JobTitle, Person

User = get_user_model()


class CollaboratorScopeTests(TestCase):
    """Supervisor só enxerga os colaboradores sob a sua gestão; coordenador,
    gerente, administradores e demais cargos não sofrem a restrição."""

    def setUp(self):
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.titles = {
            name: JobTitle.objects.create(company=self.company, name=name)
            for name in ("Supervisor de Infraestrutura de Redes", "Coordenador de Projetos", "Gerente", "Instalador de Redes Jr")
        }
        self.manager = self.make("Gerente Geral", "Gerente")
        self.supervisor = self.make("Super A", "Supervisor de Infraestrutura de Redes", manager=self.manager)
        self.other_supervisor = self.make("Super B", "Supervisor de Infraestrutura de Redes", manager=self.manager)
        self.tech_a1 = self.make("Tec A1", "Instalador de Redes Jr", manager=self.supervisor)
        self.tech_a2 = self.make("Tec A2", "Instalador de Redes Jr", manager=self.supervisor)
        self.tech_b1 = self.make("Tec B1", "Instalador de Redes Jr", manager=self.other_supervisor)
        self.coordinator = self.make("Coord", "Coordenador de Projetos")

    def make(self, name, title, manager=None):
        person = Person.objects.create(name=name, company=self.company)
        return Collaborator.objects.create(person=person, job_title=self.titles[title], manager=manager)

    def login_as(self, collaborator, **user_kwargs):
        user = User.objects.create_user(
            username=collaborator.person.name.lower().replace(" ", "."),
            email=f"{collaborator.pk}@x.com",
            password="x",
            **user_kwargs,
        )
        collaborator.person.user = user
        collaborator.person.save(update_fields=["user"])
        return User.objects.get(pk=user.pk)

    def test_supervisor_sees_self_and_own_team_only(self):
        user = self.login_as(self.supervisor)
        self.assertEqual(
            managed_collaborator_ids(user),
            {self.supervisor.pk, self.tech_a1.pk, self.tech_a2.pk},
        )

    def test_indirect_reports_are_included(self):
        # um supervisor que gerencia outro supervisor enxerga a equipe dele também
        self.other_supervisor.manager = self.supervisor
        self.other_supervisor.save()
        user = self.login_as(self.supervisor)
        self.assertIn(self.tech_b1.pk, managed_collaborator_ids(user))

    def test_coordinator_manager_staff_and_admin_are_not_restricted(self):
        self.assertIsNone(managed_collaborator_ids(self.login_as(self.coordinator)))
        self.assertIsNone(managed_collaborator_ids(self.login_as(self.manager)))
        staff_supervisor = self.login_as(self.other_supervisor, is_staff=True)
        self.assertIsNone(managed_collaborator_ids(staff_supervisor))
        self.assertIsNone(managed_collaborator_ids(User.objects.create_superuser("root", "r@x.com", "x")))

    def test_technician_without_team_is_not_restricted_by_this_rule(self):
        self.assertIsNone(managed_collaborator_ids(self.login_as(self.tech_a1)))

    def test_scope_collaborators_filters_queryset(self):
        user = self.login_as(self.supervisor)
        names = set(scope_collaborators(Collaborator.objects.all(), user).values_list("person__name", flat=True))
        self.assertEqual(names, {"Super A", "Tec A1", "Tec A2"})

    def test_collaborators_endpoint_is_scoped(self):
        user = self.login_as(self.supervisor)
        user.user_permissions.add(Permission.objects.get(codename="view_collaborator"))
        client = APIClient()
        client.force_authenticate(User.objects.get(pk=user.pk))
        response = client.get("/api/collaborators/?page_size=500")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual({r["name"] for r in response.data["results"]}, {"Super A", "Tec A1", "Tec A2"})

        coordinator = self.login_as(self.coordinator)
        coordinator.user_permissions.add(Permission.objects.get(codename="view_collaborator"))
        client.force_authenticate(User.objects.get(pk=coordinator.pk))
        everyone = client.get("/api/collaborators/?page_size=500")
        self.assertEqual(len(everyone.data["results"]), Collaborator.objects.filter(is_active=True).count())


class RegistryScreenPermissionTests(TestCase):
    """A tela Cadastros Gerais tem permissão própria, separada das view_*."""

    def test_permission_exists_and_is_not_in_gestores_defaults(self):
        perm = Permission.objects.get(codename="access_registry_screen")
        self.assertEqual(perm.content_type.app_label, "core")
        from django.contrib.auth.models import Group

        gestores = Group.objects.create(name="Gestores teste")
        gestores.permissions.add(Permission.objects.get(content_type__app_label="core", codename="view_site"))
        user = User.objects.create_user(username="g", email="g@x.com", password="x")
        user.groups.add(gestores)
        user = User.objects.get(pk=user.pk)
        self.assertTrue(user.has_perm("core.view_site"))  # continua lendo os dados
        self.assertFalse(user.has_perm("core.access_registry_screen"))  # mas sem a tela

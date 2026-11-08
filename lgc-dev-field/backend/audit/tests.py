from django.test import TestCase

from core.models import Company
from users.models import User
from .models import AuditLog


class AuditLogTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username="audit_admin",
            email="audit@example.com",
            password="test-password",
        )
        self.company = Company.objects.create(legal_name="Empresa Auditada", trade_name="Nome Antigo")
        AuditLog.objects.all().delete()
        self.client.force_login(self.admin)

    def test_admin_change_records_actor_origin_field_and_values(self):
        response = self.client.post(
            f"/admin/core/company/{self.company.pk}/change/",
            {
                "legal_name": self.company.legal_name,
                "trade_name": "Nome Novo",
                "tax_id": "",
                "email": "",
                "phone": "",
                "is_active": "on",
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 302)
        log = AuditLog.objects.get(action=AuditLog.ACTION_UPDATE, field_name="trade_name")
        self.assertEqual(log.actor, self.admin)
        self.assertEqual(log.old_value, "Nome Antigo")
        self.assertEqual(log.new_value, "Nome Novo")
        self.assertEqual(log.origin, "Django Admin")
        self.assertEqual(log.object_pk, str(self.company.pk))

    def test_password_change_is_logged_without_exposing_hashes(self):
        AuditLog.objects.all().delete()
        self.admin.set_password("new-test-password")
        self.admin.save(update_fields=("password",))

        log = AuditLog.objects.get(action=AuditLog.ACTION_UPDATE, field_name="password")
        self.assertEqual(log.old_value, "[conteúdo protegido]")
        self.assertEqual(log.new_value, "[conteúdo protegido]")
        self.assertNotIn("pbkdf2", log.old_value + log.new_value)

    def test_audit_logs_cannot_be_changed_or_deleted_in_admin(self):
        self.company.trade_name = "Outro Nome"
        self.company.save()
        log = AuditLog.objects.filter(action=AuditLog.ACTION_UPDATE).first()

        change_response = self.client.post(
            f"/admin/audit/auditlog/{log.pk}/change/",
            {"object_repr": "Tentativa de alteração", "_save": "Salvar"},
        )
        delete_response = self.client.get(f"/admin/audit/auditlog/{log.pk}/delete/")

        self.assertIn(change_response.status_code, (302, 403))
        self.assertEqual(delete_response.status_code, 403)
        log.refresh_from_db()
        self.assertNotEqual(log.object_repr, "Tentativa de alteração")

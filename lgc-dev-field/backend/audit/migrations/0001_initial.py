from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="AuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True, verbose_name="data e hora")),
                ("app_label", models.CharField(db_index=True, max_length=100, verbose_name="aplicação")),
                ("model_name", models.CharField(db_index=True, max_length=100, verbose_name="cadastro")),
                ("object_pk", models.CharField(blank=True, db_index=True, max_length=255, verbose_name="ID do registro")),
                ("object_repr", models.CharField(blank=True, max_length=500, verbose_name="registro")),
                ("action", models.CharField(choices=[("create", "Inclusão"), ("update", "Alteração"), ("delete", "Exclusão"), ("m2m_add", "Vínculo adicionado"), ("m2m_remove", "Vínculo removido"), ("m2m_clear", "Vínculos removidos"), ("export", "Exportação")], db_index=True, max_length=20, verbose_name="ação")),
                ("field_name", models.CharField(blank=True, max_length=150, verbose_name="campo")),
                ("old_value", models.TextField(blank=True, verbose_name="valor anterior")),
                ("new_value", models.TextField(blank=True, verbose_name="novo valor")),
                ("origin", models.CharField(blank=True, max_length=50, verbose_name="origem")),
                ("path", models.CharField(blank=True, max_length=500, verbose_name="caminho")),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True, verbose_name="endereço IP")),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_logs", to=settings.AUTH_USER_MODEL, verbose_name="usuário")),
            ],
            options={"verbose_name": "Log de Auditoria", "verbose_name_plural": "Logs de Auditoria", "ordering": ("-created_at", "-id")},
        ),
    ]

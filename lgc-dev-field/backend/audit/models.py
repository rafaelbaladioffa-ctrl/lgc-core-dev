from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    ACTION_CREATE = "create"
    ACTION_UPDATE = "update"
    ACTION_DELETE = "delete"
    ACTION_M2M_ADD = "m2m_add"
    ACTION_M2M_REMOVE = "m2m_remove"
    ACTION_M2M_CLEAR = "m2m_clear"
    ACTION_EXPORT = "export"
    ACTION_CHOICES = (
        (ACTION_CREATE, "Inclusão"),
        (ACTION_UPDATE, "Alteração"),
        (ACTION_DELETE, "Exclusão"),
        (ACTION_M2M_ADD, "Vínculo adicionado"),
        (ACTION_M2M_REMOVE, "Vínculo removido"),
        (ACTION_M2M_CLEAR, "Vínculos removidos"),
        (ACTION_EXPORT, "Exportação"),
    )

    created_at = models.DateTimeField("data e hora", auto_now_add=True, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="usuário",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    app_label = models.CharField("aplicação", max_length=100, db_index=True)
    model_name = models.CharField("cadastro", max_length=100, db_index=True)
    object_pk = models.CharField("ID do registro", max_length=255, blank=True, db_index=True)
    object_repr = models.CharField("registro", max_length=500, blank=True)
    action = models.CharField("ação", max_length=20, choices=ACTION_CHOICES, db_index=True)
    field_name = models.CharField("campo", max_length=150, blank=True)
    old_value = models.TextField("valor anterior", blank=True)
    new_value = models.TextField("novo valor", blank=True)
    origin = models.CharField("origem", max_length=50, blank=True)
    path = models.CharField("caminho", max_length=500, blank=True)
    ip_address = models.GenericIPAddressField("endereço IP", null=True, blank=True)

    class Meta:
        verbose_name = "Log de Auditoria"
        verbose_name_plural = "Logs de Auditoria"
        ordering = ("-created_at", "-id")

    def __str__(self):
        return f"{self.get_action_display()} — {self.object_repr or self.object_pk}"

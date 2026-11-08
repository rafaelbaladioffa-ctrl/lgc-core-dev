from django.db import models


class AxisInboxEvent(models.Model):
    """Evento recebido do Axis Core por `POST /api/v1/webhooks/axis`.

    `event_id` único é a deduplicação: o Core reentrega até confirmar, então o mesmo evento pode chegar
    mais de uma vez. Só `failed` é reprocessado numa nova entrega."""

    STATUS_PROCESSED = "processed"
    STATUS_IGNORED = "ignored"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = (
        (STATUS_PROCESSED, "Processado"),
        (STATUS_IGNORED, "Ignorado"),
        (STATUS_FAILED, "Falhou"),
    )

    event_id = models.UUIDField("id do evento", unique=True)
    event_type = models.CharField("tipo", max_length=100)
    occurred_at = models.DateTimeField("ocorrido em")
    payload = models.JSONField("conteúdo", default=dict)
    status = models.CharField("situação", max_length=10, choices=STATUS_CHOICES)
    note = models.CharField("observação", max_length=500, blank=True)
    attempts = models.PositiveIntegerField("tentativas", default=1)
    received_at = models.DateTimeField("recebido em", auto_now_add=True)
    processed_at = models.DateTimeField("processado em", null=True, blank=True)

    class Meta:
        verbose_name = "evento do Axis"
        verbose_name_plural = "eventos do Axis"
        ordering = ("-received_at",)
        indexes = [models.Index(fields=("event_type", "-received_at"))]

    def __str__(self):
        return f"{self.event_type} {self.event_id}"


class AxisMasterRecord(models.Model):
    """Cache do cadastro do Core, com ou sem par no Field.

    Guarda tudo o que o Core mandou (mesclando eventos parciais) para que o registro sem par apareça no
    relatório de `axis_sync` e possa ser casado depois, sem nova chamada ao Core. O vínculo em si fica nos
    campos `axis_*_id` dos modelos do Field."""

    KIND_CLIENT = "client"
    KIND_COLLABORATOR = "collaborator"
    KIND_USER = "user"
    KIND_PROJECT = "project"
    KIND_COST_CENTER = "cost_center"
    KIND_SITE = "site"
    KIND_CHOICES = (
        (KIND_CLIENT, "Cliente"),
        (KIND_COLLABORATOR, "Colaborador"),
        (KIND_USER, "Usuário"),
        (KIND_PROJECT, "Projeto"),
        (KIND_COST_CENTER, "Centro de custo"),
        (KIND_SITE, "Site"),
    )

    kind = models.CharField("tipo", max_length=20, choices=KIND_CHOICES)
    axis_id = models.UUIDField("id no Axis")
    code = models.CharField("código", max_length=100, blank=True)
    name = models.CharField("nome", max_length=255, blank=True)
    active = models.BooleanField("ativo", default=True)
    data = models.JSONField("dados", default=dict)
    source_occurred_at = models.DateTimeField(
        "ocorrência do último evento", null=True, blank=True,
        help_text="Evento mais antigo que este não sobrescreve o cache (entrega fora de ordem).",
    )
    synced_at = models.DateTimeField("atualizado em", auto_now=True)

    class Meta:
        verbose_name = "cadastro do Axis"
        verbose_name_plural = "cadastros do Axis"
        ordering = ("kind", "name")
        constraints = [models.UniqueConstraint(fields=("kind", "axis_id"), name="unique_axis_master_record")]

    def __str__(self):
        return f"{self.kind} {self.code or self.axis_id} {self.name}".strip()

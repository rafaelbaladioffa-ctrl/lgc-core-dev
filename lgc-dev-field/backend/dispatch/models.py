from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from core.models import Collaborator, TimestampedModel


class TechnicianDailyPresence(TimestampedModel):
    """Status de presença do técnico no site, por dia — separado do cadastro
    do Collaborator (que é permanente) porque esse estado é efêmero e reseta
    a cada dia. STATUS_IN_PROGRESS é definido automaticamente pelo sistema
    (não pelo dropdown do técnico) sempre que ele inicia uma ProjectTask —
    ver MyTaskViewSet._sync_presence_with_task em api/views.py — e volta pra
    STATUS_AVAILABLE quando ele pausa/finaliza sem iniciar outra em seguida."""

    STATUS_NOT_STARTED = "not_started"
    STATUS_AVAILABLE = "available"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_LUNCH = "lunch"
    STATUS_PERSONAL = "personal"
    STATUS_MEAL = "meal"
    STATUS_MEETING = "meeting"
    STATUS_TRAVELING = "traveling"
    STATUS_SUPPORT = "support"
    STATUS_SITE_BLOCKED = "site_blocked"
    STATUS_AWAITING_RELEASE = "awaiting_release"
    STATUS_OFF_DUTY = "off_duty"
    STATUS_CHOICES = (
        (STATUS_NOT_STARTED, "Indisponível"),
        (STATUS_AVAILABLE, "Disponível"),
        (STATUS_IN_PROGRESS, "Em Execução"),
        (STATUS_LUNCH, "Horário de Almoço"),
        (STATUS_PERSONAL, "Particular"),
        (STATUS_MEAL, "Café"),
        (STATUS_MEETING, "Reunião"),
        (STATUS_TRAVELING, "Em Deslocamento"),
        (STATUS_SUPPORT, "Apoio a outro técnico"),
        (STATUS_SITE_BLOCKED, "Sem Acesso ao Site"),
        (STATUS_AWAITING_RELEASE, "Aguardando Liberações"),
        (STATUS_OFF_DUTY, "Fim de Expediente"),
    )
    # Estados que o técnico pode escolher livremente pelo dropdown (antes do
    # primeiro deles, só existe STATUS_NOT_STARTED; o primeiro que ele
    # escolher já funciona como o check-in — ver TechnicianPresenceViewSet.
    # set_status). Reabre normalmente mesmo depois de STATUS_OFF_DUTY —
    # escolher qualquer um de novo (ex: Disponível) volta a contar o dia.
    # STATUS_IN_PROGRESS fica de fora de propósito: só o sistema pode setar.
    SELECTABLE_STATUSES = (
        STATUS_AVAILABLE,
        STATUS_LUNCH,
        STATUS_PERSONAL,
        STATUS_MEAL,
        STATUS_MEETING,
        STATUS_TRAVELING,
        STATUS_SUPPORT,
        STATUS_SITE_BLOCKED,
        STATUS_AWAITING_RELEASE,
        STATUS_OFF_DUTY,
    )

    # Classificação de produtividade do status de PRESENÇA — não confundir
    # com "produtivo" de verdade, que é derivado de ter uma ProjectTask
    # in_progress (ver dispatch touchpoints em api/operations.py). Isso aqui
    # só serve pra separar, dentro do tempo em que o técnico NÃO está
    # executando tarefa, o que é tempo ocioso "cobrável" (improdutivo) do
    # que é pausa do próprio técnico (neutro, não entra na conta de
    # nenhum dos dois lados).
    PRODUCTIVITY_UNPRODUCTIVE = "unproductive"
    PRODUCTIVITY_NEUTRAL = "neutral"
    PRODUCTIVITY_PRODUCTIVE = "productive"
    PRESENCE_PRODUCTIVITY = {
        STATUS_AVAILABLE: PRODUCTIVITY_UNPRODUCTIVE,
        STATUS_SITE_BLOCKED: PRODUCTIVITY_UNPRODUCTIVE,
        STATUS_AWAITING_RELEASE: PRODUCTIVITY_UNPRODUCTIVE,
        STATUS_LUNCH: PRODUCTIVITY_NEUTRAL,
        STATUS_PERSONAL: PRODUCTIVITY_NEUTRAL,
        STATUS_MEAL: PRODUCTIVITY_NEUTRAL,
        STATUS_MEETING: PRODUCTIVITY_NEUTRAL,
        STATUS_TRAVELING: PRODUCTIVITY_NEUTRAL,
        # Apoio a outro técnico é trabalho: conta como tempo produtivo, igual
        # a "Em Execução" (ver PRODUCTIVE_STATUSES em api/reports.py).
        STATUS_SUPPORT: PRODUCTIVITY_PRODUCTIVE,
    }

    # Jornada padrão usada nos relatórios de utilização — fixa, não é
    # calculada a partir de checked_in_at/checked_out_at (o técnico pode
    # esquecer de marcar Fim de Expediente, ou sair e voltar várias vezes
    # no dia, o que distorceria a duração real).
    STANDARD_WORKDAY_HOURS = 8

    collaborator = models.ForeignKey(
        Collaborator, verbose_name="técnico", on_delete=models.CASCADE, related_name="daily_presences"
    )
    date = models.DateField("data", default=timezone.localdate)
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_NOT_STARTED)
    checked_in_at = models.DateTimeField("check-in em", null=True, blank=True)
    checked_out_at = models.DateTimeField("encerrado em", null=True, blank=True)

    class Meta:
        verbose_name = "Presença do Técnico"
        verbose_name_plural = "Presenças dos Técnicos"
        ordering = ("-date", "collaborator__person__name")
        constraints = [
            models.UniqueConstraint(fields=("collaborator", "date"), name="unique_presence_per_day")
        ]

    def __str__(self):
        return f"{self.collaborator} — {self.date}"


class TechnicianStatusEvent(models.Model):
    """Registro histórico de cada troca de status de presença do técnico no
    dia — ao contrário de TechnicianDailyPresence (que só guarda o status
    ATUAL), isso permite reconstruir a timeline mostrando todas as trocas
    que aconteceram, não só a última."""

    collaborator = models.ForeignKey(
        Collaborator, verbose_name="técnico", on_delete=models.CASCADE, related_name="status_events"
    )
    date = models.DateField("data", default=timezone.localdate)
    status = models.CharField("status", max_length=20, choices=TechnicianDailyPresence.STATUS_CHOICES)
    changed_at = models.DateTimeField("alterado em", default=timezone.now)
    is_adjusted = models.BooleanField("ajustado pelo administrador", default=False)

    class Meta:
        verbose_name = "Troca de Status do Técnico"
        verbose_name_plural = "Trocas de Status dos Técnicos"
        ordering = ("changed_at",)

    def __str__(self):
        return f"{self.collaborator} — {self.get_status_display()} em {self.changed_at:%d/%m %H:%M}"


class TimelineAdjustment(models.Model):
    """Histórico dos ajustes administrativos da timeline (ver dispatch.adjustments):
    quem ajustou, quando, por quê, e o estado antes/depois."""

    KIND_EXECUTION = "execution"
    KIND_STATUS_WINDOW = "status_window"
    KIND_CHOICES = (
        (KIND_EXECUTION, "Execução de tarefa"),
        (KIND_STATUS_WINDOW, "Trecho de status"),
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="ajustado por", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    collaborator = models.ForeignKey(
        Collaborator, verbose_name="técnico", on_delete=models.CASCADE, related_name="timeline_adjustments"
    )
    date = models.DateField("data do ajuste")
    kind = models.CharField("tipo", max_length=20, choices=KIND_CHOICES)
    reason = models.TextField("motivo")
    before = models.JSONField("antes", default=dict, blank=True)
    after = models.JSONField("depois", default=dict, blank=True)
    created_at = models.DateTimeField("ajustado em", auto_now_add=True)

    class Meta:
        verbose_name = "Ajuste da Timeline"
        verbose_name_plural = "Ajustes da Timeline"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.get_kind_display()} — {self.collaborator} em {self.date:%d/%m/%Y}"


class CollaboratorPair(TimestampedModel):
    """Dupla fixa de trabalho — dois técnicos que sempre são despachados
    juntos e aparecem agrupados no board/timeline da Central de Operações.
    Um técnico só pode estar em UMA dupla ativa por vez (ver clean()); quem
    não tem dupla continua aparecendo normalmente, sozinho."""

    collaborator_a = models.ForeignKey(
        Collaborator, verbose_name="técnico A", on_delete=models.CASCADE, related_name="pair_as_a"
    )
    collaborator_b = models.ForeignKey(
        Collaborator, verbose_name="técnico B", on_delete=models.CASCADE, related_name="pair_as_b"
    )
    is_active = models.BooleanField("ativa", default=True)

    class Meta:
        verbose_name = "Dupla de Técnicos"
        verbose_name_plural = "Duplas de Técnicos"
        ordering = ("collaborator_a__person__name",)

    def __str__(self):
        return f"{self.collaborator_a} + {self.collaborator_b}"

    def clean(self):
        super().clean()
        if self.collaborator_a_id and self.collaborator_a_id == self.collaborator_b_id:
            raise ValidationError("Um técnico não pode formar dupla com ele mesmo.")
        if not self.is_active:
            return
        conflicting = CollaboratorPair.objects.filter(
            is_active=True, collaborator_a_id__in=(self.collaborator_a_id, self.collaborator_b_id)
        ) | CollaboratorPair.objects.filter(
            is_active=True, collaborator_b_id__in=(self.collaborator_a_id, self.collaborator_b_id)
        )
        if self.pk:
            conflicting = conflicting.exclude(pk=self.pk)
        if conflicting.exists():
            raise ValidationError("Um dos técnicos já está em outra dupla ativa.")


class TechnicianAbsence(TimestampedModel):
    """Ausência planejada de um técnico (férias, atestado, folga etc.) —
    período de datas em que ele não deve aparecer como disponível na
    Central de Operações, mesmo sem ninguém marcar presença manualmente
    naquele dia. Separado de TechnicianDailyPresence (que é o check-in do
    próprio dia, feito pelo técnico) porque uma ausência planejada é
    cadastrada com antecedência, por um administrador, e cobre um período
    de dias — não faz sentido criar uma linha de presença por dia."""

    collaborator = models.ForeignKey(Collaborator, verbose_name="técnico", on_delete=models.CASCADE, related_name="absences")
    date_from = models.DateField("de")
    date_to = models.DateField("até")
    reason = models.CharField("motivo", max_length=150, blank=True, help_text="Ex: Férias, Atestado médico, Folga.")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="criado por", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "Ausência de Técnico"
        verbose_name_plural = "Ausências de Técnico"
        ordering = ("-date_from",)
        constraints = [
            models.CheckConstraint(check=models.Q(date_to__gte=models.F("date_from")), name="absence_date_to_after_from"),
        ]

    def __str__(self):
        return f"{self.collaborator} — {self.date_from:%d/%m/%Y} a {self.date_to:%d/%m/%Y}"

    def clean(self):
        super().clean()
        if self.date_from and self.date_to and self.date_to < self.date_from:
            raise ValidationError({"date_to": "A data final não pode ser anterior à data inicial."})


class WorkBlock(models.Model):
    """Bloco de trabalho registrado pelo técnico (dispatch.blocks): um período contínuo em UMA
    atividade e UM grupo de material. É a unidade de medição de tempo por unidade (api.block_times):
    o tempo do bloco é real e a quantidade produzida vem das tarefas concluídas nele."""

    collaborator = models.ForeignKey(
        Collaborator, verbose_name="técnico", on_delete=models.CASCADE, related_name="work_blocks"
    )
    date = models.DateField("data")
    start = models.DateTimeField("início")
    end = models.DateTimeField("fim")
    activity = models.ForeignKey(
        "master_data.Activity", verbose_name="atividade", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    work_group = models.CharField("grupo de trabalho", max_length=30, blank=True)
    created_at = models.DateTimeField("registrado em", auto_now_add=True)

    class Meta:
        verbose_name = "Bloco de Trabalho"
        verbose_name_plural = "Blocos de Trabalho"
        ordering = ("-start",)

    def __str__(self):
        return f"{self.collaborator} — {self.start:%d/%m %H:%M}–{self.end:%H:%M}"

    @property
    def hours(self):
        return (self.end - self.start).total_seconds() / 3600

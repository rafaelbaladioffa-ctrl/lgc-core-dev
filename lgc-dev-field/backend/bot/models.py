from core.models import PhoneNormalizedModel, TimestampedModel
from django.core.exceptions import ValidationError
from django.db import models


class BotSubscriber(PhoneNormalizedModel, TimestampedModel):
    """Destinatário dos envios automáticos do bot do WhatsApp (não precisa
    ser um Colaborador cadastrado — normalmente é um gestor que quer
    acompanhar o dia a dia dos projetos)."""

    name = models.CharField("nome", max_length=150)
    phone = models.CharField(
        "telefone",
        max_length=20,
        blank=True,
        help_text="Com DDD, ex: +55 (11) 99999-9999. Deixe em branco se for um grupo.",
    )
    # Grupo do WhatsApp em vez de um telefone individual. Fica num campo
    # próprio (e não em `phone`) porque PhoneNormalizedModel.save() reformata
    # `phone` pro padrão brasileiro, o que destruiria o JID do grupo.
    group_jid = models.CharField(
        "ID do grupo do WhatsApp",
        max_length=100,
        blank=True,
        help_text='Identificador do grupo (termina em "@g.us"). Quando preenchido, o telefone é ignorado '
        "e o envio vai para o grupo. O bot precisa ser membro do grupo.",
    )
    receives_daily_tasks = models.BooleanField(
        "recebe tarefas do dia (10h)",
        default=True,
        help_text="Envio automático às 10h com projetos/técnicos/tarefas alocados para hoje.",
    )
    receives_project_updates = models.BooleanField(
        "recebe atualização de projetos (17h)",
        default=True,
        help_text="Envio automático às 17h com as tarefas concluídas no dia em cada projeto.",
    )
    receives_operations_print = models.BooleanField(
        "recebe print da Operação do Dia (8h, 10h, 12h, 14h, 16h, 18h)",
        default=True,
        help_text="Envio automático de uma imagem com o painel da Central de Operações (Operação do Dia).",
    )
    receives_daily_project_report = models.BooleanField(
        "recebe atualização diária de projeto (15h)",
        default=True,
        help_text="Envio automático às 15h com o relatório completo de cada projeto ativo (uma mensagem por projeto).",
    )
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Destinatário do Bot"
        verbose_name_plural = "Destinatários do Bot"
        ordering = ("name",)

    def clean(self):
        super().clean()
        if not self.phone and not self.group_jid:
            raise ValidationError({"phone": "Informe um telefone ou o ID de um grupo do WhatsApp."})
        if self.group_jid and not self.group_jid.endswith("@g.us"):
            raise ValidationError({"group_jid": 'O ID de grupo do WhatsApp precisa terminar em "@g.us".'})

    def __str__(self):
        return f"{self.name} ({self.group_jid or self.phone})"


class BotMessageTemplate(TimestampedModel):
    TYPE_DAILY_TASKS = "daily_tasks"
    TYPE_PROJECT_UPDATES = "project_updates"
    TYPE_OPERATIONS_PRINT = "operations_print"
    TYPE_DAILY_PROJECT_REPORT = "daily_project_report"
    TYPE_ALLOCATION = "allocation"
    TYPE_INTERACTIVE_MENU = "interactive_menu"

    MESSAGE_TYPE_CHOICES = (
        (TYPE_DAILY_TASKS, "Tarefas do dia"),
        (TYPE_PROJECT_UPDATES, "Atualização de projetos"),
        (TYPE_OPERATIONS_PRINT, "Print da Operação do Dia"),
        (TYPE_DAILY_PROJECT_REPORT, "Relatório diário de projeto"),
        (TYPE_ALLOCATION, "Alocação diária aos técnicos"),
        (TYPE_INTERACTIVE_MENU, "Menu /bot"),
    )

    message_type = models.CharField("tipo de mensagem", max_length=40, choices=MESSAGE_TYPE_CHOICES, unique=True)
    title = models.CharField("título", max_length=180, blank=True)
    intro_text = models.TextField("texto inicial", blank=True)
    footer_text = models.TextField("texto final", blank=True)
    enabled_fields = models.JSONField("campos habilitados", default=dict, blank=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Modelo de mensagem do Bot"
        verbose_name_plural = "Modelos de mensagem do Bot"
        ordering = ("message_type",)

    def __str__(self):
        return self.get_message_type_display()


class BotBroadcastRule(TimestampedModel):
    """Regra de envio do relatório diário de projeto: define QUANDO envia
    (horário/dias), QUAIS projetos entram (filtros), PARA QUEM vai e em que
    formato (texto por projeto ou imagem). Várias regras podem coexistir,
    ex.: 15h texto de um cliente/categoria e 15h01 print."""

    CONTENT_TEXT = "text"
    CONTENT_IMAGE = "image"
    CONTENT_CHOICES = ((CONTENT_TEXT, "Texto"), (CONTENT_IMAGE, "Imagem (print)"))
    MESSAGE_TYPE_CHOICES = (
        ("daily_project_report", "Relatório diário de projeto"),
        ("daily_tasks", "Tarefas do dia"),
        ("project_updates", "Atualização de projetos"),
        ("allocation", "Alocação diária aos técnicos"),
        ("operations_print", "Print da operação"),
    )

    name = models.CharField("nome", max_length=150)
    is_active = models.BooleanField("ativa", default=True)
    message_type = models.CharField(
        "tipo de mensagem", max_length=40, choices=MESSAGE_TYPE_CHOICES, default="daily_project_report"
    )
    date_offset_days = models.IntegerField(
        "dias à frente dos dados", default=0, help_text="0 = dados de hoje; 1 = dados de amanhã (ex.: alocação do dia seguinte)."
    )
    content_type = models.CharField("formato", max_length=10, choices=CONTENT_CHOICES, default=CONTENT_TEXT)
    send_time = models.TimeField("horário de envio (Brasília)")
    weekdays = models.JSONField(
        "dias da semana", default=list, blank=True, help_text="0=segunda ... 6=domingo. Vazio = todos os dias."
    )
    clients = models.ManyToManyField("core.Client", verbose_name="clientes", blank=True, related_name="+")
    categories = models.ManyToManyField("core.Category", verbose_name="categorias", blank=True, related_name="+")
    sites = models.ManyToManyField("core.Site", verbose_name="sites", blank=True, related_name="+")
    regions = models.ManyToManyField("core.Region", verbose_name="regionais", blank=True, related_name="+")
    responsibles = models.ManyToManyField(
        "core.Responsible", verbose_name="responsáveis CSTR", blank=True, related_name="+"
    )
    managers = models.ManyToManyField(
        "core.Collaborator",
        verbose_name="gestores",
        blank=True,
        related_name="+",
        help_text="Alocação: só entram os técnicos desses gestores (e de quem está abaixo deles). Vazio = todos.",
    )
    include_no_category = models.BooleanField(
        "incluir projetos sem categoria",
        default=False,
        help_text="Só vale quando há categorias selecionadas; sem categorias, todos entram.",
    )
    statuses = models.JSONField(
        "status do projeto", default=list, blank=True, help_text="Vazio = qualquer status."
    )
    recipients = models.ManyToManyField(
        BotSubscriber,
        verbose_name="destinatários",
        blank=True,
        related_name="broadcast_rules",
        help_text="Vazio = todos os destinatários que recebem a atualização diária de projeto.",
    )
    image_caption = models.CharField("legenda da imagem", max_length=250, blank=True)

    class Meta:
        verbose_name = "Regra de envio do Bot"
        verbose_name_plural = "Regras de envio do Bot"
        ordering = ("send_time", "id")

    def __str__(self):
        return f"{self.name} ({self.send_time:%H:%M})"

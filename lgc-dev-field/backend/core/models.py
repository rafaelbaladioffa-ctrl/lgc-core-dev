from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.utils import timezone

from core.phone_utils import format_phone


class TimestampedModel(models.Model):
    created_at = models.DateTimeField("criado em", auto_now_add=True)
    updated_at = models.DateTimeField("atualizado em", auto_now=True)

    class Meta:
        abstract = True


class PhoneNormalizedModel(models.Model):
    """Mixin pra modelos com campo `phone`: normaliza pro padrão brasileiro
    "+55 (11) 99999-9999" ao salvar, não importa a via de entrada (API,
    Django Admin, importação de CSV, shell) — o campo no frontend já formata
    ao digitar, isso garante o mesmo padrão pelos outros caminhos."""

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.phone:
            self.phone = format_phone(self.phone)
        super().save(*args, **kwargs)


class Company(PhoneNormalizedModel, TimestampedModel):
    legal_name = models.CharField("razão social", max_length=255, blank=True)
    trade_name = models.CharField("nome fantasia", max_length=255, blank=True)
    tax_id = models.CharField("CNPJ/CPF", max_length=18, blank=True)
    email = models.EmailField("e-mail", blank=True)
    phone = models.CharField("telefone", max_length=20, blank=True)
    is_active = models.BooleanField("ativa", default=True)

    class Meta:
        verbose_name = "empresa"
        verbose_name_plural = "empresas"
        ordering = ("legal_name",)
        permissions = [
            # Controla só a TELA "Cadastros Gerais" (menu/rota). Os dados dos
            # cadastros continuam protegidos pelas permissões view_* de cada
            # model, que outras telas (Projetos, Tarefas...) também usam.
            ("access_registry_screen", "Pode acessar a tela Cadastros Gerais"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("tax_id",),
                condition=~models.Q(tax_id=""),
                name="unique_nonempty_company_tax_id",
            )
        ]

    def __str__(self):
        return self.trade_name or self.legal_name or "Empresa sem identificação"


class ActiveCompanyModel(TimestampedModel):
    company = models.ForeignKey(
        Company,
        verbose_name="empresa",
        on_delete=models.PROTECT,
        related_name="%(class)ss",
    )
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        abstract = True


class Region(TimestampedModel):
    COUNTRY_BR = "BR"
    COUNTRY_US = "US"
    COUNTRY_CL = "CL"
    COUNTRY_MX = "MX"
    COUNTRY_CHOICES = (
        (COUNTRY_BR, "Brasil"),
        (COUNTRY_US, "EUA"),
        (COUNTRY_CL, "Chile"),
        (COUNTRY_MX, "México"),
    )

    country = models.CharField("país", max_length=2, choices=COUNTRY_CHOICES, default=COUNTRY_BR)
    name = models.CharField("nome", max_length=100)
    code = models.CharField("código", max_length=20, unique=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "região"
        verbose_name_plural = "regiões"
        ordering = ("country", "name")

    def __str__(self):
        return f"{self.get_country_display()} · {self.name}"


class Site(TimestampedModel):
    client = models.ForeignKey(
        "Client",
        verbose_name="cliente",
        on_delete=models.PROTECT,
        related_name="sites",
    )
    is_active = models.BooleanField("ativo", default=True)
    name = models.CharField("nome", max_length=150, blank=True)
    code = models.CharField("código", max_length=30, blank=True)
    address = models.CharField("endereço", max_length=255, blank=True)
    city = models.CharField("cidade", max_length=100, blank=True)
    state = models.CharField("UF", max_length=2, blank=True)
    region = models.ForeignKey(
        Region,
        verbose_name="região",
        on_delete=models.SET_NULL,
        related_name="sites",
        null=True,
        blank=True,
    )
    manual_coordinates = models.BooleanField(
        "coordenadas manuais",
        default=False,
        help_text="Marque para informar latitude/longitude manualmente. Enquanto marcado, a geocodificação "
        "automática não sobrescreve os valores digitados.",
    )
    latitude = models.DecimalField(
        "latitude", max_digits=9, decimal_places=6, null=True, blank=True,
        help_text="Preenchida automaticamente a partir do endereço, a menos que 'coordenadas manuais' esteja marcado.",
    )
    longitude = models.DecimalField(
        "longitude", max_digits=9, decimal_places=6, null=True, blank=True,
        help_text="Preenchida automaticamente a partir do endereço, a menos que 'coordenadas manuais' esteja marcado.",
    )
    geocoded_address = models.CharField(
        "endereço geocodificado", max_length=400, blank=True, editable=False,
        help_text="Guarda o endereço que gerou a última latitude/longitude, para saber quando regeocodificar.",
    )

    class Meta:
        verbose_name = "site"
        verbose_name_plural = "sites"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("client", "code"),
                condition=~models.Q(code=""),
                name="unique_site_code_per_client",
            )
        ]

    def __str__(self):
        return " - ".join(filter(None, (self.code, self.name))) or "Site sem identificação"

    @property
    def full_address(self):
        return ", ".join(filter(None, (self.address, self.city, self.state, "Brasil")))

    def save(self, *args, **kwargs):
        address = self.full_address

        if self.manual_coordinates:
            # Respeita as coordenadas digitadas no admin; não chama a
            # geocodificação automática nem as sobrescreve.
            self.geocoded_address = address
            super().save(*args, **kwargs)
            return

        if not address:
            self.latitude = None
            self.longitude = None
            self.geocoded_address = ""
            super().save(*args, **kwargs)
            return

        needs_geocoding = address != self.geocoded_address or self.latitude is None or self.longitude is None
        if needs_geocoding:
            from .geocoding import geocode_site_address

            result = geocode_site_address(self.address, self.city, self.state)
            if result:
                self.latitude, self.longitude = result
                self.geocoded_address = address
            # Se a geocodificação falhar (rate limit, endereço não
            # encontrado, erro de rede), NÃO marcamos geocoded_address como
            # concluído — assim o próximo save() tenta de novo, em vez de
            # deixar o site permanentemente "Sem coordenadas".
        super().save(*args, **kwargs)


class JobTitle(ActiveCompanyModel):
    name = models.CharField("nome", max_length=100, blank=True)
    description = models.TextField("descrição", blank=True)

    class Meta:
        verbose_name = "cargo"
        verbose_name_plural = "cargos"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("company", "name"),
                condition=~models.Q(name=""),
                name="unique_job_title_name_per_company",
            )
        ]

    def __str__(self):
        return self.name or "Cargo sem identificação"


def get_or_create_person(*, name="", email="", phone="", company=None):
    """Reaproveita um Person existente (por e-mail, senão por nome+empresa)
    ou cria um novo — usado pelos formulários de Colaborador/Responsável/
    Responsável do Cliente (Django Admin e API) para que essas 'papéis'
    continuem editáveis como um formulário único (nome/e-mail/telefone),
    sem duplicar a mesma pessoa quando ela já existe (ex: vira Responsável
    depois de já ser Colaborador)."""
    name = (name or "").strip()
    email = (email or "").strip()
    person = Person.objects.filter(email__iexact=email).first() if email else None
    if person is None:
        person = Person.objects.filter(name__iexact=name, company=company).first()
    if person is None:
        return Person.objects.create(name=name, email=email, phone=phone or "", company=company)
    return person


def update_person(person, *, name=None, email=None, phone=None, company=None, user=None, has_user=False):
    """Atualiza um Person já vinculado com os valores digitados no formulário
    de edição de um papel (Colaborador/Responsável/Responsável do Cliente) —
    sobrescreve direto (não é a heurística de 'preencher só o que tá vazio'
    do import CSV: aqui o usuário está editando de propósito)."""
    if name is not None:
        person.name = name
    if email is not None:
        person.email = email
    if phone is not None:
        person.phone = phone
    if company is not None:
        person.company = company
    if has_user:
        person.user = user
    person.save()


def get_collaborator_role(user):
    """Colaborador (papel) vinculado ao usuário logado, via Person, ou None
    se o usuário não tiver Person vinculado ou não for Colaborador. Único
    ponto usado por Minhas Tarefas / MyTaskViewSet para decidir quais
    tarefas mostrar — substitui o antigo `user.collaborator_profile`
    (ligação direta e sem-Person que existia antes desta unificação)."""
    person = getattr(user, "person", None)
    return getattr(person, "collaborator_role", None) if person else None


class Person(PhoneNormalizedModel, TimestampedModel):
    """Identidade única de uma pessoa física conhecida pelo sistema —
    concentra nome/e-mail/telefone/empresa/usuário vinculado num único
    lugar, para que Colaborador, Responsável e Responsável do Cliente sejam
    apenas "papéis" que uma mesma pessoa pode acumular sem duplicar
    cadastro (ex: um supervisor que também executa tarefas tem UM Person,
    com um Collaborator E um Responsible ligados a ele — não dois
    registros soltos e sem relação, como antes desta unificação)."""

    name = models.CharField("nome", max_length=150, blank=True)
    email = models.EmailField("e-mail", blank=True)
    phone = models.CharField("telefone", max_length=20, blank=True)
    company = models.ForeignKey(
        Company,
        verbose_name="empresa",
        on_delete=models.PROTECT,
        related_name="people",
        null=True,
        blank=True,
        help_text="Empresa à qual esta pessoa pertence (equipe interna). Deixe em branco para um contato "
        "externo (ex: Responsável do Cliente sem vínculo direto com uma empresa do grupo).",
    )
    user = models.OneToOneField(
        "users.User",
        verbose_name="usuário vinculado",
        on_delete=models.SET_NULL,
        related_name="person",
        null=True,
        blank=True,
        help_text="Vincule um usuário para dar login a esta pessoa (ex: como Colaborador, para acessar "
        "Minhas Tarefas). Para o acesso de portal de um contato do cliente, configure o escopo "
        "diretamente no cadastro do Usuário (campo Cliente).",
    )
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "pessoa"
        verbose_name_plural = "pessoas"
        ordering = ("name",)

    def __str__(self):
        return self.name or self.email or "Pessoa sem identificação"

    def clean(self):
        super().clean()
        if self.user_id and self.company_id and self.user.company_id != self.company_id:
            raise ValidationError({"user": "O usuário deve pertencer à mesma empresa desta pessoa."})


class Collaborator(TimestampedModel):
    person = models.OneToOneField(
        Person,
        verbose_name="pessoa",
        on_delete=models.CASCADE,
        related_name="collaborator_role",
    )
    registration = models.CharField("matrícula", max_length=30, blank=True)
    yellow_badge = models.CharField("Yellow Badge", max_length=50, blank=True)
    job_title = models.ForeignKey(
        JobTitle,
        verbose_name="cargo",
        on_delete=models.SET_NULL,
        related_name="collaborators",
        null=True,
        blank=True,
    )
    sites = models.ManyToManyField(Site, verbose_name="sites", related_name="collaborators", blank=True)
    manager = models.ForeignKey(
        "self",
        verbose_name="gestor",
        on_delete=models.SET_NULL,
        related_name="direct_reports",
        null=True,
        blank=True,
        limit_choices_to=(
            models.Q(job_title__name__icontains="Supervisor")
            | models.Q(job_title__name__icontains="Coordenador")
            | models.Q(job_title__name__icontains="Gerente")
        ),
    )
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "técnico"
        verbose_name_plural = "técnicos"
        ordering = ("person__name",)

    def __str__(self):
        if not self.person_id:
            return "Colaborador sem identificação"
        return str(self.person) or self.registration or "Colaborador sem identificação"

    def clean(self):
        super().clean()
        errors = {}
        if self.manager_id and self.pk and self.manager_id == self.pk:
            errors["manager"] = "O colaborador não pode ser seu próprio gestor."
        if (
            self.manager_id
            and self.person_id
            and self.person.company_id
            and self.manager.person.company_id != self.person.company_id
        ):
            errors["manager"] = "O gestor deve pertencer à mesma empresa do colaborador."
        if self.person_id and self.registration:
            dup = Collaborator.objects.filter(
                person__company_id=self.person.company_id, registration=self.registration
            ).exclude(pk=self.pk)
            if dup.exists():
                errors["registration"] = "Já existe um colaborador com esta matrícula nesta empresa."
        if self.person_id and self.yellow_badge:
            dup = Collaborator.objects.filter(
                person__company_id=self.person.company_id, yellow_badge=self.yellow_badge
            ).exclude(pk=self.pk)
            if dup.exists():
                errors["yellow_badge"] = "Já existe um colaborador com este Yellow Badge nesta empresa."
        if errors:
            raise ValidationError(errors)


class Responsible(TimestampedModel):
    """Responsável por um Projeto — do lado CSTR (kind=cstr, pessoa da
    própria empresa) ou do lado do Cliente (kind=client, contato do
    Cliente). Unificado num único cadastro/tela: ao criar, escolhe-se o
    Tipo, que determina se `client` é obrigatório (Cliente) ou deve ficar
    vazio (CSTR — nesse caso a empresa vem de `person.company`)."""

    KIND_CSTR = "cstr"
    KIND_CLIENT = "client"
    KIND_CHOICES = (
        (KIND_CSTR, "CSTR"),
        (KIND_CLIENT, "Cliente"),
    )

    kind = models.CharField("tipo", max_length=10, choices=KIND_CHOICES, default=KIND_CSTR)
    person = models.OneToOneField(
        Person,
        verbose_name="pessoa",
        on_delete=models.CASCADE,
        related_name="responsible_role",
    )
    client = models.ForeignKey(
        "Client",
        verbose_name="cliente",
        on_delete=models.CASCADE,
        related_name="responsibles",
        null=True,
        blank=True,
        help_text="Obrigatório para Responsável do Cliente. Deixe em branco para Responsável CSTR.",
    )
    job_title = models.CharField("cargo", max_length=100, blank=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "responsável"
        verbose_name_plural = "responsáveis"
        ordering = ("person__name",)

    def __str__(self):
        if not self.person_id:
            return "Responsável sem identificação"
        return str(self.person) or "Responsável sem identificação"

    def clean(self):
        super().clean()
        errors = {}
        if self.kind == self.KIND_CLIENT and not self.client_id:
            errors["client"] = "Obrigatório para Responsável do Cliente."
        if self.kind == self.KIND_CSTR and self.client_id:
            errors["client"] = "Deve ficar em branco para Responsável CSTR."
        if errors:
            raise ValidationError(errors)
        if self.kind == self.KIND_CLIENT and self.client_id and self.person_id:
            dup = Responsible.objects.filter(client_id=self.client_id, person_id=self.person_id).exclude(pk=self.pk)
            if dup.exists():
                raise ValidationError({"person": "Esta pessoa já é Responsável deste Cliente."})


class Category(TimestampedModel):
    name = models.CharField("nome", max_length=100, blank=True)
    description = models.TextField("descrição", blank=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "categoria"
        verbose_name_plural = "categorias"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("name",),
                condition=~models.Q(name=""),
                name="unique_nonempty_category_name",
            )
        ]

    def __str__(self):
        return self.name or "Categoria sem identificação"


class ProjectType(TimestampedModel):
    name = models.CharField("nome", max_length=100, blank=True)
    description = models.TextField("descrição", blank=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Tipo de Projeto"
        verbose_name_plural = "Tipos de Projeto"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("name",),
                condition=~models.Q(name=""),
                name="unique_nonempty_project_type_name",
            )
        ]

    def __str__(self):
        return self.name or "Tipo de projeto sem identificação"


class ConsultimerProjectType(TimestampedModel):
    """Modalidade de projeto da Consultimer (ex: Deployment, Fitout).
    A sigla (`code`) identifica o tipo no código do projeto."""

    name = models.CharField("nome", max_length=100)
    code = models.CharField("sigla", max_length=10, unique=True)
    description = models.TextField("descrição", blank=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Tipo de Projeto Consultimer"
        verbose_name_plural = "Tipos de Projeto Consultimer"
        ordering = ("name",)

    def __str__(self):
        return f"{self.name} ({self.code})"

    def save(self, *args, **kwargs):
        self.code = (self.code or "").strip().upper()
        return super().save(*args, **kwargs)


class TaskSequence(models.Model):
    year = models.PositiveIntegerField("ano", primary_key=True)
    last_number = models.PositiveIntegerField("último número", default=0)

    class Meta:
        verbose_name = "sequência de tarefas"
        verbose_name_plural = "sequências de tarefas"


class Task(TimestampedModel):
    name = models.CharField("nome", max_length=150, blank=True)
    code = models.CharField("código", max_length=30, unique=True, editable=False)
    description = models.TextField("descrição", blank=True)
    is_active = models.BooleanField("ativo", default=True)
    estimated_hours = models.DecimalField(
        "horas estimadas",
        max_digits=7,
        decimal_places=2,
        default=0,
        null=True,
        blank=True,
    )
    project_types = models.ManyToManyField(
        ProjectType,
        verbose_name="Tipos de Projeto",
        related_name="tasks",
        blank=True,
    )

    class Meta:
        verbose_name = "tarefa"
        verbose_name_plural = "tarefas"
        ordering = ("name",)

    def __str__(self):
        return " - ".join(filter(None, (self.code, self.name))) or "Tarefa sem identificação"

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)

        year = timezone.localdate().year
        with transaction.atomic():
            try:
                sequence = TaskSequence.objects.select_for_update().get(year=year)
            except TaskSequence.DoesNotExist:
                try:
                    with transaction.atomic():
                        sequence = TaskSequence.objects.create(year=year)
                except IntegrityError:
                    sequence = TaskSequence.objects.select_for_update().get(year=year)

            sequence.last_number += 1
            sequence.save(update_fields=("last_number",))
            self.code = f"CSTR-TASK-{year}{sequence.last_number:04d}"
            return super().save(*args, **kwargs)


class Client(PhoneNormalizedModel, ActiveCompanyModel):
    PERSON_TYPE_CHOICES = (("company", "Pessoa jurídica"), ("person", "Pessoa física"))

    number = models.PositiveIntegerField("número do cadastro", null=True, blank=True, unique=True, editable=False)
    person_type = models.CharField(
        "tipo de pessoa",
        max_length=10,
        choices=PERSON_TYPE_CHOICES,
        default="company",
        blank=True,
    )
    legal_name = models.CharField("razão social/nome", max_length=255, blank=True)
    trade_name = models.CharField("nome fantasia", max_length=255, blank=True)
    tax_id = models.CharField("CNPJ/CPF", max_length=18, blank=True)
    email = models.EmailField("e-mail", blank=True)
    phone = models.CharField("telefone", max_length=20, blank=True)
    address = models.CharField("endereço", max_length=255, blank=True)
    city = models.CharField("cidade", max_length=100, blank=True)
    state = models.CharField("UF", max_length=2, blank=True)
    notes = models.TextField("observações", blank=True)

    class Meta:
        verbose_name = "cliente"
        verbose_name_plural = "clientes"
        ordering = ("legal_name",)
        constraints = [
            models.UniqueConstraint(
                fields=("company", "tax_id"),
                condition=~models.Q(tax_id=""),
                name="unique_client_tax_id_per_company",
            )
        ]

    def __str__(self):
        return self.trade_name or self.legal_name or self.tax_id or "Cliente sem identificação"

    @property
    def number_code(self):
        return f"{self.number:03d}" if self.number else ""

    def save(self, *args, **kwargs):
        if self.number is None:
            with transaction.atomic():
                last = Client.objects.select_for_update().aggregate(m=models.Max("number"))["m"] or 0
                self.number = last + 1
                return super().save(*args, **kwargs)
        return super().save(*args, **kwargs)


class Notification(TimestampedModel):
    """Notificação in-app para um usuário. Não referencia models de outros
    apps diretamente (evita import circular com `projects`) — guarda apenas
    `url` (rota do frontend) e `project_id`/`project_code` para exibição."""

    user = models.ForeignKey(
        "users.User", verbose_name="usuário", on_delete=models.CASCADE, related_name="notifications"
    )
    title = models.CharField("título", max_length=200)
    message = models.CharField("mensagem", max_length=500, blank=True)
    url = models.CharField("link", max_length=300, blank=True)
    project_id = models.PositiveIntegerField("id do projeto", null=True, blank=True)
    project_code = models.CharField("código do projeto", max_length=50, blank=True)
    is_read = models.BooleanField("lida", default=False)

    class Meta:
        verbose_name = "notificação"
        verbose_name_plural = "notificações"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.user} - {self.title}"


class PushSubscription(models.Model):
    """Assinatura de Web Push de um usuário num dispositivo/browser específico.
    Um usuário pode ter múltiplas assinaturas (celular, desktop, etc.).
    A unicidade é pelo endpoint, que identifica o dispositivo no serviço de push."""

    user = models.ForeignKey(
        "users.User", verbose_name="usuário", on_delete=models.CASCADE, related_name="push_subscriptions"
    )
    endpoint = models.TextField("endpoint", unique=True)
    p256dh = models.TextField("chave p256dh")
    auth = models.TextField("auth")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "assinatura push"
        verbose_name_plural = "assinaturas push"

    def __str__(self):
        return f"{self.user} — {self.endpoint[:60]}"


def _send_web_push(subscription, payload):
    """Envia push para uma assinatura. Retorna True em sucesso, False em erro
    recuperável, e apaga a assinatura em caso de 410 (dispositivo cancelou)."""
    import json
    import os

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        return False

    vapid_private = os.getenv("VAPID_PRIVATE_KEY")
    vapid_email = os.getenv("VAPID_EMAIL", "mailto:admin@example.com")
    if not vapid_private:
        return False

    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload),
            vapid_private_key=vapid_private,
            vapid_claims={"sub": vapid_email},
        )
        return True
    except WebPushException as exc:
        if exc.response is not None and exc.response.status_code == 410:
            subscription.delete()
        return False
    except Exception:
        return False


def notify_user(user, *, title, message="", url="", project_id=None, project_code=""):
    """Cria uma Notification para `user` e dispara Web Push para todos os
    dispositivos registrados, se existirem."""
    if not user:
        return None
    notification = Notification.objects.create(
        user=user,
        title=title,
        message=message,
        url=url,
        project_id=project_id,
        project_code=project_code,
    )
    payload = {"title": title, "body": message, "url": url}
    for sub in PushSubscription.objects.filter(user=user):
        _send_web_push(sub, payload)
    return notification



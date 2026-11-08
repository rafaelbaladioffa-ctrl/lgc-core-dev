import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import Category, Client, Collaborator, Company, ConsultimerProjectType, ProjectType, Responsible, Site, Task, TimestampedModel


class ProjectSequence(models.Model):
    year = models.PositiveIntegerField("ano", primary_key=True)
    last_number = models.PositiveIntegerField("último número", default=0)

    class Meta:
        verbose_name = "Sequência de Projetos"
        verbose_name_plural = "Sequências de Projetos"


def build_structured_code(project, date, number):
    """SIGLA + nº do cliente + site + AAMM + sequencial anual, sem separadores.
    Ex.: DEP001GRU6526100001. O site mantém só letras e números."""
    site = re.sub(r"[^A-Za-z0-9]", "", project.site.code).upper()
    return f"{project.consultimer_type.code}{project.client.number_code}{site}{date:%y%m}{number:04d}"


class ProjectCodeSequence(models.Model):
    """Contador anual do sufixo sequencial do código do projeto (zera a cada ano)."""

    year = models.PositiveIntegerField("ano", primary_key=True)
    last_number = models.PositiveIntegerField("último número", default=0)

    class Meta:
        verbose_name = "Sequência de Código de Projeto"
        verbose_name_plural = "Sequências de Código de Projeto"


class Project(TimestampedModel):
    STATUS_PLANNING = "planning"
    STATUS_NOT_STARTED = "not_started"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_PAUSED = "paused"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELED = "canceled"
    STATUS_CHOICES = (
        (STATUS_PLANNING, "Planejamento"),
        (STATUS_NOT_STARTED, "Não Iniciado"),
        (STATUS_IN_PROGRESS, "Ativo"),
        (STATUS_PAUSED, "Pausado"),
        (STATUS_COMPLETED, "Concluído"),
        (STATUS_CANCELED, "Cancelado"),
    )

    code = models.CharField("código", max_length=50, unique=True, editable=False)
    company = models.ForeignKey(Company, verbose_name="empresa", on_delete=models.PROTECT, related_name="projects")
    name = models.CharField("nome do projeto", max_length=200)
    po = models.CharField("PO", max_length=100, blank=True)
    link_count = models.PositiveIntegerField("quantidade de links", default=0, blank=True)
    has_rack_positions = models.BooleanField(
        "Rack Position",
        default=False,
        blank=True,
        help_text="Ative para controlar Rack Position (DH, Links, UTP por posição) neste projeto.",
    )
    client = models.ForeignKey(Client, verbose_name="cliente", on_delete=models.PROTECT, related_name="projects", null=True, blank=True)
    site = models.ForeignKey(Site, verbose_name="site", on_delete=models.PROTECT, related_name="projects", null=True, blank=True)
    project_type = models.ForeignKey(ProjectType, verbose_name="Tipo de Projeto", on_delete=models.PROTECT, related_name="projects", null=True, blank=True)
    consultimer_type = models.ForeignKey(
        ConsultimerProjectType,
        verbose_name="Tipo Consultimer",
        on_delete=models.PROTECT,
        related_name="projects",
        null=True,
        blank=True,
    )
    category = models.ForeignKey(Category, verbose_name="categoria", on_delete=models.PROTECT, related_name="projects", null=True, blank=True)
    responsible_cstr = models.ForeignKey(
        Responsible,
        verbose_name="Responsável CSTR",
        on_delete=models.PROTECT,
        related_name="cstr_projects",
        null=True,
        blank=True,
        limit_choices_to=(
            models.Q(kind=Responsible.KIND_CSTR)
            & (
                models.Q(person__company__legal_name__icontains="CONSULTIMER")
                | models.Q(person__company__trade_name__icontains="CONSULTIMER")
            )
        ),
    )
    responsible_client = models.ForeignKey(
        Responsible,
        verbose_name="Responsável Cliente",
        on_delete=models.PROTECT,
        related_name="client_projects",
        null=True,
        blank=True,
        limit_choices_to=models.Q(kind=Responsible.KIND_CLIENT),
    )
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_PLANNING)
    planned_start = models.DateField("início previsto", null=True, blank=True)
    planned_end = models.DateField("término previsto", null=True, blank=True)
    actual_start = models.DateField("início real", null=True, blank=True)
    actual_end = models.DateField("término real", null=True, blank=True)
    description = models.TextField("descrição", blank=True)
    notes = models.TextField("observações", blank=True)
    axis_project_id = models.UUIDField(
        "id do projeto no Axis", null=True, blank=True, unique=True, editable=False, help_text="Vínculo com o cadastro do Axis Core (integração)."
    )
    axis_cost_center_id = models.UUIDField(
        "centro de custo no Axis", null=True, blank=True, editable=False, help_text="Centro de custo do projeto no Axis Core (cache)."
    )
    # --- Obra criada a partir do Core (PT-08; docs/integracao-core-field.md §4) -----------------
    planned_team = models.JSONField(
        "equipe prevista",
        default=list,
        blank=True,
        help_text="Equipe da cotação aceita no Axis: lista de {role_key, role_name, field_role, people, days, hours}.",
    )
    axis_pending_issues = models.JSONField(
        "pendências da integração",
        default=list,
        blank=True,
        editable=False,
        help_text="O que o Axis mandou e não casou com cadastros do Field (cliente, site, responsável). Lista de textos.",
    )
    SOW_PLAN_PENDING = "pending"
    SOW_PLAN_PROCESSING = "processing"
    SOW_PLAN_GENERATED = "generated"
    SOW_PLAN_PENDING_REVIEW = "pending_review"
    SOW_PLAN_FAILED = "failed"
    SOW_PLAN_NO_SOW = "no_sow"
    SOW_PLAN_CHOICES = (
        (SOW_PLAN_PENDING, "Aguardando processamento"),
        (SOW_PLAN_PROCESSING, "Processando"),
        (SOW_PLAN_GENERATED, "Tarefas geradas"),
        (SOW_PLAN_PENDING_REVIEW, "Pendente de revisão"),
        (SOW_PLAN_FAILED, "Falhou"),
        (SOW_PLAN_NO_SOW, "Sem SOW"),
    )
    sow_plan_status = models.CharField(
        "plano da SOW", max_length=20, choices=SOW_PLAN_CHOICES, blank=True, default="", editable=False,
        help_text="Situação da geração automática de tarefas a partir da SOW do Axis (vazio: obra que não veio do Axis).",
    )
    sow_plan_note = models.TextField("detalhe do plano da SOW", blank=True, editable=False)
    sow_import = models.ForeignKey(
        "master_data.SowImport", verbose_name="importação de SOW", on_delete=models.SET_NULL,
        null=True, blank=True, editable=False, related_name="axis_projects",
    )
    axis_sow_document_id = models.UUIDField("documento da SOW no Axis", null=True, blank=True, editable=False)
    axis_started_at = models.DateTimeField(
        "primeira tarefa iniciada (evento enviado ao Axis)", null=True, blank=True, editable=False
    )
    axis_completed_at = models.DateTimeField(
        "obra concluída (evento enviado ao Axis)", null=True, blank=True, editable=False
    )
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Projeto"
        verbose_name_plural = "Projetos"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.code} - {self.name}" if self.code else self.name

    def clean(self):
        super().clean()
        errors = {}
        if self.client_id and self.site_id and self.site.client_id != self.client_id:
            errors["site"] = "O Site selecionado deve pertencer ao Cliente do projeto."
        if self.responsible_cstr_id and "CONSULTIMER" not in (
            f"{self.responsible_cstr.person.company.legal_name} {self.responsible_cstr.person.company.trade_name}".upper()
        ):
            errors["responsible_cstr"] = "O Responsável CSTR deve pertencer à empresa Consultimer."
        if self.responsible_client_id and self.client_id and self.responsible_client.client_id != self.client_id:
            errors["responsible_client"] = "O responsável selecionado deve pertencer ao Cliente do projeto."
        if self.planned_start and self.planned_end and self.planned_end < self.planned_start:
            errors["planned_end"] = "O término previsto não pode ser anterior ao início previsto."
        if self.actual_start and self.actual_end and self.actual_end < self.actual_start:
            errors["actual_end"] = "O término real não pode ser anterior ao início real."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)

        today = timezone.localdate()
        year = today.year
        structured = bool(self.consultimer_type_id and self.client_id and self.site_id and self.client.number)
        sequence_model = ProjectCodeSequence if structured else ProjectSequence
        with transaction.atomic():
            try:
                sequence = sequence_model.objects.select_for_update().get(year=year)
            except sequence_model.DoesNotExist:
                try:
                    with transaction.atomic():
                        sequence = sequence_model.objects.create(year=year)
                except IntegrityError:
                    sequence = sequence_model.objects.select_for_update().get(year=year)
            sequence.last_number += 1
            sequence.save(update_fields=("last_number",))
            if structured:
                self.code = build_structured_code(self, today, sequence.last_number)
            else:
                self.code = f"CSTR-PROJ-{year}{sequence.last_number:04d}"
            return super().save(*args, **kwargs)


class ProjectHistory(Project):
    class Meta:
        proxy = True
        verbose_name = "Histórico de Projeto"
        verbose_name_plural = "Histórico de Projetos"


class DashboardProxy(Project):
    class Meta:
        proxy = True
        default_permissions = ()
        verbose_name = "Dashboard"
        verbose_name_plural = "Dashboard"


class RackPosition(TimestampedModel):
    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="rack_positions")
    position = models.CharField("Rack Position", max_length=50)
    dh = models.CharField("DH", max_length=50, blank=True)
    links = models.PositiveIntegerField("Links", default=0, blank=True)
    utp = models.PositiveIntegerField("UTP", default=0, blank=True)

    class Meta:
        verbose_name = "Rack Position"
        verbose_name_plural = "Rack Positions"
        ordering = ("position",)
        constraints = [
            models.UniqueConstraint(fields=("project", "position"), name="unique_rack_position_per_project")
        ]

    def __str__(self):
        return self.position

    def clean(self):
        super().clean()
        if self.project_id and not self.project.has_rack_positions:
            raise ValidationError({"project": "O projeto selecionado não tem Rack Position ativado."})


class ProjectTask(TimestampedModel):
    STATUS_NOT_STARTED = "not_started"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_PAUSED = "paused"
    STATUS_WAITING_QAQC = "waiting_qaqc"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELED = "canceled"
    STATUS_CHOICES = (
        (STATUS_NOT_STARTED, "Não Iniciada"),
        (STATUS_IN_PROGRESS, "Em Andamento"),
        (STATUS_PAUSED, "Pausada"),
        (STATUS_WAITING_QAQC, "Aguardando QA/QC"),
        (STATUS_COMPLETED, "Concluída"),
        (STATUS_CANCELED, "Cancelada"),
    )

    PRIORITY_LOW = "low"
    PRIORITY_MEDIUM = "medium"
    PRIORITY_HIGH = "high"
    PRIORITY_URGENT = "urgent"
    PRIORITY_CHOICES = (
        (PRIORITY_LOW, "Baixa"),
        (PRIORITY_MEDIUM, "Média"),
        (PRIORITY_HIGH, "Alta"),
        (PRIORITY_URGENT, "Urgente"),
    )

    # Sugestão (não é choices rígido): "MANUAL" (padrão — criada à mão ou
    # pelo catálogo de projeto/ProjectType) ou "SOW_TEMPLATE" (criada a
    # partir de uma master_data.GeneratedTask via Planejamento > Plano do
    # Projeto — ver projects.services.create_project_tasks_from_generated_tasks).
    ORIGIN_MANUAL = "MANUAL"
    ORIGIN_SOW_TEMPLATE = "SOW_TEMPLATE"

    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="project_tasks")
    task = models.ForeignKey(
        Task, verbose_name="tarefa", on_delete=models.PROTECT, related_name="project_tasks", null=True, blank=True
    )
    custom_name = models.CharField(
        "nome da tarefa avulsa",
        max_length=200,
        blank=True,
        help_text="Usado só quando a tarefa não vem do catálogo (campo 'Tarefa' em branco).",
    )
    # Rastreabilidade até o SOW/ScopeItem/Template de origem — sem
    # duplicar nenhum dado do master_data aqui: ScopeItem/SOW/template/
    # atividade/path/expansion_key/ordem são todos alcançados via
    # generated_task.scope_item/.task_template/.activity/.path/
    # .expansion_key/.step_order (ver ProjectTaskSerializer). PROTECT
    # porque uma GeneratedTask com ProjectTask vinculada não deve poder
    # ser excluída "por baixo" sem decisão explícita. Editável só pelo
    # service de criação, nunca pelo formulário normal.
    generated_task = models.ForeignKey(
        "master_data.GeneratedTask",
        verbose_name="tarefa gerada de origem",
        on_delete=models.PROTECT,
        related_name="project_tasks",
        null=True,
        blank=True,
        editable=False,
    )
    origin = models.CharField("origem", max_length=30, default=ORIGIN_MANUAL, blank=True, editable=False)
    priority = models.CharField("prioridade", max_length=20, choices=PRIORITY_CHOICES, default=PRIORITY_MEDIUM)
    instructions = models.TextField(
        "instrução operacional",
        blank=True,
        help_text="Instrução para o técnico — diferente de 'observações', que é preenchido durante a execução.",
    )
    quantity_planned = models.DecimalField("quantidade planejada", max_digits=9, decimal_places=2, null=True, blank=True)
    unit = models.CharField("unidade", max_length=50, blank=True)
    requires_evidence = models.BooleanField("exige evidência", default=False)
    requires_qaqc = models.BooleanField("exige QA/QC", default=False)
    rack_positions = models.ManyToManyField(
        RackPosition,
        verbose_name="Rack Positions",
        related_name="project_tasks",
        blank=True,
    )
    collaborators = models.ManyToManyField(
        Collaborator,
        through="ProjectTaskAssignment",
        verbose_name="responsáveis",
        related_name="project_tasks",
        blank=True,
    )
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_NOT_STARTED)
    order = models.PositiveIntegerField("ordem", default=0)
    planned_start = models.DateTimeField("Início", null=True, blank=True)
    planned_end = models.DateTimeField("Término", null=True, blank=True)
    actual_start = models.DateTimeField("início real", null=True, blank=True)
    actual_end = models.DateTimeField("término real", null=True, blank=True)
    estimated_hours = models.DecimalField("horas previstas", max_digits=8, decimal_places=2, null=True, blank=True)
    actual_hours = models.DecimalField("horas realizadas", max_digits=8, decimal_places=2, null=True, blank=True)
    paused_seconds = models.FloatField("segundos pausados", default=0, editable=False)
    paused_at = models.DateTimeField("pausado em", null=True, blank=True, editable=False)
    notes = models.TextField("observações", blank=True)

    COMPLETION_OUTCOME_COMPLETED = "completed"
    COMPLETION_OUTCOME_PARTIAL = "partial"
    COMPLETION_OUTCOME_BLOCKED = "blocked"
    COMPLETION_OUTCOME_CHOICES = (
        (COMPLETION_OUTCOME_COMPLETED, "Concluída"),
        (COMPLETION_OUTCOME_PARTIAL, "Parcial"),
        (COMPLETION_OUTCOME_BLOCKED, "Bloqueada"),
    )
    completion_outcome = models.CharField(
        "resultado da finalização", max_length=20, choices=COMPLETION_OUTCOME_CHOICES, blank=True
    )
    quantity_done = models.CharField("quantidade executada", max_length=100, blank=True)
    exclude_from_reports = models.BooleanField(
        "ignorar nos relatórios",
        default=False,
        help_text=(
            "Tarefa de teste ou com apontamento errado (ex.: em lote): não entra em Relatórios e Indicadores "
            "(HH, produção por técnico, estimativa por atividade e relatório gerencial). Nada é apagado."
        ),
    )

    class Meta:
        verbose_name = "Tarefa do Projeto"
        verbose_name_plural = "Tarefas do Projeto"
        ordering = ("order", "id")
        permissions = [("manage_project_tasks", "Pode gerenciar tarefas do projeto (status, datas, colaboradores e despacho)")]
        constraints = [
            # Idempotência da criação a partir do Plano do Projeto — nunca
            # duas ProjectTask para a mesma (projeto, GeneratedTask). Índice
            # PARCIAL (só quando generated_task não é nulo) para não afetar
            # em nada as tarefas manuais/do catálogo, que sempre têm
            # generated_task=None.
            models.UniqueConstraint(
                fields=("project", "generated_task"),
                condition=models.Q(generated_task__isnull=False),
                name="unique_project_task_per_generated_task",
            ),
        ]

    def __str__(self):
        return f"{self.project} - {self.display_name}"

    @property
    def display_name(self):
        """Nome de exibição: usa a Tarefa do catálogo quando vinculada,
        senão o nome avulso digitado (uma das duas sempre existe — ver clean())."""
        return self.task.name if self.task_id else self.custom_name

    def clean(self):
        super().clean()
        errors = {}
        if not self.task_id and not self.custom_name.strip():
            errors["custom_name"] = "Informe uma Tarefa do catálogo ou um nome avulso."
        if self.planned_start and self.planned_end and self.planned_end < self.planned_start:
            errors["planned_end"] = "O término previsto não pode ser anterior ao início previsto."
        if self.actual_start and self.actual_end and self.actual_end < self.actual_start:
            errors["actual_end"] = "O término real não pode ser anterior ao início real."
        if errors:
            raise ValidationError(errors)

    def validate_rack_positions(self, rack_positions):
        """Confere que todos os Rack Positions informados pertencem a este
        projeto. M2M não dá para validar em clean() (só existe após salvar
        a instância), então isso é chamado explicitamente por quem atribui
        os valores (admin, API) depois de resolver o project_id."""
        invalid = [rp for rp in rack_positions if rp.project_id != self.project_id]
        if invalid:
            names = ", ".join(rp.position for rp in invalid)
            raise ValidationError({"rack_positions": f"Rack Position(s) que não pertencem a este projeto: {names}."})

    def validate_unique_for_rack_positions(self, rack_positions):
        """Uma mesma Tarefa do catálogo pode se repetir no projeto, desde
        que cada repetição cubra um Rack Position diferente (uma tarefa por
        Rack Position — ex: 'Aplicação de Label' em 3 Rack Positions vira 3
        ProjectTask, uma por posição, não uma só com os 3 vinculados). Sem
        Rack Position envolvido, continua só podendo haver uma tarefa igual
        por projeto. Assim como validate_rack_positions, precisa ser chamado
        explicitamente por quem atribui os valores (M2M só existe após
        salvar). Tarefas avulsas (sem Tarefa de catálogo) não entram nessa
        checagem — não há o que deduplicar contra um catálogo que não existe
        para elas."""
        if not self.task_id:
            return
        queryset = ProjectTask.objects.filter(project_id=self.project_id, task_id=self.task_id)
        if self.pk:
            queryset = queryset.exclude(pk=self.pk)
        if rack_positions:
            conflicting = queryset.filter(rack_positions__in=rack_positions).distinct()
            if conflicting.exists():
                names = ", ".join(sorted({rp.position for pt in conflicting for rp in pt.rack_positions.all() if rp in rack_positions}))
                raise ValidationError({"rack_positions": f"Esta tarefa já existe para o(s) Rack Position(s): {names}."})
        elif queryset.exists():
            raise ValidationError({"task": f'A tarefa "{self.task}" já foi adicionada a este projeto.'})

    def save(self, *args, **kwargs):
        previous = ProjectTask.objects.filter(pk=self.pk).first() if self.pk else None
        now = timezone.now()

        if previous and previous.status != self.status:
            if self.status == self.STATUS_PAUSED:
                self.paused_at = now
            elif previous.status == self.STATUS_PAUSED:
                if previous.paused_at:
                    self.paused_seconds = (previous.paused_seconds or 0) + (now - previous.paused_at).total_seconds()
                self.paused_at = None

        if self.actual_start and self.actual_end and self.actual_hours is None:
            total_seconds = (self.actual_end - self.actual_start).total_seconds()
            total_seconds -= self.paused_seconds or 0
            if self.paused_at:
                total_seconds -= (now - self.paused_at).total_seconds()
            self.actual_hours = round(max(total_seconds, 0) / 3600, 2)

        super().save(*args, **kwargs)

    @property
    def has_real_time_tracking(self):
        """True quando a tarefa tem apontamento real completo: início, fim e
        horas calculadas. Tarefas concluídas pelo admin sem apontamento
        retornam False e não alimentam métricas de horas reais."""
        return bool(self.actual_start and self.actual_end and self.actual_hours is not None)

    @property
    def planned_hours(self):
        """Duração prevista em horas, calculada a partir das datas planejadas.
        Representa planejamento — nunca deve ser usado como hora real."""
        if self.planned_start and self.planned_end:
            return round(max((self.planned_end - self.planned_start).total_seconds(), 0) / 3600, 2)
        return 0.0

    @property
    def worked_hours(self):
        """Horas reais de relógio medidas por apontamento.
        Retorna 0.0 se não houver apontamento real completo — a duração
        planejada não é mais usada como fallback."""
        if self.has_real_time_tracking:
            return float(self.actual_hours)
        return 0.0

    @property
    def real_man_hours(self):
        """Homem-hora real: soma de actual_hours por técnico quando disponível,
        senão fallback para worked_hours × num_assignees (tarefas sem
        rastreamento por assignment — dados históricos).
        Requer prefetch_related('assignments') para evitar N+1."""
        assignments = list(self.assignments.all())
        # Preferência: somar horas individuais por técnico (rastreamento por assignment).
        assignment_hours = [float(a.actual_hours) for a in assignments if a.actual_hours is not None]
        if assignment_hours:
            return round(sum(assignment_hours), 2)
        # Fallback: tarefa com apontamento real mas sem rastreamento por assignment.
        if not self.has_real_time_tracking:
            return 0.0
        assignee_count = len(assignments) or 1
        return round(self.worked_hours * assignee_count, 2)

    # --- Status por técnico: a tarefa é o agregado dos despachos -----------

    def _fresh_assignments(self):
        """Consulta direta (não usa o prefetch de 'assignments'), pra refletir
        o que acabou de ser salvo nos assignments."""
        if not self.pk:
            return []
        return list(ProjectTaskAssignment.objects.filter(project_task_id=self.pk).order_by("id"))

    @staticmethod
    def _execution_hours(assignments):
        """Duração da tarefa: tempo em que pelo menos um técnico esteve em
        execução (união dos intervalos de cada técnico, sem pausas). Não conta
        duas vezes a mesma janela quando a equipe trabalha em paralelo."""
        intervals = sorted(interval for a in assignments for interval in a.working_intervals())
        if not intervals:
            return None
        total_seconds = 0.0
        current_start, current_end = intervals[0]
        for start, end in intervals[1:]:
            if start <= current_end:
                current_end = max(current_end, end)
            else:
                total_seconds += (current_end - current_start).total_seconds()
                current_start, current_end = start, end
        total_seconds += (current_end - current_start).total_seconds()
        return round(total_seconds / 3600, 2)

    def sync_from_assignments(self):
        """Recalcula o status e os dados agregados da TAREFA a partir dos
        técnicos despachados. Chamado sempre que um assignment muda.

        - status: o mesmo de todos os técnicos (cancelados ignorados); senão
          em andamento se alguém executa; pausada se alguém pausou; em
          andamento se alguém já concluiu e o resto não; senão não iniciada.
          A tarefa só fica concluída quando TODOS concluírem.
        - actual_start / actual_end: primeiro início e último fim dos técnicos
          (actual_end só existe quando a tarefa conclui).
        - actual_hours: duração da tarefa (ver _execution_hours).
        - completion_outcome / quantity_done: agregados dos técnicos.

        Sem técnicos despachados, o status manual da tarefa é mantido."""
        assignments = self._fresh_assignments()
        if not assignments:
            return

        statuses = [a.status for a in assignments if a.status != self.STATUS_CANCELED]
        if not statuses:
            new_status = self.STATUS_CANCELED
        elif len(set(statuses)) == 1:
            new_status = statuses[0]
        elif self.STATUS_IN_PROGRESS in statuses:
            new_status = self.STATUS_IN_PROGRESS
        elif self.STATUS_PAUSED in statuses:
            new_status = self.STATUS_PAUSED
        elif self.STATUS_COMPLETED in statuses:
            new_status = self.STATUS_IN_PROGRESS
        else:
            new_status = self.STATUS_NOT_STARTED

        starts = [a.assignment_start for a in assignments if a.assignment_start]
        ends = [a.assignment_end for a in assignments if a.assignment_end]
        self.status = new_status
        self.actual_start = min(starts) if starts else None
        if new_status == self.STATUS_COMPLETED:
            self.actual_end = max(ends) if ends else (self.actual_end or timezone.now())
            self.actual_hours = self._execution_hours(assignments)
        else:
            self.actual_end = None
            self.actual_hours = None
        self.completion_outcome = max(
            (a.completion_outcome for a in assignments if a.completion_outcome),
            key=COMPLETION_OUTCOME_SEVERITY.get,
            default="",
        )
        self.quantity_done = ", ".join(a.quantity_done for a in assignments if a.quantity_done)
        # update_fields: quem chama pode ter uma instância desatualizada (ex.: bulk
        # update), e um save() cheio sobrescreveria campos alterados no meio do caminho.
        self.save(
            update_fields=[
                "status", "actual_start", "actual_end", "actual_hours",
                "completion_outcome", "quantity_done", "updated_at",
            ]
        )

    def set_status_by_admin(self, status):
        """Ajuste do administrador para a tarefa inteira: aplica o status a
        todos os técnicos despachados SEM registrar horas (decisão do time:
        ajustes do admin não entram nos indicadores de técnico e ficam sem
        apontamento). Tarefa sem técnico recebe só o status."""
        assignments = self._fresh_assignments()
        if not assignments:
            self.status = status
            if status == self.STATUS_COMPLETED and not self.actual_end:
                self.actual_end = timezone.now()
            self.save(update_fields=["status", "actual_end", "updated_at"])
            return
        for assignment in assignments:
            if assignment.status != status:
                assignment.status = status
                assignment.paused_at = assignment.paused_at if status == self.STATUS_PAUSED else None
                assignment.save(update_fields=["status", "paused_at", "updated_at"])
        self.sync_from_assignments()

    def set_assignment_status_by_admin(self, collaborator_id, status, completion_outcome=None):
        """Ajuste do administrador para UM técnico (sem apontamento de horas).
        Levanta ProjectTaskAssignment.DoesNotExist se o técnico não estiver
        despachado para esta tarefa."""
        assignment = ProjectTaskAssignment.objects.get(project_task_id=self.pk, collaborator_id=collaborator_id)
        assignment.status = status
        assignment.paused_at = assignment.paused_at if status == self.STATUS_PAUSED else None
        update_fields = ["status", "paused_at", "updated_at"]
        if completion_outcome is not None:
            assignment.completion_outcome = completion_outcome
            update_fields.append("completion_outcome")
        assignment.save(update_fields=update_fields)
        self.sync_from_assignments()


COMPLETION_OUTCOME_SEVERITY = {"": 0, "completed": 1, "partial": 2, "blocked": 3}


class ProjectTaskAssignment(TimestampedModel):
    """Through model de ProjectTask.collaborators — guarda quem despachou a
    tarefa pra cada técnico, quando, e a posição dela na fila do técnico
    (várias tarefas podem ser despachadas pra um técnico, mas só uma fica
    'em execução' por vez; as demais aguardam nessa ordem)."""

    project_task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="assignments")
    collaborator = models.ForeignKey(Collaborator, on_delete=models.CASCADE, related_name="task_assignments")
    dispatched_at = models.DateTimeField("despachado em", auto_now_add=True)
    dispatched_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="despachado por",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    queue_order = models.PositiveIntegerField("posição na fila", default=0)

    # Rastreamento de tempo por técnico — cada assignment tem seu próprio
    # intervalo: contabiliza a partir de quando ESTE técnico iniciou/concluiu,
    # independente do que outros técnicos da mesma tarefa fizeram.
    assignment_start = models.DateTimeField("início do técnico", null=True, blank=True)
    assignment_end = models.DateTimeField("fim do técnico", null=True, blank=True)
    paused_at = models.DateTimeField("pausado em", null=True, blank=True)
    paused_seconds = models.FloatField("segundos pausado", default=0)
    actual_hours = models.DecimalField(
        "horas reais do técnico", max_digits=8, decimal_places=2, null=True, blank=True
    )
    # Status do PRÓPRIO técnico nesta tarefa. A ProjectTask.status é o agregado
    # de todos os assignments (ver ProjectTask.sync_from_assignments): a tarefa
    # só fica concluída quando todos concluírem, mas cada técnico inicia,
    # pausa e finaliza a sua.
    status = models.CharField(
        "status do técnico", max_length=20, choices=ProjectTask.STATUS_CHOICES, default=ProjectTask.STATUS_NOT_STARTED
    )
    completion_outcome = models.CharField(
        "resultado da finalização (técnico)", max_length=20, choices=ProjectTask.COMPLETION_OUTCOME_CHOICES, blank=True
    )
    quantity_done = models.CharField("quantidade executada (técnico)", max_length=100, blank=True)
    # Intervalos [início, fim] (ISO 8601) em que este técnico esteve pausado.
    # Necessário para somar o tempo de execução de vários técnicos sem contar
    # duas vezes a mesma janela (ver ProjectTask.sync_from_assignments).
    pause_log = models.JSONField("pausas do técnico", default=list, blank=True)
    # Apontamento corrigido pelo administrador (ver dispatch.adjustments) — vale como real.
    is_adjusted = models.BooleanField("ajustado pelo administrador", default=False)
    # Horas repartidas de um bloco de trabalho apontado pelo técnico (dispatch.blocks): estimativa
    # dentro do bloco, não um cronômetro da tarefa.
    time_allocated = models.BooleanField("horas alocadas de um bloco", default=False)
    # Bloco em que as horas foram apontadas (dispatch.WorkBlock); nulo para apontamento tarefa a tarefa.
    work_block = models.ForeignKey(
        "dispatch.WorkBlock", verbose_name="bloco de trabalho", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="assignments",
    )

    class Meta:
        verbose_name = "Despacho de Tarefa"
        verbose_name_plural = "Despachos de Tarefa"
        ordering = ("queue_order", "dispatched_at")
        constraints = [
            models.UniqueConstraint(fields=("project_task", "collaborator"), name="unique_assignment_per_task_collaborator")
        ]

    # Os métodos abaixo só alteram o objeto em memória; quem chama salva.

    def _close_pause(self, now):
        """Fecha a pausa em aberto (se houver), somando-a em paused_seconds e
        registrando o intervalo em pause_log."""
        if not self.paused_at:
            return
        self.paused_seconds = (self.paused_seconds or 0) + (now - self.paused_at).total_seconds()
        self.pause_log = [*(self.pause_log or []), [self.paused_at.isoformat(), now.isoformat()]]
        self.paused_at = None

    def record_start(self, now):
        """Início (ou retomada) deste técnico."""
        if not self.assignment_start:
            self.assignment_start = now
        self._close_pause(now)

    def record_pause(self, now):
        """Pausa deste técnico (ex.: pausa manual ou bloqueio de site)."""
        if not self.paused_at and self.assignment_start:
            self.paused_at = now

    def record_complete(self, end_time):
        """Conclusão deste técnico: fecha pausa em aberto e calcula actual_hours
        a partir dos intervalos de execução."""
        self._close_pause(end_time)
        if not self.assignment_end:
            self.assignment_end = end_time
        intervals = self.working_intervals()
        if intervals:
            self.actual_hours = round(sum((end - start).total_seconds() for start, end in intervals) / 3600, 2)

    def working_intervals(self):
        """[(início, fim)] em que ESTE técnico esteve em execução: do início
        até o fim, descontando cada pausa registrada em pause_log."""
        if not self.assignment_start or not self.assignment_end:
            return []
        cursor = self.assignment_start
        intervals = []
        for pause_start, pause_end in sorted(
            (parse_datetime(start), parse_datetime(end)) for start, end in (self.pause_log or [])
        ):
            if pause_start > cursor:
                intervals.append((cursor, min(pause_start, self.assignment_end)))
            cursor = max(cursor, pause_end)
            if cursor >= self.assignment_end:
                break
        if cursor < self.assignment_end:
            intervals.append((cursor, self.assignment_end))
        return [(start, end) for start, end in intervals if end > start]

    def __str__(self):
        return f"{self.project_task} → {self.collaborator}"


def merged_worked_hours(tasks):
    """Soma horas trabalhadas de um conjunto de ProjectTask evitando contar
    duas vezes o tempo em que houve sobreposição (ex: técnico inicia várias
    tarefas ao mesmo tempo e as conclui dentro da mesma janela — cada tarefa
    tem sua própria duração de X minutos, mas o tempo real trabalhado foi só
    X minutos, não X × número de tarefas).

    Mescla os intervalos [actual_start, actual_end] que se sobrepõem antes de
    somar a duração; tarefas sem actual_start/actual_end (usam a estimativa de
    `worked_hours`) são somadas à parte, sem tentar detectar sobreposição."""
    intervals = []
    flat_hours = 0.0
    for task in tasks:
        if task.actual_start and task.actual_end and task.actual_hours is not None:
            intervals.append((task.actual_start, task.actual_end))
        else:
            flat_hours += task.worked_hours  # 0.0 para tarefas sem apontamento real

    intervals.sort(key=lambda interval: interval[0])
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    merged_seconds = sum((end - start).total_seconds() for start, end in merged)
    return round(merged_seconds / 3600 + flat_hours, 2)


class ProjectOccurrence(TimestampedModel):
    SEVERITY_LOW = "low"
    SEVERITY_MEDIUM = "medium"
    SEVERITY_HIGH = "high"
    SEVERITY_CRITICAL = "critical"
    SEVERITY_CHOICES = (
        (SEVERITY_LOW, "Baixa"),
        (SEVERITY_MEDIUM, "Média"),
        (SEVERITY_HIGH, "Alta"),
        (SEVERITY_CRITICAL, "Crítica"),
    )

    STATUS_OPEN = "open"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_RESOLVED = "resolved"
    STATUS_CANCELED = "canceled"
    STATUS_CHOICES = (
        (STATUS_OPEN, "Aberta"),
        (STATUS_IN_PROGRESS, "Em Andamento"),
        (STATUS_RESOLVED, "Resolvida"),
        (STATUS_CANCELED, "Cancelada"),
    )

    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="occurrences")
    title = models.CharField("título", max_length=200)
    description = models.TextField("descrição", blank=True)
    responsible = models.ForeignKey(
        Collaborator, verbose_name="responsável", on_delete=models.SET_NULL, null=True, blank=True, related_name="occurrences"
    )
    severity = models.CharField("criticidade", max_length=20, choices=SEVERITY_CHOICES, default=SEVERITY_MEDIUM)
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_OPEN)
    occurred_at = models.DateField("data da ocorrência", default=timezone.now)
    resolved_at = models.DateField("data de resolução", null=True, blank=True)

    class Meta:
        verbose_name = "Ocorrência do Projeto"
        verbose_name_plural = "Ocorrências do Projeto"
        ordering = ("-occurred_at", "-id")

    def __str__(self):
        return f"{self.project} - {self.title}"

    def save(self, *args, **kwargs):
        if self.status == self.STATUS_RESOLVED and not self.resolved_at:
            self.resolved_at = timezone.now().date()
        elif self.status != self.STATUS_RESOLVED:
            self.resolved_at = None
        super().save(*args, **kwargs)


def project_attachment_upload_to(instance, filename):
    return f"project_attachments/{instance.project_id}/{filename}"


class ProjectAttachment(TimestampedModel):
    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField("arquivo", upload_to=project_attachment_upload_to)
    description = models.CharField("descrição", max_length=255, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="enviado por",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        editable=False,
        related_name="project_attachments",
    )

    class Meta:
        verbose_name = "Anexo do Projeto"
        verbose_name_plural = "Anexos do Projeto"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.project} - {self.file.name.rsplit('/', 1)[-1]}"


class ProjectProgressSnapshot(TimestampedModel):
    """Percentual de avanço de um projeto num dia — gravado pelo envio
    automático das 15h (ver bot.views.BotDailyProjectReportBroadcastView).

    Existe só para responder "quanto andou HOJE": o avanço atual é sempre
    calculado na hora a partir das ProjectTask, então sem um retrato diário
    não há com o que comparar. Um registro por projeto por dia; rodar o
    envio mais de uma vez no mesmo dia só atualiza o registro daquele dia."""

    project = models.ForeignKey(
        Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="progress_snapshots"
    )
    date = models.DateField("data")
    percent = models.PositiveIntegerField("avanço (%)", default=0)

    class Meta:
        verbose_name = "Retrato de Avanço do Projeto"
        verbose_name_plural = "Retratos de Avanço do Projeto"
        ordering = ("-date", "project")
        constraints = [
            models.UniqueConstraint(fields=("project", "date"), name="unique_progress_snapshot_per_day"),
        ]

    def __str__(self):
        return f"{self.project} - {self.date} - {self.percent}%"


class ProjectHourEntry(TimestampedModel):
    """Horas históricas lançadas por projeto (ex.: planilha de apontamento dos
    supervisores). Entram SOMENTE no total de horas do projeto — nunca em
    produtividade, utilização, ranking ou estimativa por técnico/atividade,
    que continuam vindo só do apontamento por tarefa (ProjectTaskAssignment).
    `person_name` é texto livre, só para rastreabilidade."""

    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="hour_entries")
    work_date = models.DateField("data")
    person_name = models.CharField("pessoa", max_length=150, blank=True)
    hours_normal = models.DecimalField("horas normais", max_digits=6, decimal_places=2, default=0)
    hours_50 = models.DecimalField("horas 50%", max_digits=6, decimal_places=2, default=0)
    hours_100 = models.DecimalField("horas 100%", max_digits=6, decimal_places=2, default=0)
    total_hours = models.DecimalField("total de horas", max_digits=6, decimal_places=2, default=0)
    work_location = models.CharField("local", max_length=50, blank=True)
    comments = models.TextField("comentários", blank=True)
    source = models.CharField("origem", max_length=50, default="PLANILHA_SUPERVISOR")
    source_reference = models.CharField("referência na origem", max_length=200, blank=True)

    class Meta:
        verbose_name = "Hora histórica do projeto"
        verbose_name_plural = "Horas históricas dos projetos"
        ordering = ("-work_date", "id")
        indexes = [models.Index(fields=("project", "work_date"), name="proj_hourentry_proj_date_idx")]

    def __str__(self):
        return f"{self.project} - {self.work_date} - {self.total_hours}h"

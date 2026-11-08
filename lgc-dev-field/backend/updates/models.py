from datetime import timedelta

from django.conf import settings
from django.core.validators import MaxValueValidator
from django.db import models
from django.utils import timezone

from core.models import Collaborator, TimestampedModel
from projects.models import Project


def tomorrow():
    return timezone.localdate() + timedelta(days=1)


class DailyUpdate(TimestampedModel):
    allocation_date = models.DateField("data da alocação", default=tomorrow, db_index=True)
    description = models.TextField(
        "descritivo para envio",
        blank=True,
        editable=False,
        help_text="Mensagem gerada automaticamente para envio aos técnicos.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="enviado por",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        editable=False,
        related_name="created_daily_updates",
    )

    class Meta:
        verbose_name = "Atualização Diária"
        verbose_name_plural = "Atualizações Diárias"
        ordering = ("-allocation_date", "-created_at")

    def __str__(self):
        project_names = ", ".join(self.allocations.values_list("project__name", flat=True))
        return f"{self.allocation_date:%d/%m/%Y} — {project_names or 'Sem Projeto'}"

    @property
    def sites(self):
        return (
            self.allocations.exclude(project__site=None)
            .order_by("project__site__name")
            .values_list("project__site__name", flat=True)
            .distinct()
        )

    def build_description(self):
        sender = ""
        if self.created_by_id:
            sender = self.created_by.get_full_name() or self.created_by.get_username()

        lines = [
            "ATUALIZAÇÃO DIÁRIA",
            "",
            f"Data da alocação: {self.allocation_date:%d/%m/%Y}",
            "",
            "PROJETOS:",
        ]
        for allocation in self.allocations.select_related("project", "project__site").prefetch_related("collaborators").order_by("project__name"):
            project = allocation.project
            project_code = f" ({project.code})" if project.code else ""
            site_name = project.site.name if project.site else "Não informado"
            po = project.po or "Não informada"
            collaborators = ", ".join(
                allocation.collaborators.order_by("person__name").values_list("person__name", flat=True)
            )
            lines.extend(
                (
                    f"• {project.name}{project_code}",
                    f"  PO: {po}",
                    f"  Site: {site_name}",
                    f"  Colaboradores: {collaborators or 'Não informados'}",
                    "",
                )
            )
        if sender:
            lines.append(f"Enviado por: {sender}")
        return "\n".join(lines)

    def refresh_description(self):
        description = self.build_description()
        if self.description != description:
            type(self).objects.filter(pk=self.pk).update(description=description)
            self.description = description


class DailyUpdateAllocation(models.Model):
    daily_update = models.ForeignKey(
        DailyUpdate,
        verbose_name="atualização diária",
        on_delete=models.CASCADE,
        related_name="allocations",
    )
    project = models.ForeignKey(
        Project,
        verbose_name="projeto",
        on_delete=models.PROTECT,
        related_name="daily_update_allocations",
        limit_choices_to={"status__in": (Project.STATUS_IN_PROGRESS, Project.STATUS_PLANNING)},
    )
    collaborators = models.ManyToManyField(
        Collaborator,
        verbose_name="colaboradores",
        related_name="daily_update_allocations",
    )

    class Meta:
        verbose_name = "Alocação de Projeto"
        verbose_name_plural = "Alocações de Projetos"
        ordering = ("project__name", "pk")
        constraints = [
            models.UniqueConstraint(
                fields=("daily_update", "project"),
                name="unique_project_per_daily_update",
            )
        ]

    def __str__(self):
        return self.project.name


class ProjectDailyUpdate(TimestampedModel):
    project = models.ForeignKey(
        Project,
        verbose_name="projeto",
        on_delete=models.CASCADE,
        related_name="client_daily_updates",
    )
    date = models.DateField("data", default=timezone.localdate, db_index=True)
    collaborators = models.ManyToManyField(
        Collaborator,
        verbose_name="colaboradores",
        related_name="project_daily_updates",
        blank=True,
    )
    completion_percent = models.PositiveIntegerField(
        "percentual de conclusão",
        default=0,
        validators=[MaxValueValidator(100)],
    )
    activities_text = models.TextField(
        "atividades executadas",
        blank=True,
        help_text="Uma atividade por linha. Preenchido automaticamente ao salvar pela primeira vez.",
    )
    certification_done = models.BooleanField("certificação finalizada", default=False)
    project_finished = models.BooleanField("projeto finalizado", default=False)
    summary = models.TextField(
        "observações",
        blank=True,
        help_text="Observações adicionais (opcional).",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="criado por",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        editable=False,
        related_name="created_project_daily_updates",
    )
    sent_at = models.DateTimeField("enviado em", null=True, blank=True, editable=False)

    class Meta:
        verbose_name = "Atualização de Projeto"
        verbose_name_plural = "Atualizações de Projeto"
        ordering = ("-date", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("project", "date"),
                name="unique_project_daily_update_per_date",
            )
        ]

    def __str__(self):
        return f"{self.project} — {self.date:%d/%m/%Y}"

    @property
    def project_tasks(self):
        return (
            self.project.project_tasks.select_related("task")
            .prefetch_related("collaborators")
            .order_by("order", "id")
        )

    @property
    def is_sent(self):
        return self.sent_at is not None

    def save(self, *args, **kwargs):
        creating = self._state.adding
        super().save(*args, **kwargs)
        if creating:
            self.populate_defaults()

    def populate_defaults(self):
        """Preenche automaticamente colaboradores, percentual, atividades,
        certificação e status de finalização com base no projeto e na data.
        Só roda na criação (os colaboradores ficam livres para edição depois
        disso); percentual/atividades/certificação/finalização continuam
        sendo recalculados a cada visualização — ver refresh_from_tasks()."""
        from .project_client_mail import compute_progress_defaults

        defaults = compute_progress_defaults(self.project, self.date)
        self.collaborators.set(defaults["collaborator_ids"])
        self.refresh_from_tasks()

    def refresh_from_tasks(self):
        """Recalcula percentual, atividades executadas, certificação e status
        de finalização a partir do estado atual das ProjectTask do projeto.
        Chamado sempre que a Atualização é visualizada/exportada (tela de
        Atualizações de Projeto, PDF, e-mail, bot do WhatsApp), para nunca
        mostrar dados congelados no momento em que o registro foi criado."""
        from .project_client_mail import compute_progress_defaults

        defaults = compute_progress_defaults(self.project, self.date)
        fields = {
            "completion_percent": defaults["percent"],
            "activities_text": defaults["activities_text"],
            "certification_done": defaults["certification_done"],
            "project_finished": defaults["project_finished"],
        }
        changed = any(getattr(self, field) != value for field, value in fields.items())
        if changed:
            type(self).objects.filter(pk=self.pk).update(**fields)
            for field, value in fields.items():
                setattr(self, field, value)

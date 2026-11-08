"""Eventos `field.project.*` enviados ao Core (contrato fixo: o PT-09 do Core consome).

Todos levam `axis_project_id` e `field_project_id` (id da obra no Field). Só obra com `axis_project_id`
(criada ou vinculada ao Axis) emite eventos. Os eventos entram no outbox na transação de quem chama.

| Evento | Quando |
|---|---|
| `field.project.created` | obra criada, com a situação final do plano da SOW |
| `field.project.started` | primeira tarefa iniciada (uma vez por obra) |
| `field.project.progress` | diário (`manage.py axis_progress_snapshot`) e quando a SOW gera as tarefas |
| `field.project.completed` | todas as tarefas (não canceladas) concluídas (uma vez por obra) |
"""

from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models import Project, ProjectTask

from . import outbox

CREATED = "field.project.created"
STARTED = "field.project.started"
PROGRESS = "field.project.progress"
COMPLETED = "field.project.completed"

STARTED_TASK_STATUSES = (
    ProjectTask.STATUS_IN_PROGRESS,
    ProjectTask.STATUS_PAUSED,
    ProjectTask.STATUS_WAITING_QAQC,
    ProjectTask.STATUS_COMPLETED,
)


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _base(project: Project) -> dict:
    return {"axis_project_id": str(project.axis_project_id), "field_project_id": project.pk}


def project_url(project: Project) -> str:
    """Link da obra no Field (relativo quando `FRONTEND_URL` não está configurada)."""
    return f"{settings.FRONTEND_URL}/projetos/{project.pk}"


def planned_man_hours(project: Project) -> float:
    """Soma das horas das funções de campo da equipe prevista (`field_role` ausente conta como campo)."""
    total = Decimal("0")
    for line in project.planned_team or []:
        if not isinstance(line, dict) or line.get("field_role") is False:
            continue
        try:
            total += Decimal(str(line.get("hours") or 0))
        except Exception:  # noqa: BLE001 — linha malformada não derruba o evento
            continue
    return float(round(total, 2))


def progress_metrics(project: Project) -> dict:
    """Avanço e horas da obra.

    - `tasks_total`/`tasks_done`/`percent_complete`: ignoram tarefas canceladas (mesma conta do Painel de Sites);
    - `real_man_hours`: regra 1 do CLAUDE.md §8 — soma de `ProjectTask.real_man_hours` (horas reais de cada técnico,
      descontadas as pausas), nunca duração × técnicos; horas de tarefa cancelada contam porque foram trabalhadas;
    - `planned_man_hours`: horas das funções de campo da equipe prevista."""
    tasks = list(ProjectTask.objects.filter(project=project).prefetch_related("assignments"))
    valid = [t for t in tasks if t.status != ProjectTask.STATUS_CANCELED]
    done = sum(1 for t in valid if t.status == ProjectTask.STATUS_COMPLETED)
    return {
        "percent_complete": round(done / len(valid) * 100) if valid else 0,
        "tasks_total": len(valid),
        "tasks_done": done,
        "real_man_hours": round(sum(t.real_man_hours for t in tasks), 2),
        "planned_man_hours": planned_man_hours(project),
    }


def emit_created(project: Project, *, tasks_count: int | None = None):
    if not project.axis_project_id:
        return None
    if tasks_count is None:
        tasks_count = ProjectTask.objects.filter(project=project).exclude(status=ProjectTask.STATUS_CANCELED).count()
    status = project.sow_plan_status if project.sow_plan_status in {
        Project.SOW_PLAN_GENERATED, Project.SOW_PLAN_PENDING_REVIEW, Project.SOW_PLAN_FAILED, Project.SOW_PLAN_NO_SOW,
    } else Project.SOW_PLAN_PENDING_REVIEW
    return outbox.enqueue(
        CREATED,
        {
            **_base(project),
            "field_project_code": project.code,
            "url": project_url(project),
            "status": project.status,
            "sow_plan_status": status,
            "tasks_count": tasks_count,
            "created_at": _iso(project.created_at),
        },
    )


def emit_started(project: Project, started_at):
    return outbox.enqueue(
        STARTED, {**_base(project), "started_at": _iso(started_at)}, occurred_at=started_at
    )


def emit_progress(project: Project, *, day=None, metrics: dict | None = None):
    day = day or timezone.localdate()
    return outbox.enqueue(
        PROGRESS, {**_base(project), "date": day.isoformat(), **(metrics or progress_metrics(project))}
    )


def emit_completed(project: Project, completed_at):
    return outbox.enqueue(
        COMPLETED, {**_base(project), "completed_at": _iso(completed_at)}, occurred_at=completed_at
    )


def check_lifecycle(project_id: int, *, started_at=None) -> list[str]:
    """Detecta a primeira tarefa iniciada e a obra concluída e enfileira o evento **uma vez**.

    A marca fica em `Project.axis_started_at`/`axis_completed_at` e é gravada por `UPDATE ... WHERE <marca> IS NULL`
    na mesma transação do evento: duas chamadas ao mesmo tempo não duplicam. Chamada pelo sinal de `ProjectTask`
    e pelo `axis_progress_snapshot` (cobre `.update()` em massa, que não dispara sinal)."""
    emitted = []
    with transaction.atomic():
        project = Project.objects.filter(pk=project_id, axis_project_id__isnull=False).first()
        if project is None:
            return emitted
        tasks = ProjectTask.objects.filter(project=project)
        if project.axis_started_at is None:
            first = (
                tasks.filter(status__in=STARTED_TASK_STATUSES).order_by("actual_start", "id").first()
                or tasks.filter(actual_start__isnull=False).order_by("actual_start", "id").first()
            )
            if first is not None:
                moment = started_at or first.actual_start or timezone.now()
                if Project.objects.filter(pk=project.pk, axis_started_at__isnull=True).update(axis_started_at=moment):
                    project.axis_started_at = moment
                    emit_started(project, moment)
                    emitted.append(STARTED)
        if project.axis_completed_at is None:
            valid = tasks.exclude(status=ProjectTask.STATUS_CANCELED)
            if valid.exists() and not valid.exclude(status=ProjectTask.STATUS_COMPLETED).exists():
                moment = timezone.now()
                if Project.objects.filter(pk=project.pk, axis_completed_at__isnull=True).update(axis_completed_at=moment):
                    project.axis_completed_at = moment
                    emit_completed(project, moment)
                    emitted.append(COMPLETED)
    return emitted

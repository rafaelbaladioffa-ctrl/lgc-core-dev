"""Sinais que alimentam os eventos `field.project.started/completed` (PT-08).

Rodam na transação do `save()` da tarefa, então o evento entra no outbox junto com a escrita. `.update()` em
massa não dispara sinal: o `manage.py axis_progress_snapshot` refaz a checagem todo dia."""

from django.db.models.signals import post_save
from django.dispatch import receiver

from projects.models import ProjectTask

from . import field_events


@receiver(post_save, sender=ProjectTask, dispatch_uid="axis_integration_task_lifecycle")
def task_lifecycle(sender, instance, raw=False, **kwargs):
    if raw:  # carga de fixtures
        return
    relevant = field_events.STARTED_TASK_STATUSES + (ProjectTask.STATUS_CANCELED,)
    if instance.status not in relevant and not instance.actual_start:
        return
    field_events.check_lifecycle(instance.project_id)

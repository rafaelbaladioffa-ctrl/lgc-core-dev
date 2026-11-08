"""Regras que mantêm o status de presença do técnico coerente com os despachos."""
from django.utils import timezone

from .models import TechnicianDailyPresence, TechnicianStatusEvent


def has_running_assignment(collaborator_id):
    """True se o técnico tem algum despacho DELE em andamento."""
    from projects.models import ProjectTask, ProjectTaskAssignment

    return ProjectTaskAssignment.objects.filter(
        collaborator_id=collaborator_id, status=ProjectTask.STATUS_IN_PROGRESS
    ).exists()


def release_stuck_execution(collaborator_id, *, today=None):
    """"Em Execução" só existe enquanto o técnico tem um despacho em andamento.

    Quando o último despacho em andamento some (desalocado, devolvido ao pool,
    tarefa excluída, responsável trocado, ajuste do admin...), a presença de hoje
    volta pra "Disponível" e a troca entra no histórico. Só mexe quando o status
    atual é exatamente "Em Execução": um status escolhido pelo técnico (Café,
    Almoço, Fim de Expediente...) nunca é atropelado. Devolve True se liberou."""
    today = today or timezone.localdate()
    presence = TechnicianDailyPresence.objects.filter(
        collaborator_id=collaborator_id, date=today, status=TechnicianDailyPresence.STATUS_IN_PROGRESS
    ).first()
    if presence is None or has_running_assignment(collaborator_id):
        return False
    presence.status = TechnicianDailyPresence.STATUS_AVAILABLE
    presence.save(update_fields=("status", "updated_at"))
    TechnicianStatusEvent.objects.create(
        collaborator_id=collaborator_id,
        date=presence.date,
        status=TechnicianDailyPresence.STATUS_AVAILABLE,
        changed_at=timezone.now(),
    )
    return True

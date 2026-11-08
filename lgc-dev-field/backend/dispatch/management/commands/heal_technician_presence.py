from django.core.management.base import BaseCommand
from django.utils import timezone

from dispatch.models import TechnicianDailyPresence
from dispatch.services import has_running_assignment, release_stuck_execution


class Command(BaseCommand):
    help = (
        "Libera o status 'Em Execução' preso de HOJE (técnico sem nenhum despacho em andamento). "
        "Dias anteriores só são listados: não há como saber a que horas a execução realmente terminou."
    )

    def handle(self, *args, **options):
        today = timezone.localdate()
        stuck = TechnicianDailyPresence.objects.filter(status=TechnicianDailyPresence.STATUS_IN_PROGRESS)
        released = 0
        past = []
        for presence in stuck.select_related("collaborator__person"):
            if has_running_assignment(presence.collaborator_id):
                continue
            if presence.date == today:
                released += release_stuck_execution(presence.collaborator_id, today=today)
            else:
                past.append(f"{presence.collaborator} em {presence.date}")
        self.stdout.write(self.style.SUCCESS(f"Liberados hoje: {released}."))
        if past:
            self.stdout.write(f"Dias anteriores ainda presos em Em Execução ({len(past)}), não alterados:")
            for line in past:
                self.stdout.write(f"  - {line}")

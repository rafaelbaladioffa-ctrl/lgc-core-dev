"""Envia ao Core os eventos `field.project.*` pendentes (outbox do Field), com backoff.

Agende a cada minuto (cron/compose). A tentativa imediata depois do commit já cobre o caso comum; este comando
cobre o Core fora do ar, o processo reiniciado no meio e os eventos já vencidos."""

from django.core.management.base import BaseCommand

from axis_integration import outbox
from axis_integration.models import AxisOutboxEvent


class Command(BaseCommand):
    help = "Despacha o outbox do Field para o Core (POST /integration/inbound)."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100, help="Máximo de eventos por execução (padrão 100).")
        parser.add_argument(
            "--retry-dead", action="store_true", help="Reabre os eventos que esgotaram as tentativas antes de despachar."
        )

    def handle(self, *args, **options):
        if options["retry_dead"]:
            reopened = AxisOutboxEvent.objects.filter(status=AxisOutboxEvent.STATUS_DEAD).update(
                status=AxisOutboxEvent.STATUS_PENDING, attempts=0
            )
            self.stdout.write(f"Reabertos: {reopened}")
        summary = outbox.dispatch_pending(limit=options["limit"])
        if summary["skipped_not_configured"]:
            self.stderr.write(
                f"AXIS_OUTBOUND_SECRET/AXIS_API_URL não configurados: {summary['skipped_not_configured']} evento(s) continuam na fila."
            )
        self.stdout.write(f"Enviados: {summary['sent']}; com falha (nova tentativa agendada): {summary['failed']}.")

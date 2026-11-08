"""Retoma o plano automático da SOW das obras que ficaram `pending` (thread que não rodou) ou `processing`
travadas há mais de 15 min. Também aceita `--project <id>` para reprocessar uma obra `pending`."""

from django.core.management.base import BaseCommand

from axis_integration import sow_plan


class Command(BaseCommand):
    help = "Processa a SOW pendente das obras criadas a partir do Axis."

    def add_arguments(self, parser):
        parser.add_argument("--project", type=int, help="Id da obra no Field.")
        parser.add_argument("--limit", type=int, default=20)

    def handle(self, *args, **options):
        if options["project"]:
            status = sow_plan.run(options["project"])
            self.stdout.write(f"Obra {options['project']}: {status or 'nada a fazer (não está pendente)'}")
            return
        summary = sow_plan.run_pending(limit=options["limit"])
        self.stdout.write(f"Plano da SOW processado: {summary or 'nada pendente'}")

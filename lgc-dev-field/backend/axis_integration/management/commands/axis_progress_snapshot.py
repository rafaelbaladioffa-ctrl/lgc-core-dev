"""Evento diário `field.project.progress` de cada obra ligada ao Axis (agendar uma vez por dia).

Também refaz a checagem de `started`/`completed` (cobre mudanças em massa, que não disparam sinal).
Rodar de novo no mesmo dia só gera outro evento se algum número mudou."""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from axis_integration import field_events
from axis_integration.models import AxisOutboxEvent
from projects.models import Project


class Command(BaseCommand):
    help = "Enfileira field.project.progress (diário) para as obras do Axis em andamento."

    def add_arguments(self, parser):
        parser.add_argument("--date", help="AAAA-MM-DD (padrão: hoje, America/Sao_Paulo).")

    def handle(self, *args, **options):
        day = timezone.datetime.fromisoformat(options["date"]).date() if options.get("date") else timezone.localdate()
        emitted = skipped = 0
        projects = Project.objects.filter(axis_project_id__isnull=False, is_active=True).exclude(
            status__in=(Project.STATUS_CANCELED,)
        )
        for project in projects:
            field_events.check_lifecycle(project.pk)
            project.refresh_from_db()
            if project.axis_completed_at and project.status == Project.STATUS_COMPLETED:
                skipped += 1
                continue
            metrics = field_events.progress_metrics(project)
            if metrics["tasks_total"] == 0:
                skipped += 1
                continue
            same = AxisOutboxEvent.objects.filter(
                event_type=field_events.PROGRESS,
                payload__axis_project_id=str(project.axis_project_id),
                payload__date=day.isoformat(),
            ).order_by("-created_at").first()
            if same is not None and all(same.payload.get(k) == v for k, v in metrics.items()):
                skipped += 1
                continue
            with transaction.atomic():
                field_events.emit_progress(project, day=day, metrics=metrics)
            emitted += 1
        self.stdout.write(f"Eventos enfileirados: {emitted}; obras sem mudança ou sem tarefas: {skipped}.")

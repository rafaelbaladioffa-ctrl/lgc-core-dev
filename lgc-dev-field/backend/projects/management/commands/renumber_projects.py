from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.models import ConsultimerProjectType
from projects.models import Project, ProjectCodeSequence, build_structured_code


class Command(BaseCommand):
    help = (
        "Aplica o código estruturado (SIGLA+CLIENTE+SITE+AAMM+SEQ) aos projetos existentes. "
        "Projetos sem tipo Consultimer recebem --default-type. Sequencial anual na ordem de criação."
    )

    def add_arguments(self, parser):
        parser.add_argument("--default-type", required=True, help="Sigla do tipo para projetos sem tipo (ex: DEP)")
        parser.add_argument("--apply", action="store_true", help="Grava as alterações (sem isso é só simulação)")

    def handle(self, *args, **options):
        default_type = ConsultimerProjectType.objects.filter(code=options["default_type"].upper()).first()
        if default_type is None:
            raise CommandError("Tipo Consultimer não encontrado.")

        projects = list(Project.objects.select_related("client", "site", "consultimer_type").order_by("created_at", "id"))
        counters = {}
        plan, skipped = [], []
        for project in projects:
            if not (project.client_id and project.site_id and project.client.number and project.site.code):
                skipped.append(project)
                continue
            project.consultimer_type = project.consultimer_type or default_type
            created = timezone.localtime(project.created_at).date()
            counters[created.year] = counters.get(created.year, 0) + 1
            plan.append((project, build_structured_code(project, created, counters[created.year])))

        for project, new_code in plan[:5] + plan[-3:]:
            self.stdout.write(f"{project.code} -> {new_code}")
        self.stdout.write(f"{len(plan)} projetos a renumerar; {len(skipped)} ignorados (sem cliente/site): {[p.code for p in skipped]}")
        if not options["apply"]:
            self.stdout.write("Simulação — use --apply para gravar.")
            return

        with transaction.atomic():
            # Libera os códigos atuais antes (unicidade) e grava os novos.
            for project, _ in plan:
                Project.objects.filter(pk=project.pk).update(code=f"TMP-{project.pk}")
            for project, new_code in plan:
                Project.objects.filter(pk=project.pk).update(code=new_code, consultimer_type=project.consultimer_type)
            for year, last in counters.items():
                ProjectCodeSequence.objects.update_or_create(year=year, defaults={"last_number": last})
        self.stdout.write(self.style.SUCCESS(f"{len(plan)} projetos renumerados."))

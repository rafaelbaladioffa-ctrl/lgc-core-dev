import json

from django.core.management.base import BaseCommand, CommandError

from axis_integration.api_client import RESOURCES, AxisApiClient, AxisApiError, is_configured
from axis_integration.matching import build_unmatched_report, relink_all
from axis_integration.models import AxisMasterRecord
from axis_integration.sync import DEFAULT_RESOURCES, run_sync

KIND_LABELS = dict(AxisMasterRecord.KIND_CHOICES)


class Command(BaseCommand):
    help = (
        "Carga inicial dos cadastros do Axis Core (cargos, clientes, colaboradores, usuários, projetos, centros de "
        "custo, sites e feriados) pela API de consulta, casamento com os registros do Field, criação do que falta "
        "(MI-01: cliente, site, cargo, técnico/gestor e feriado) e aplicação dos campos do Core aos registros "
        "vinculados (MI-02). Usuário só é casado e espelha ativo/inativo. Não apaga nada."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--resources",
            nargs="+",
            choices=sorted(RESOURCES),
            default=DEFAULT_RESOURCES,
            help="Recursos a baixar (padrão: todos, na ordem que o casamento exige).",
        )
        parser.add_argument(
            "--report-only",
            action="store_true",
            help="Não consulta o Core: reaplica casamento, criação e campos do Core a partir do cache e mostra o "
            "relatório dos registros sem par.",
        )
        parser.add_argument("--json", action="store_true", help="Relatório em JSON (para arquivo ou outra ferramenta).")
        parser.add_argument("--limit", type=int, default=50, help="Máximo de linhas por lista no relatório de texto.")

    def handle(self, *args, **options):
        failed = []
        if options["report_only"]:
            relink_all()
        else:
            if not is_configured():
                raise CommandError("Configure AXIS_API_URL e AXIS_API_KEY (ver .env.example).")
            try:
                client = AxisApiClient()
            except AxisApiError as exc:
                raise CommandError(str(exc)) from exc
            self.stdout.write("Baixando cadastros do Core…")
            summary = run_sync(options["resources"], client=client, log=self.stdout.write)
            failed = [name for name, result in summary.items() if "erro" in result]
            relink_all()

        report = build_unmatched_report()
        if options["json"]:
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            self._print_report(report, options["limit"])
        if failed:
            raise CommandError(f"Falha ao consultar o Core: {', '.join(failed)}. Os demais recursos foram processados.")

    def _print_report(self, report, limit):
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Registros do Core sem par no Field"))
        for kind, rows in report["core_without_field"].items():
            self.stdout.write(f"\n{KIND_LABELS[kind]}: {len(rows)}")
            for row in rows[:limit]:
                label = " ".join(filter(None, (row["code"], row["name"]))) or row["axis_id"]
                self.stdout.write(f"  - {label} ({row['motivo']})")
            if len(rows) > limit:
                self.stdout.write(f"  … e mais {len(rows) - limit} (use --limit ou --json).")
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Registros ativos do Field sem par no Core"))
        for kind, rows in report["field_without_core"].items():
            self.stdout.write(f"\n{KIND_LABELS[kind]}: {len(rows)}")
            for row in rows[:limit]:
                self.stdout.write(f"  - {row['label']}")
            if len(rows) > limit:
                self.stdout.write(f"  … e mais {len(rows) - limit} (use --limit ou --json).")
        self.stdout.write(
            "\nNada foi apagado. Os registros vinculados receberam os campos do Core; o que é do Field (sites "
            "atendidos, regional, observações) não foi alterado."
        )

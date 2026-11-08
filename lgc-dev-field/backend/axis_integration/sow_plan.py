"""Plano automático da SOW da obra vinda do Core (PT-08, PA-17).

Roda DEPOIS do commit do webhook (em thread; `manage.py axis_sow_plan` retoma o que ficou para trás) e é
idempotente: a obra só entra no processamento uma vez (`pending` -> `processing` por UPDATE condicional).

Passos (os mesmos do Fluxo Guiado da SOW, sem a IA — o parser é só o determinístico):
1. baixa o PDF no Core (API key) e extrai o texto (`pypdf`);
2. cria o `SowImport` ligado à obra e roda o parser determinístico;
3. se TODOS os itens vieram sem aviso e sem exigir revisão: aprova, resolve os templates, gera as tarefas e as
   envia ao projeto, sozinho (`generated`);
4. senão para na etapa pendente (`pending_review`) e avisa o responsável: "Plano da SOW pendente de revisão";
5. falha de download/leitura/parse -> `failed` com o motivo (a obra continua criada).

No fim grava `field.project.created` (com a situação final) no outbox, na mesma transação do último estado, e,
se gerou tarefas, o primeiro `field.project.progress`.
"""

import io
import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from master_data.models import GeneratedTask, ScopeItem, SowImport
from master_data.services.sow_parser import service as sow_service
from master_data.services.task_dependency_generator import generate_dependencies_for_scope_item
from master_data.services.task_generator import TaskGenerationError, generate_tasks_for_scope_item
from master_data.services.task_rule_resolver import apply_resolution_to_scope_item
from projects.models import Project, ProjectTask
from projects.services import create_project_tasks_from_generated_tasks

from . import api_client, field_events, obra, outbox

logger = logging.getLogger(__name__)

STALE_PROCESSING = timedelta(minutes=15)


class PlanStop(Exception):
    """Fim esperado do passo automático: a revisão humana assume (ou o plano falhou)."""

    def __init__(self, status: str, note: str):
        super().__init__(note)
        self.status = status
        self.note = note


def schedule(project_id: int):
    """Chamado depois do commit do webhook: processa em segundo plano, sem segurar a resposta."""
    return outbox.run_in_background(run, project_id)


def _claim(project_id: int) -> bool:
    now = timezone.now()
    return bool(
        Project.objects.filter(pk=project_id, sow_plan_status=Project.SOW_PLAN_PENDING).update(
            sow_plan_status=Project.SOW_PLAN_PROCESSING, updated_at=now
        )
        or Project.objects.filter(
            pk=project_id, sow_plan_status=Project.SOW_PLAN_PROCESSING, updated_at__lt=now - STALE_PROCESSING
        ).update(updated_at=now)
    )


def _finish(project_id: int, status: str, note: str, *, tasks_count: int = 0):
    """Grava a situação final e os eventos na mesma transação."""
    with transaction.atomic():
        Project.objects.filter(pk=project_id).update(
            sow_plan_status=status, sow_plan_note=note[:2000], updated_at=timezone.now()
        )
        project = Project.objects.select_related("responsible_cstr__person__user").get(pk=project_id)
        field_events.emit_created(project, tasks_count=tasks_count)
        if status == Project.SOW_PLAN_GENERATED:
            field_events.emit_progress(project)
    if status in (Project.SOW_PLAN_PENDING_REVIEW, Project.SOW_PLAN_FAILED):
        title = "Plano da SOW pendente de revisão" if status == Project.SOW_PLAN_PENDING_REVIEW else "Plano da SOW falhou"
        obra.notify_project(project, title, f'Obra "{project.name}" ({project.code}): {note}')
    return project


def _download_text(project: Project) -> tuple[str, str, str]:
    try:
        content, filename, mime = api_client.download_project_document(project.axis_project_id, project.axis_sow_document_id)
    except api_client.AxisApiError as exc:
        raise PlanStop(Project.SOW_PLAN_FAILED, f"Não foi possível baixar a SOW do Axis: {exc}") from exc
    try:
        text = sow_service.extract_text_from_file(io.BytesIO(content))
    except sow_service.UnsupportedSourceTypeError as exc:
        raise PlanStop(Project.SOW_PLAN_FAILED, f"Não foi possível ler a SOW: {exc}") from exc
    return text, filename, mime


def _item_is_clean(item) -> bool:
    if item.warnings or item.requires_review:
        return False
    if item.item_type == "CABLE" and (not item.quantity or item.quantity <= 0 or item.suggested_cable_family_id is None):
        return False
    return True


def _run_flow(project: Project):
    text, filename, mime = _download_text(project)

    sow_import = SowImport.objects.create(
        title=f"SOW — {project.name}"[:200],
        source_type="PDF" if text and filename.lower().endswith(".pdf") else "TEXT",
        source_text=text,
        original_filename=filename[:255],
        mime_type=mime[:100],
    )
    Project.objects.filter(pk=project.pk).update(sow_import=sow_import)

    sow_service.process_sow_import(sow_import, use_ai=False)
    sow_import.refresh_from_db()
    if sow_import.status == "FAILED":
        raise PlanStop(Project.SOW_PLAN_FAILED, f"O parser não conseguiu ler a SOW ({sow_import.code}): {sow_import.error_message}")

    items = list(sow_import.parsed_items.filter(active=True).order_by("sequence"))
    flagged = [item for item in items if not _item_is_clean(item)]
    if not items or flagged:
        raise PlanStop(
            Project.SOW_PLAN_PENDING_REVIEW,
            f"Etapa pendente: Revisar Itens. {len(flagged)} de {len(items)} item(ns) da SOW {sow_import.code} "
            "têm aviso ou exigem revisão. Conclua em Cadastros Mestres > Fluxo Guiado (SOW).",
        )

    for item in items:
        sow_service.approve_sow_parsed_item(item, None)
    sow_service.finalize_sow_import(sow_import, None)

    scope_items = list(ScopeItem.objects.filter(source_reference=sow_import.code, active=True))
    unresolved = []
    for scope_item in scope_items:
        apply_resolution_to_scope_item(scope_item)
        scope_item.save(update_fields=("resolved_rule", "resolved_template", "rule_resolution_status", "updated_at"))
        if scope_item.rule_resolution_status != "RESOLVED":
            unresolved.append(scope_item.code)
    if unresolved:
        raise PlanStop(
            Project.SOW_PLAN_PENDING_REVIEW,
            f"Etapa pendente: Resolver Templates. {len(unresolved)} item(ns) de escopo da SOW {sow_import.code} "
            f"sem template ({', '.join(unresolved[:5])}). Conclua em Cadastros Mestres > Fluxo Guiado (SOW).",
        )

    try:
        with transaction.atomic():
            for scope_item in scope_items:
                generate_tasks_for_scope_item(scope_item, user=None)
                generate_dependencies_for_scope_item(scope_item)
            generated = GeneratedTask.objects.filter(scope_item__in=scope_items, active=True)
            result = create_project_tasks_from_generated_tasks(project, generated, user=None)
    except TaskGenerationError as exc:
        raise PlanStop(
            Project.SOW_PLAN_PENDING_REVIEW,
            f"Etapa pendente: Gerar Tarefas ({sow_import.code}): {exc}",
        ) from exc
    count = len(result["created"]) + len(result["existing"])
    if count == 0:
        raise PlanStop(Project.SOW_PLAN_PENDING_REVIEW, f"Etapa pendente: Gerar Tarefas. A SOW {sow_import.code} não gerou tarefas.")
    return count


def run(project_id: int) -> str | None:
    """Processa a SOW da obra. Devolve a situação final, ou None se outra execução já cuida dela."""
    if not _claim(project_id):
        return None
    project = Project.objects.get(pk=project_id)
    try:
        count = _run_flow(project)
    except PlanStop as stop:
        _finish(project_id, stop.status, stop.note, tasks_count=0)
        return stop.status
    except Exception as exc:  # noqa: BLE001 — qualquer falha vira "failed" com motivo; a obra continua criada
        logger.exception("Plano da SOW da obra %s falhou", project_id)
        _finish(project_id, Project.SOW_PLAN_FAILED, f"Erro inesperado ao processar a SOW: {exc.__class__.__name__}: {exc}")
        return Project.SOW_PLAN_FAILED
    _finish(project_id, Project.SOW_PLAN_GENERATED, f"{count} tarefa(s) geradas a partir da SOW.", tasks_count=count)
    return Project.SOW_PLAN_GENERATED


def run_pending(limit: int = 20) -> dict:
    """Retoma o que ficou `pending` (thread que não rodou) ou `processing` travado há mais de 15 min."""
    stale = timezone.now() - STALE_PROCESSING
    ids = list(
        Project.objects.filter(axis_project_id__isnull=False, axis_sow_document_id__isnull=False)
        .filter(Q(sow_plan_status=Project.SOW_PLAN_PENDING) | Q(sow_plan_status=Project.SOW_PLAN_PROCESSING, updated_at__lt=stale))
        .order_by("pk")
        .values_list("pk", flat=True)[:limit]
    )
    summary = {}
    for pk in ids:
        status = run(pk)
        if status:
            summary[status] = summary.get(status, 0) + 1
    return summary


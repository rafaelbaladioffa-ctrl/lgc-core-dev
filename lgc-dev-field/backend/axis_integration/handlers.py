"""Aplicação dos eventos do Core ao Field.

Os eventos de cadastro atualizam o cache (`AxisMasterRecord`), casam com o registro do Field e, desde a onda V3
(decisões MI-01 e MI-02 de docs/mapa-interoperabilidade.md), **o Core manda**: cliente, site, cargo, colaborador
(pessoa) e feriado são criados quando não têm par e recebem os campos do Core (ver `apply.py`); usuário só é
casado e espelha ativo/inativo. `project.approved` (PT-08) também cria (ou reaproveita) a obra, ver `obra.py`.
"""

import uuid

from .apply import sync_record
from .matching import pick
from .models import AxisMasterRecord

INACTIVE_PROJECT_STATUS = {"cancelado", "encerrado", "arquivado"}

APPROVED_EVENT = "project.approved"
NOT_APPLIED = "out_of_order"
APPLIED = "applied"

# tipo de evento -> (tipo de cadastro, campo com o id do Core)
EVENTS = {
    "collaborator.created": (AxisMasterRecord.KIND_COLLABORATOR, "collaborator_id"),
    "collaborator.updated": (AxisMasterRecord.KIND_COLLABORATOR, "collaborator_id"),
    "collaborator.offboarded": (AxisMasterRecord.KIND_COLLABORATOR, "collaborator_id"),
    "collaborator.cost_center_changed": (AxisMasterRecord.KIND_COLLABORATOR, "collaborator_id"),
    "client.created": (AxisMasterRecord.KIND_CLIENT, "client_id"),
    "client.updated": (AxisMasterRecord.KIND_CLIENT, "client_id"),
    "client.deleted": (AxisMasterRecord.KIND_CLIENT, "client_id"),
    "project.created": (AxisMasterRecord.KIND_PROJECT, "project_id"),
    "project.updated": (AxisMasterRecord.KIND_PROJECT, "project_id"),
    "project.status_changed": (AxisMasterRecord.KIND_PROJECT, "project_id"),
    "project.deleted": (AxisMasterRecord.KIND_PROJECT, "project_id"),
    "project.approved": (AxisMasterRecord.KIND_PROJECT, "project_id"),
    "cost_center.created": (AxisMasterRecord.KIND_COST_CENTER, "cost_center_id"),
    "cost_center.updated": (AxisMasterRecord.KIND_COST_CENTER, "cost_center_id"),
    "site.created": (AxisMasterRecord.KIND_SITE, "site_id"),
    "site.updated": (AxisMasterRecord.KIND_SITE, "site_id"),
    "user.created": (AxisMasterRecord.KIND_USER, "user_id"),
    "user.updated": (AxisMasterRecord.KIND_USER, "user_id"),
    "user.disabled": (AxisMasterRecord.KIND_USER, "user_id"),
    "job_title.created": (AxisMasterRecord.KIND_JOB_TITLE, "job_title_id"),
    "job_title.updated": (AxisMasterRecord.KIND_JOB_TITLE, "job_title_id"),
    "job_title.deleted": (AxisMasterRecord.KIND_JOB_TITLE, "job_title_id"),
    "holiday.created": (AxisMasterRecord.KIND_HOLIDAY, "holiday_id"),
    "holiday.updated": (AxisMasterRecord.KIND_HOLIDAY, "holiday_id"),
    "holiday.deleted": (AxisMasterRecord.KIND_HOLIDAY, "holiday_id"),
}


class EventRejected(Exception):
    """Evento malformado: o Core não deve reentregar (responde 400)."""


def is_supported(event_type: str) -> bool:
    return event_type in EVENTS


def extract_axis_id(event_type: str, payload: dict) -> uuid.UUID:
    kind, key = EVENTS[event_type]
    try:
        return uuid.UUID(str(payload.get(key)))
    except (ValueError, TypeError, AttributeError):
        raise EventRejected(f"{key} ausente ou inválido.") from None


def _active(event_type: str, kind: str, payload: dict, current: bool) -> bool:
    if event_type in ("collaborator.offboarded", "user.disabled") or payload.get("deleted"):
        return False
    if kind == AxisMasterRecord.KIND_USER and payload.get("status"):
        return str(payload["status"]).lower() in ("active", "ativo")
    if kind == AxisMasterRecord.KIND_COLLABORATOR and payload.get("status"):
        return payload["status"] != "desligado"
    if kind == AxisMasterRecord.KIND_PROJECT:
        if event_type == "project.deleted" or payload.get("deleted"):
            return False
        if payload.get("status"):
            return payload["status"] not in INACTIVE_PROJECT_STATUS
        return current
    if "active" in payload:
        return bool(payload["active"])
    return current


def peek_record(event_type: str, payload: dict):
    """Registro já guardado para este evento, sem alterar nada (o webhook decide se consulta o Core)."""
    kind, _ = EVENTS[event_type]
    return AxisMasterRecord.objects.filter(kind=kind, axis_id=extract_axis_id(event_type, payload)).first()


def apply_event(event_type: str, payload: dict, occurred_at, extra: dict | None = None) -> str:
    """Grava o cache e tenta o vínculo. Deve rodar dentro da transação que também registra o evento.

    `extra` são dados lidos do Core pela API de consulta (e-mail, CNPJ…) quando o evento não os trazia;
    o conteúdo do evento prevalece sobre eles por ser mais recente."""
    kind, _ = EVENTS[event_type]
    axis_id = extract_axis_id(event_type, payload)
    record, _created = AxisMasterRecord.objects.select_for_update().get_or_create(
        kind=kind, axis_id=axis_id, defaults={"source_occurred_at": None}
    )
    if event_type == APPROVED_EVENT:
        # A aprovação é uma ação, não estado: cria a obra mesmo que o cache já tenha um evento mais novo.
        from . import obra

        obra.apply_project_approved(payload, occurred_at)
    if record.source_occurred_at and record.source_occurred_at > occurred_at:
        return NOT_APPLIED  # entrega fora de ordem: o cache já tem um estado mais novo

    incoming = {k: v for k, v in payload.items() if k != "changed_fields"}
    data = {**(record.data or {}), **(extra or {}), **incoming}
    record.data = data
    record.code = str(pick(data, "code", "short_code", "matricula", "date", default=record.code or ""))[:100]
    record.name = str(pick(data, "name", "full_name", "fullName", "legal_name", "legalName", default=record.name or ""))[:255]
    record.active = _active(event_type, kind, payload, record.active)
    record.source_occurred_at = occurred_at
    record.save()

    sync_record(record)  # casa (ou cria) e aplica os campos do Core ao registro do Field
    return APPLIED

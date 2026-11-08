"""Carga inicial dos cadastros do Core (`manage.py axis_sync`)."""

import uuid

from django.utils import timezone

from . import handlers
from .api_client import ID_KEYS, RESOURCES, AxisApiClient, AxisApiError, AxisApiNotFound, normalize_core_row
from .apply import sync_record
from .matching import LINKED, pick
from .models import AxisMasterRecord

# Ordem importa: o site só casa depois do cliente; o colaborador usa o cargo; o usuário vem depois do colaborador.
DEFAULT_RESOURCES = ["job-titles", "clients", "collaborators", "users", "projects", "cost-centers", "sites", "holidays"]


def _snapshot_active(kind: str, data: dict, current: bool) -> bool:
    if kind == AxisMasterRecord.KIND_COLLABORATOR and data.get("status"):
        return data["status"] != "desligado"
    if kind == AxisMasterRecord.KIND_USER and data.get("status"):
        return str(data["status"]).lower() in ("active", "ativo")
    if kind == AxisMasterRecord.KIND_PROJECT and data.get("status"):
        return data["status"] not in handlers.INACTIVE_PROJECT_STATUS
    if "active" in data:
        return bool(data["active"])
    return current


def store_snapshot(kind: str, row: dict, fetched_at) -> AxisMasterRecord | None:
    """Grava uma linha da API de consulta no cache. Evento mais novo que a consulta prevalece."""
    data = normalize_core_row(kind, row)
    try:
        axis_id = uuid.UUID(str(data.get(ID_KEYS[kind])))
    except ValueError:
        return None
    record, _ = AxisMasterRecord.objects.get_or_create(kind=kind, axis_id=axis_id)
    newer_event = record.source_occurred_at and record.source_occurred_at > fetched_at
    record.data = {**data, **(record.data or {})} if newer_event else {**(record.data or {}), **data}
    merged = record.data
    record.code = str(pick(merged, "code", "short_code", "matricula", "date", default=record.code or ""))[:100]
    record.name = str(pick(merged, "name", "full_name", "legal_name", default=record.name or ""))[:255]
    if not newer_event:
        record.active = _snapshot_active(kind, data, record.active)
        record.source_occurred_at = fetched_at
    record.save()
    return record


def run_sync(resources=None, client: AxisApiClient | None = None, log=lambda message: None) -> dict:
    """Baixa os cadastros do Core, guarda no cache, casa, cria o que falta (MI-01) e aplica os campos do Core. Não apaga nada.

    Devolve `{recurso: {"lidos": n, "vinculados": n, "criados": n} | {"erro": texto}}`. Recurso inexistente no Core (ex.: `sites`
    antes do PT-01 entrar no ar) vira "indisponível" e não interrompe os demais."""
    client = client or AxisApiClient()
    summary = {}
    for resource in resources or DEFAULT_RESOURCES:
        kind = RESOURCES[resource]
        fetched_at = timezone.now()
        read = linked = created = 0
        try:
            for row in client.iter_all(resource):
                record = store_snapshot(kind, row, fetched_at)
                if record is None:
                    continue
                read += 1
                _obj, result = sync_record(record)
                linked += result in (LINKED, "created")
                created += result == "created"
        except AxisApiNotFound:
            summary[resource] = {"indisponivel": True}
            log(f"{resource}: indisponível no Core (rota não encontrada).")
            continue
        except AxisApiError as exc:
            summary[resource] = {"erro": str(exc)}
            log(f"{resource}: {exc}")
            continue
        summary[resource] = {"lidos": read, "vinculados": linked, "criados": created}
        log(f"{resource}: {read} lidos, {linked} com vínculo ({created} criados no Field).")
    return summary

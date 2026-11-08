"""`POST /api/v1/webhooks/axis` — receptor dos eventos do Axis Core.

Segue o receptor da Logística (`axis-webhook.service.ts`):
- assinatura HMAC-SHA256 do corpo bruto em `X-Axis-Signature: sha256=<hex>`, comparada com
  `hmac.compare_digest`;
- janela anti-replay sobre `occurred_at` (o Core reentrega com backoff por horas, então a janela é larga);
- deduplicação por `event_id` numa tabela própria, **na mesma transação** que grava o cache;
- falha ao aplicar devolve 5xx para o Core reentregar; o evento fica registrado como `failed`.
"""

import hashlib
import hmac
import json
import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import api_client, handlers
from .matching import has_match_keys
from .models import AxisInboxEvent, AxisMasterRecord

logger = logging.getLogger(__name__)

SIGNATURE_PREFIX = "sha256="
CLOCK_SKEW = timedelta(minutes=5)
# Só estes tipos precisam de dado que o evento do Core não traz (CNPJ/nome, e-mail).
ENRICH_RESOURCE = {AxisMasterRecord.KIND_CLIENT: "clients", AxisMasterRecord.KIND_COLLABORATOR: "collaborators"}


def _error(message: str, status: int):
    return JsonResponse({"detail": message}, status=status)


def signature_is_valid(raw_body: bytes, header: str | None) -> bool:
    secret = settings.AXIS_WEBHOOK_SECRET
    if not header or not header.startswith(SIGNATURE_PREFIX):
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode("utf-8"), header[len(SIGNATURE_PREFIX):].encode("utf-8"))


def _parse(raw_body: bytes):
    """Valida o envelope `{event_id, event_type, occurred_at, payload}`. Levanta `ValueError` em pt-BR."""
    try:
        body = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise ValueError("O corpo do evento não é um JSON válido.") from None
    if not isinstance(body, dict):
        raise ValueError("O corpo do evento não é um JSON válido.")
    try:
        event_id = uuid.UUID(str(body.get("event_id")))
    except ValueError:
        raise ValueError("event_id ausente ou inválido.") from None
    event_type = body.get("event_type")
    if not isinstance(event_type, str) or not event_type or len(event_type) > 100:
        raise ValueError("event_type ausente ou inválido.")
    occurred_at = parse_datetime(body["occurred_at"]) if isinstance(body.get("occurred_at"), str) else None
    if occurred_at is None:
        raise ValueError("occurred_at ausente ou inválido.")
    if timezone.is_naive(occurred_at):
        occurred_at = timezone.make_aware(occurred_at, timezone.utc)
    payload = body.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("payload ausente ou inválido.")

    now = timezone.now()
    if now - occurred_at > timedelta(hours=settings.AXIS_WEBHOOK_MAX_AGE_HOURS):
        raise ValueError("Evento fora da janela de validade (possível replay).")
    if occurred_at - now > CLOCK_SKEW:
        raise ValueError("occurred_at no futuro.")
    return event_id, event_type, occurred_at, payload


def _enrich(event_type: str, payload: dict) -> dict:
    """Completa o evento com dados do Core que ele não traz (ex.: `client.created` só leva id e código).

    Fora da transação: não segura conexão do banco durante uma chamada HTTP. Falha aqui não derruba o evento;
    o cadastro entra sem vínculo e o `manage.py axis_sync` casa depois."""
    kind, _ = handlers.EVENTS[event_type]
    resource = ENRICH_RESOURCE.get(kind)
    if resource is None or not api_client.is_configured():
        return {}
    axis_id = handlers.extract_axis_id(event_type, payload)
    record = handlers.peek_record(event_type, payload)
    known = {**(record.data if record else {}), **payload}
    if has_match_keys(kind, known):
        return {}
    try:
        row = api_client.AxisApiClient(timeout=5).get_one(resource, str(axis_id))
    except api_client.AxisApiError as exc:
        logger.warning("Evento %s sem dados de casamento e a consulta ao Core falhou: %s", event_type, exc)
        return {}
    return api_client.normalize_core_row(kind, row)


@csrf_exempt
@require_POST
def axis_webhook(request):
    if not settings.AXIS_WEBHOOK_SECRET:
        return _error("Webhook do Axis não configurado (AXIS_WEBHOOK_SECRET).", 503)
    raw_body = request.body
    if not signature_is_valid(raw_body, request.headers.get("X-Axis-Signature")):
        return _error("Assinatura ausente ou inválida.", 401)
    try:
        event_id, event_type, occurred_at, payload = _parse(raw_body)
        if handlers.is_supported(event_type):
            handlers.extract_axis_id(event_type, payload)  # id inválido é 400 já, antes de gravar o evento
    except (ValueError, handlers.EventRejected) as exc:
        return _error(str(exc), 400)

    if AxisInboxEvent.objects.filter(event_id=event_id).exclude(status=AxisInboxEvent.STATUS_FAILED).exists():
        return JsonResponse({"status": "duplicate", "event_id": str(event_id)})

    extra = _enrich(event_type, payload) if handlers.is_supported(event_type) else {}

    try:
        with transaction.atomic():
            inbox, created = AxisInboxEvent.objects.select_for_update().get_or_create(
                event_id=event_id,
                defaults={
                    "event_type": event_type,
                    "occurred_at": occurred_at,
                    "payload": payload,
                    "status": AxisInboxEvent.STATUS_PROCESSED,
                },
            )
            if not created:
                if inbox.status != AxisInboxEvent.STATUS_FAILED:
                    return JsonResponse({"status": "duplicate", "event_id": str(event_id)})  # corrida entre entregas
                inbox.attempts += 1
            if handlers.is_supported(event_type):
                outcome = handlers.apply_event(event_type, payload, occurred_at, extra)
                inbox.status = AxisInboxEvent.STATUS_PROCESSED
                inbox.note = outcome if outcome == handlers.NOT_APPLIED else ""
            else:
                inbox.status = AxisInboxEvent.STATUS_IGNORED
                inbox.note = "tipo de evento não consumido pelo Field"
            inbox.processed_at = timezone.now()
            inbox.save()
    except Exception as exc:  # noqa: BLE001 — qualquer falha vira 5xx para o Core reentregar
        logger.exception("Falha ao processar %s %s", event_type, event_id)
        AxisInboxEvent.objects.update_or_create(
            event_id=event_id,
            defaults={
                "event_type": event_type,
                "occurred_at": occurred_at,
                "payload": payload,
                "status": AxisInboxEvent.STATUS_FAILED,
                "note": f"{exc.__class__.__name__}: {exc}"[:500],
            },
        )
        return _error("Falha ao processar o evento.", 500)

    return JsonResponse({"status": inbox.status, "event_id": str(event_id)})

"""Outbox do Field -> Core (`POST {AXIS_API_URL}/integration/inbound`).

- `enqueue()` grava o evento em `AxisOutboxEvent` **na transação de quem chama** (regra 6 do AGENTS.md) e, se
  `AXIS_OUTBOUND_IMMEDIATE`, agenda uma tentativa logo após o commit (em thread, para não segurar a resposta).
- `dispatch_pending()` é o que `manage.py axis_outbox_dispatch` roda: envia os vencidos, com backoff
  exponencial (30 s, 60 s, 2 min... até 1 h) e `dead` depois de `AXIS_OUTBOUND_MAX_ATTEMPTS` falhas.
- Envelope `{event_id, event_type, occurred_at, source: "field", payload}`; cabeçalhos `Idempotency-Key`
  (= event_id), `X-Field-Signature: sha256=<hmac do corpo com AXIS_OUTBOUND_SECRET>` e, quando houver,
  `Authorization: Bearer <AXIS_API_KEY>` (o guard do Core então confere a assinatura contra o segredo
  daquele satélite).
"""

import hashlib
import hmac
import json
import logging
import threading
from datetime import timedelta

import requests
from django.conf import settings
from django.db import connections, transaction
from django.utils import timezone

from .models import AxisOutboxEvent

logger = logging.getLogger(__name__)

LEASE = timedelta(minutes=2)  # enquanto uma tentativa está em curso, ninguém mais pega o evento
MAX_BACKOFF_SECONDS = 3600


def is_configured() -> bool:
    return bool(settings.AXIS_OUTBOUND_SECRET and settings.AXIS_API_URL)


def sign(body: bytes) -> str:
    return "sha256=" + hmac.new(settings.AXIS_OUTBOUND_SECRET.encode("utf-8"), body, hashlib.sha256).hexdigest()


def run_in_background(func, *args):
    """Roda `func` numa thread (fora da requisição) ou na hora, conforme `AXIS_BACKGROUND_TASKS`."""
    if not settings.AXIS_BACKGROUND_TASKS:
        func(*args)
        return None

    def target():
        try:
            func(*args)
        except Exception:  # noqa: BLE001 — a thread nunca derruba o processo
            logger.exception("Falha em tarefa em segundo plano da integração Axis (%s)", getattr(func, "__name__", func))
        finally:
            connections.close_all()  # a thread tem conexão própria; não deixar vazar

    thread = threading.Thread(target=target, name="axis-background", daemon=True)
    thread.start()
    return thread


def enqueue(event_type: str, payload: dict, *, occurred_at=None) -> AxisOutboxEvent:
    """Grava o evento na transação corrente. O envio imediato só acontece depois do commit."""
    event = AxisOutboxEvent.objects.create(
        event_type=event_type, payload=payload, occurred_at=occurred_at or timezone.now()
    )
    if settings.AXIS_OUTBOUND_IMMEDIATE:
        transaction.on_commit(lambda: run_in_background(dispatch_one, event.pk))
    return event


def _backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(MAX_BACKOFF_SECONDS, 30 * 2 ** max(0, attempts - 1)))


def _claim(pk: int, now) -> AxisOutboxEvent | None:
    """Reserva o evento para esta tentativa (evita envio em dobro entre a thread e o comando)."""
    claimed = AxisOutboxEvent.objects.filter(
        pk=pk, status=AxisOutboxEvent.STATUS_PENDING, next_attempt_at__lte=now
    ).update(next_attempt_at=now + LEASE)
    return AxisOutboxEvent.objects.get(pk=pk) if claimed else None


def send(event: AxisOutboxEvent, *, session=None) -> bool:
    """Uma tentativa de envio. Devolve True se o Core aceitou (2xx). Atualiza o evento."""
    body = json.dumps(event.envelope(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": str(event.event_id),
        "X-Field-Signature": sign(body),
    }
    if settings.AXIS_API_KEY:
        headers["Authorization"] = f"Bearer {settings.AXIS_API_KEY}"
    url = f"{settings.AXIS_API_URL}/integration/inbound"
    error = ""
    try:
        response = (session or requests).post(url, data=body, headers=headers, timeout=settings.AXIS_OUTBOUND_TIMEOUT)
        if 200 <= response.status_code < 300:
            event.status = AxisOutboxEvent.STATUS_SENT
            event.sent_at = timezone.now()
            event.attempts += 1
            event.last_error = ""
            event.save(update_fields=("status", "sent_at", "attempts", "last_error"))
            return True
        error = f"O Core respondeu {response.status_code}."
    except requests.RequestException as exc:
        error = f"Falha de rede: {exc.__class__.__name__}"
    event.attempts += 1
    event.last_error = error[:500]
    if event.attempts >= settings.AXIS_OUTBOUND_MAX_ATTEMPTS:
        event.status = AxisOutboxEvent.STATUS_DEAD
    else:
        event.next_attempt_at = timezone.now() + _backoff(event.attempts)
    event.save(update_fields=("status", "attempts", "last_error", "next_attempt_at"))
    logger.warning("Evento %s %s não entregue ao Core (tentativa %s): %s", event.event_type, event.event_id, event.attempts, error)
    return False


def dispatch_one(pk: int, *, session=None) -> bool:
    if not is_configured():
        return False
    event = _claim(pk, timezone.now())
    return send(event, session=session) if event else False


def dispatch_pending(limit: int = 100, *, session=None) -> dict:
    """Envia os eventos vencidos, do mais antigo ao mais novo. Devolve um resumo."""
    summary = {"sent": 0, "failed": 0, "skipped_not_configured": 0}
    if not is_configured():
        summary["skipped_not_configured"] = AxisOutboxEvent.objects.filter(status=AxisOutboxEvent.STATUS_PENDING).count()
        return summary
    now = timezone.now()
    due = list(
        AxisOutboxEvent.objects.filter(status=AxisOutboxEvent.STATUS_PENDING, next_attempt_at__lte=now)
        .order_by("created_at", "id")
        .values_list("pk", flat=True)[:limit]
    )
    for pk in due:
        event = _claim(pk, timezone.now())
        if event is None:
            continue
        summary["sent" if send(event, session=session) else "failed"] += 1
    return summary

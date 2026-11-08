from datetime import date, datetime, time
from decimal import Decimal

from django.db.models.signals import m2m_changed, post_save, pre_delete, pre_save
from django.dispatch import receiver

from .context import current_audit_request
from .models import AuditLog


AUDITED_APPS = {"core", "projects", "updates", "users", "master_data"}
IGNORED_FIELDS = {"created_at", "updated_at", "last_login"}
SENSITIVE_FIELDS = {"password", "token", "secret", "api_key"}


def _is_audited(sender):
    return sender is not AuditLog and sender._meta.app_label in AUDITED_APPS


def _safe_value(field_name, value):
    if any(fragment in field_name.lower() for fragment in SENSITIVE_FIELDS):
        return "[conteúdo protegido]" if value else ""
    if value is None:
        return ""
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "pk"):
        return str(value.pk)
    return str(value)


def _snapshot(instance, safe=True):
    values = {}
    for field in instance._meta.concrete_fields:
        if field.name in IGNORED_FIELDS:
            continue
        value = field.value_from_object(instance)
        values[field.name] = _safe_value(field.name, value) if safe else str(value or "")
    return values


def _request_metadata():
    request = current_audit_request.get()
    if request is None:
        return {"actor": None, "origin": "Sistema", "path": "", "ip_address": None}
    user = getattr(request, "user", None)
    actor = user if getattr(user, "is_authenticated", False) and getattr(user, "pk", None) else None
    path = request.path[:500]
    if path.startswith("/admin/"):
        origin = "Django Admin"
    elif path.startswith("/api/"):
        origin = "API"
    else:
        origin = "Aplicação Web"
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip_address = (forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR")) or None
    return {"actor": actor, "origin": origin, "path": path, "ip_address": ip_address}


def _write_log(instance, action, field_name="", old_value="", new_value=""):
    AuditLog.objects.create(
        **_request_metadata(),
        app_label=instance._meta.app_label,
        model_name=str(instance._meta.verbose_name),
        object_pk=str(instance.pk or ""),
        object_repr=str(instance)[:500],
        action=action,
        field_name=field_name,
        old_value=old_value,
        new_value=new_value,
    )


@receiver(pre_save)
def capture_previous_values(sender, instance, **kwargs):
    if not _is_audited(sender) or not instance.pk:
        return
    try:
        previous = sender._default_manager.get(pk=instance.pk)
    except sender.DoesNotExist:
        return
    instance._audit_previous_values = _snapshot(previous, safe=False)


@receiver(post_save)
def audit_saved_model(sender, instance, created, **kwargs):
    if not _is_audited(sender):
        return
    current = _snapshot(instance)
    if created:
        _write_log(instance, AuditLog.ACTION_CREATE, new_value=str(current))
        return
    previous = getattr(instance, "_audit_previous_values", {})
    current_raw = _snapshot(instance, safe=False)
    for field_name, new_raw_value in current_raw.items():
        old_raw_value = previous.get(field_name, "")
        if old_raw_value != new_raw_value:
            _write_log(
                instance,
                AuditLog.ACTION_UPDATE,
                field_name,
                _safe_value(field_name, old_raw_value),
                current[field_name],
            )


@receiver(pre_delete)
def audit_deleted_model(sender, instance, **kwargs):
    if _is_audited(sender):
        _write_log(instance, AuditLog.ACTION_DELETE, old_value=str(_snapshot(instance)))


@receiver(m2m_changed)
def audit_many_to_many(sender, instance, action, reverse, model, pk_set, **kwargs):
    if instance._meta.app_label not in AUDITED_APPS or action not in {"post_add", "post_remove", "post_clear"}:
        return
    field_name = next(
        (
            field.name
            for field in instance._meta.many_to_many
            if field.remote_field.through is sender
        ),
        model._meta.verbose_name_plural,
    )
    values = ", ".join(map(str, sorted(pk_set or [])))
    if action == "post_add":
        _write_log(instance, AuditLog.ACTION_M2M_ADD, field_name, "", values)
    elif action == "post_remove":
        _write_log(instance, AuditLog.ACTION_M2M_REMOVE, field_name, values, "")
    else:
        _write_log(instance, AuditLog.ACTION_M2M_CLEAR, field_name)

"""Campos que o Axis Core manda nos cadastros casados (decisão MI-02, docs/integracao-core-field.md §3).

Registro com `axis_*_id` preenchido recebe esses campos do Core (webhook e `manage.py axis_sync`) e **não** os aceita
pela tela, pela API, pelo CSV nem pelo Django admin: a tela mostra "Mantido no Axis Core". O que não está aqui é do
Field e continua editável (ex.: sites atendidos pelo técnico, regional do site, observações e empresa do cliente).
Registro sem vínculo continua todo editável até casar.

Os nomes são os da API de Cadastros Gerais (`name`, `email` e `phone` do técnico ficam na `Person`).
"""

LOCKED_MESSAGE = "Mantido no Axis Core: altere este dado no Core."

# chave = `model_name` do Django
AXIS_ID_FIELDS = {
    "client": "axis_client_id",
    "site": "axis_site_id",
    "collaborator": "axis_collaborator_id",
    "jobtitle": "axis_job_title_id",
}

AXIS_LOCKED_FIELDS = {
    "client": ("legal_name", "trade_name", "tax_id", "email", "phone", "address", "city", "state", "is_active"),
    "site": (
        "client", "name", "code", "address", "city", "state", "manual_coordinates", "latitude", "longitude", "is_active",
    ),
    "collaborator": ("name", "email", "phone", "registration", "yellow_badge", "job_title", "manager", "is_active"),
    "jobtitle": ("name", "is_active"),
}

# Campos do técnico que moram na Person (o resto é do próprio Collaborator).
PERSON_FIELDS = ("name", "email", "phone")


def axis_id_of(obj):
    field = AXIS_ID_FIELDS.get(obj._meta.model_name)
    return getattr(obj, field, None) if field else None


def is_axis_linked(obj) -> bool:
    return obj is not None and getattr(obj, "pk", None) is not None and axis_id_of(obj) is not None


def locked_fields(obj) -> tuple:
    """Campos bloqueados deste registro (vazio se não for casado com o Core)."""
    if not is_axis_linked(obj):
        return ()
    return AXIS_LOCKED_FIELDS.get(obj._meta.model_name, ())


def model_locked_fields(obj) -> tuple:
    """Só os campos que são do próprio model (para `readonly_fields` do admin)."""
    fields = locked_fields(obj)
    if fields and obj._meta.model_name == "collaborator":
        return tuple(f for f in fields if f not in PERSON_FIELDS)
    return fields

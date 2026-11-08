"""Casamento dos cadastros do Core com os do Field.

Regras (docs/integracao-core-field.md §3):
- cliente: CNPJ (só dígitos); se não houver, nome normalizado;
- colaborador: e-mail corporativo; se não houver, matrícula;
- site: cliente já vinculado + código;
- usuário: e-mail.

Nada é criado nem apagado aqui: sem par único, o registro fica sem vínculo e aparece no relatório de
`manage.py axis_sync`. O vínculo é gravado com `update()` para não disparar o `save()` dos modelos do Field
(o do Site geocodifica o endereço pela internet).
"""

import re
import unicodedata

from core.models import Client, Collaborator, Site
from projects.models import Project
from users.models import User

from .models import AxisMasterRecord

# Resultado do casamento de um registro.
LINKED = "linked"  # já tinha par (ou acabou de ganhar)
NO_MATCH = "no_match"  # nenhum registro do Field serve
AMBIGUOUS = "ambiguous"  # mais de um serve: precisa de decisão humana
NO_CLIENT = "no_client"  # site cujo cliente ainda não tem par
NOT_APPLICABLE = "not_applicable"

_COMPANY_SUFFIX = re.compile(r"\b(ltda|eireli|epp|me|sa|s a|ss|cia|companhia|do brasil)\b")


def only_digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def normalize_name(value) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    text = _COMPANY_SUFFIX.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def pick(data: dict, *keys, default=None):
    """Primeiro valor não vazio entre `keys` (o Core usa snake_case nos eventos e camelCase na API de consulta)."""
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return default


def has_match_keys(kind: str, data: dict) -> bool:
    """O registro já traz o que o casamento precisa? Senão o webhook consulta o Core antes de gravar."""
    if kind == AxisMasterRecord.KIND_CLIENT:
        return bool(pick(data, "cnpj", "tax_id") or pick(data, "name", "legal_name", "legalName"))
    if kind == AxisMasterRecord.KIND_COLLABORATOR:
        return bool(pick(data, "email", "corporate_email", "corporateEmail", "registration", "matricula"))
    return True


def _unique(candidates):
    candidates = list(candidates)
    if len(candidates) == 1:
        return candidates[0], LINKED
    return None, (AMBIGUOUS if candidates else NO_MATCH)


def _link_client(record: AxisMasterRecord):
    current = Client.objects.filter(axis_client_id=record.axis_id).first()
    if current:
        return current, LINKED
    free = Client.objects.filter(axis_client_id__isnull=True)
    cnpj = only_digits(pick(record.data, "cnpj", "tax_id"))
    if len(cnpj) >= 11:
        client, result = _unique(c for c in free.exclude(tax_id="") if only_digits(c.tax_id) == cnpj)
        if result != NO_MATCH:
            return client, result
    name = normalize_name(pick(record.data, "name", "legal_name", "legalName"))
    if name:
        candidates = [
            c for c in free if name in ({normalize_name(c.legal_name), normalize_name(c.trade_name)} - {""})
        ]
        return _unique(candidates)
    return None, NO_MATCH


def _link_collaborator(record: AxisMasterRecord):
    current = Collaborator.objects.filter(axis_collaborator_id=record.axis_id).first()
    if current:
        return current, LINKED
    free = Collaborator.objects.filter(axis_collaborator_id__isnull=True).select_related("person")
    email = str(pick(record.data, "email", "corporate_email", "corporateEmail", default="")).strip().lower()
    if email:
        collaborator, result = _unique(c for c in free if c.person.email.strip().lower() == email)
        if result != NO_MATCH:
            return collaborator, result
    registration = str(pick(record.data, "registration", "matricula", default="")).strip()
    if registration:
        return _unique(free.filter(registration=registration))
    return None, NO_MATCH


def _link_site(record: AxisMasterRecord):
    current = Site.objects.filter(axis_site_id=record.axis_id).first()
    if current:
        return current, LINKED
    client_axis_id = pick(record.data, "client_id", "clientId")
    client = Client.objects.filter(axis_client_id=client_axis_id).first() if client_axis_id else None
    if client is None:
        return None, NO_CLIENT
    code = str(record.code or pick(record.data, "code", default="")).strip()
    if not code:
        return None, NO_MATCH
    return _unique(Site.objects.filter(client=client, axis_site_id__isnull=True, code__iexact=code))


def _link_user(record: AxisMasterRecord):
    current = User.objects.filter(axis_user_id=record.axis_id).first()
    if current:
        return current, LINKED
    email = str(pick(record.data, "email", default="")).strip()
    if not email:
        return None, NO_MATCH
    return _unique(User.objects.filter(axis_user_id__isnull=True, email__iexact=email))


def _link_project(record: AxisMasterRecord):
    # Neste pacote o projeto do Core só tem vínculo quando a obra já aponta para ele (axis_project_id).
    # Não há chave segura para casar sozinho (PROP-… × CSTR-PROJ-…); quem cria a obra é o PT-08.
    project = Project.objects.filter(axis_project_id=record.axis_id).first()
    return (project, LINKED) if project else (None, NO_MATCH)


_LINKERS = {
    AxisMasterRecord.KIND_CLIENT: (_link_client, Client, "axis_client_id"),
    AxisMasterRecord.KIND_COLLABORATOR: (_link_collaborator, Collaborator, "axis_collaborator_id"),
    AxisMasterRecord.KIND_SITE: (_link_site, Site, "axis_site_id"),
    AxisMasterRecord.KIND_USER: (_link_user, User, "axis_user_id"),
    AxisMasterRecord.KIND_PROJECT: (_link_project, Project, "axis_project_id"),
}


def link_record(record: AxisMasterRecord):
    """Tenta casar o registro e grava o `axis_*_id`. Devolve `(objeto_do_field | None, resultado)`."""
    entry = _LINKERS.get(record.kind)
    if entry is None:
        return None, NOT_APPLICABLE
    linker, model, field = entry
    obj, result = linker(record)
    if result == LINKED and getattr(obj, field) != record.axis_id:
        model.objects.filter(pk=obj.pk).update(**{field: record.axis_id})
        setattr(obj, field, record.axis_id)
        if record.kind == AxisMasterRecord.KIND_CLIENT:
            relink_sites_of_client(obj)
    if result == LINKED:
        sync_cost_center(record, obj)
    return obj, result


def sync_cost_center(record: AxisMasterRecord, obj) -> None:
    """Copia o centro de custo conhecido do Core para o colaborador/projeto vinculado."""
    if record.kind not in (AxisMasterRecord.KIND_COLLABORATOR, AxisMasterRecord.KIND_PROJECT):
        return
    if "cost_center_id" not in record.data:
        return
    value = record.data.get("cost_center_id") or None
    if str(obj.axis_cost_center_id or "") != str(value or ""):
        type(obj).objects.filter(pk=obj.pk).update(axis_cost_center_id=value)


def relink_sites_of_client(client: Client) -> int:
    """Cliente acabou de ganhar par: os sites do Core que esperavam por ele podem casar agora."""
    linked = 0
    pending = AxisMasterRecord.objects.filter(kind=AxisMasterRecord.KIND_SITE, data__client_id=str(client.axis_client_id))
    for record in pending:
        _, result = link_record(record)
        linked += result == LINKED
    return linked


def relink_all() -> dict:
    """Reaplica o casamento a todos os registros guardados (usado depois da carga do `axis_sync`)."""
    # Clientes antes dos sites: o site precisa do cliente já vinculado.
    order = [
        AxisMasterRecord.KIND_CLIENT,
        AxisMasterRecord.KIND_COLLABORATOR,
        AxisMasterRecord.KIND_USER,
        AxisMasterRecord.KIND_PROJECT,
        AxisMasterRecord.KIND_SITE,
    ]
    counts = {}
    for kind in order:
        counts[kind] = {LINKED: 0, NO_MATCH: 0, AMBIGUOUS: 0, NO_CLIENT: 0}
        for record in AxisMasterRecord.objects.filter(kind=kind):
            _, result = link_record(record)
            counts[kind][result] = counts[kind].get(result, 0) + 1
    return counts


def build_unmatched_report() -> dict:
    """Registros sem par dos dois lados. Nada é apagado nem alterado: é só leitura para tratamento manual."""
    report = {"core_without_field": {}, "field_without_core": {}}
    for kind, (_, model, field) in _LINKERS.items():
        linked_ids = set(model.objects.exclude(**{f"{field}__isnull": True}).values_list(field, flat=True))
        orphans = [r for r in AxisMasterRecord.objects.filter(kind=kind) if r.axis_id not in linked_ids]
        report["core_without_field"][kind] = [
            {"axis_id": str(r.axis_id), "code": r.code, "name": r.name, "active": r.active, "motivo": _reason(r)}
            for r in orphans
        ]
    field_sets = {
        AxisMasterRecord.KIND_CLIENT: Client.objects.filter(axis_client_id__isnull=True, is_active=True),
        AxisMasterRecord.KIND_COLLABORATOR: Collaborator.objects.filter(
            axis_collaborator_id__isnull=True, is_active=True
        ).select_related("person"),
        AxisMasterRecord.KIND_SITE: Site.objects.filter(axis_site_id__isnull=True, is_active=True).select_related("client"),
        AxisMasterRecord.KIND_USER: User.objects.filter(axis_user_id__isnull=True, is_active=True),
        AxisMasterRecord.KIND_PROJECT: Project.objects.filter(axis_project_id__isnull=True, is_active=True),
    }
    for kind, queryset in field_sets.items():
        report["field_without_core"][kind] = [{"id": obj.pk, "label": str(obj)} for obj in queryset]
    return report


def _reason(record: AxisMasterRecord) -> str:
    """Por que o registro do Core continua sem par (só diagnóstico; não grava nada)."""
    if record.kind == AxisMasterRecord.KIND_PROJECT:
        return "sem obra vinculada (a obra nasce no PT-08)"
    if record.kind == AxisMasterRecord.KIND_SITE:
        client_axis_id = pick(record.data, "client_id", "clientId")
        if not client_axis_id or not Client.objects.filter(axis_client_id=client_axis_id).exists():
            return "cliente do site sem par no Field"
        return "nenhum site do Field com este cliente e código"
    if not has_match_keys(record.kind, record.data):
        return "o Core não enviou os dados de casamento (rode axis_sync)"
    return "sem par único no Field"

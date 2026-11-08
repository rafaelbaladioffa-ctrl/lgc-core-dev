"""O Core manda (onda V3; decisões MI-01 e MI-02 de docs/mapa-interoperabilidade.md).

Depois do casamento (`matching.py`), os cadastros do Core passam a valer no Field:

- **cria** o que não tem par: cliente, site (do cliente já vinculado), cargo, feriado e colaborador (só quem o
  Field usa: cargo técnico ou nível de gestão diferente de `colaborador`). Ambíguo continua sem vínculo e vai para o
  relatório do `axis_sync`; inativo no Core não é criado.
- **aplica** os campos do Core ao registro vinculado (os mesmos que `core/axis_lock.py` bloqueia na tela, no CSV e no
  admin). Só entra o campo que o Core mandou: evento parcial não apaga o resto.
- **usuário** não é criado (o login pelo Core, F1, está pendente): só casa e espelha ativo/inativo.

Escreve dentro da transação do webhook. O site é gravado com `update()`/`bulk_create()` para o `save()` não chamar a
geocodificação pela internet; coordenadas vindas do Core marcam `manual_coordinates`, que também impede a
geocodificação de sobrescrevê-las depois. Conflito de unicidade (CNPJ na empresa, código do site no cliente, nome do
cargo na empresa) não derruba o evento: o campo fica como está e o motivo vai para o log.
"""

import logging
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils.dateparse import parse_date

from core.models import Client, Collaborator, Company, Holiday, JobTitle, Person, Site
from core.phone_utils import format_phone

from .matching import LINKED, NO_MATCH, link_record, only_digits, pick, relink_sites_of_client, sync_cost_center
from .models import AxisMasterRecord

logger = logging.getLogger(__name__)

CREATED = "created"
ADDRESS_KEYS = ("address_street", "address_number", "address_complement", "address_district", "cep")
NON_FIELD_LEVELS = ("", "colaborador")


def default_company():
    """Empresa do Field que recebe o que vem do Core: `AXIS_DEFAULT_COMPANY_ID`, senão a primeira ativa."""
    company_id = getattr(settings, "AXIS_DEFAULT_COMPANY_ID", None)
    if company_id:
        company = Company.objects.filter(pk=company_id).first()
        if company is not None:
            return company
        logger.warning("AXIS_DEFAULT_COMPANY_ID=%s não existe no Field; usando a primeira empresa ativa.", company_id)
    return Company.objects.filter(is_active=True).order_by("pk").first()


def sync_record(record: AxisMasterRecord):
    """Casa, cria se preciso e aplica os campos do Core. Devolve `(objeto | None, resultado)`."""
    obj, result = link_record(record)
    if result == NO_MATCH and record.active and record.kind in _CREATORS:
        try:
            with transaction.atomic():
                obj = _CREATORS[record.kind](record)
        except IntegrityError as exc:  # corrida ou dado repetido: fica sem vínculo e vai para o relatório
            logger.warning("Não foi possível criar %s %s no Field: %s", record.kind, record.axis_id, exc)
            obj = None
        if obj is not None:
            result = CREATED
            sync_cost_center(record, obj)
    if obj is not None and result in (LINKED, CREATED) and record.kind in _APPLIERS:
        _APPLIERS[record.kind](record, obj)
        if result == CREATED and record.kind == AxisMasterRecord.KIND_CLIENT:
            relink_sites_of_client(obj)  # sites do Core que esperavam por este cliente
    return obj, result


def should_create_collaborator(data: dict) -> bool:
    """MI-01: só entra no Field quem é técnico ou tem nível de gestão (supervisor, coordenador, gerente, diretor)."""
    if data.get("job_title_is_technician") is True:
        return True
    level = data.get("management_level")
    return level is not None and str(level).strip().lower() not in NON_FIELD_LEVELS


# --------------------------------------------------------------------------------------------------- utilitários


def _has(data: dict, *keys) -> bool:
    return any(key in data for key in keys)


def _text(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _format_tax_id(value) -> str:
    digits = only_digits(value)
    if len(digits) == 14:
        return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:]}"
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return _text(value, 18)


def _phone(value) -> str:
    return _text(format_phone(_text(value, 40)), 20)


def _address(data: dict) -> str:
    """Endereço em uma linha a partir dos campos do Core (`address_street`, número, complemento, bairro, CEP)."""
    if not _has(data, *ADDRESS_KEYS) and isinstance(data.get("address"), str):
        return _text(data["address"], 255)  # formato antigo
    street = ", ".join(filter(None, (_text(data.get("address_street"), 255), _text(data.get("address_number"), 20))))
    parts = [street, _text(data.get("address_complement"), 100), _text(data.get("address_district"), 100)]
    cep = _text(data.get("cep"), 12)
    if cep:
        parts.append(f"CEP {cep}")
    return " - ".join(filter(None, parts))[:255]


def _coordinate(value):
    try:
        return Decimal(str(round(float(value), 6)))
    except (TypeError, ValueError, InvalidOperation):
        return None


def _changes(obj, values: dict) -> dict:
    return {key: value for key, value in values.items() if getattr(obj, key) != value}


def _save(obj, values: dict) -> list:
    changed = _changes(obj, values)
    for key, value in changed.items():
        setattr(obj, key, value)
    if changed:
        obj.save(update_fields=[*changed, "updated_at"])
    return list(changed)


# -------------------------------------------------------------------------------------------------------- cliente


def _client_values(record: AxisMasterRecord) -> dict:
    data = record.data
    values = {"is_active": record.active}
    if _has(data, "legal_name", "name"):
        values["legal_name"] = _text(pick(data, "legal_name", "name", default=""), 255)
    if "trade_name" in data:
        values["trade_name"] = _text(data["trade_name"], 255)
    if _has(data, "cnpj", "tax_id"):
        values["tax_id"] = _format_tax_id(pick(data, "cnpj", "tax_id", default=""))
    if "email" in data:
        values["email"] = _text(data["email"], 254)
    if "phone" in data:
        values["phone"] = _phone(data["phone"])
    if _has(data, *ADDRESS_KEYS) or "address" in data:
        values["address"] = _address(data)
    if "address_city" in data:
        values["city"] = _text(data["address_city"], 100)
    if "address_state" in data:
        values["state"] = _text(data["address_state"], 2).upper()
    return values


def _tax_id_taken(company_id, tax_id, exclude_pk=None) -> bool:
    if not tax_id:
        return False
    return Client.objects.filter(company_id=company_id, tax_id=tax_id).exclude(pk=exclude_pk).exists()


def _create_client(record: AxisMasterRecord):
    company = default_company()
    values = _client_values(record)
    if company is None or not (values.get("legal_name") or values.get("trade_name")):
        return None
    if _tax_id_taken(company.pk, values.get("tax_id")):
        return None  # CNPJ já é de um cliente vinculado a outro id do Core: decisão humana
    return Client.objects.create(company=company, person_type="company", axis_client_id=record.axis_id, **values)


def _apply_client(record: AxisMasterRecord, client: Client) -> None:
    values = _client_values(record)
    if "tax_id" in values and values["tax_id"] != client.tax_id and _tax_id_taken(client.company_id, values["tax_id"], client.pk):
        logger.warning("CNPJ %s do cliente %s já existe em outro cliente do Field; mantido.", values["tax_id"], record.axis_id)
        values.pop("tax_id")
    _save(client, values)


# ----------------------------------------------------------------------------------------------------------- site


def _site_values(record: AxisMasterRecord, site: Site | None) -> dict:
    data = record.data
    values = {"is_active": record.active}
    if "name" in data:
        values["name"] = _text(data["name"], 150)
    if "code" in data:
        values["code"] = _text(data["code"], 30)
    if _has(data, *ADDRESS_KEYS) or "address" in data:
        values["address"] = _address(data)
    if "address_city" in data or "city" in data:
        values["city"] = _text(pick(data, "address_city", "city", default=""), 100)
    if "address_state" in data or "state" in data:
        values["state"] = _text(pick(data, "address_state", "state", default=""), 2).upper()
    client_axis_id = pick(data, "client_id", "clientId")
    if client_axis_id:
        client = Client.objects.filter(axis_client_id=client_axis_id).first()
        if client is not None:
            values["client"] = client
    latitude, longitude = _coordinate(data.get("latitude")), _coordinate(data.get("longitude"))
    if latitude is not None and longitude is not None:
        # Coordenada do Core vale como "manual": a geocodificação do Field não a sobrescreve.
        values.update(latitude=latitude, longitude=longitude, manual_coordinates=True)
        probe = Site(
            address=values.get("address", site.address if site else ""),
            city=values.get("city", site.city if site else ""),
            state=values.get("state", site.state if site else ""),
        )
        values["geocoded_address"] = probe.full_address
    return values


def _site_code_taken(client, code, exclude_pk=None) -> bool:
    if not code or client is None:
        return False
    return Site.objects.filter(client=client, code=code).exclude(pk=exclude_pk).exists()


def _create_site(record: AxisMasterRecord):
    values = _site_values(record, None)
    client = values.get("client")
    if client is None or not values.get("code") or _site_code_taken(client, values["code"]):
        return None
    site = Site(axis_site_id=record.axis_id, **values)
    Site.objects.bulk_create([site])  # bulk_create não chama o save() (geocodificação pela internet)
    return Site.objects.get(axis_site_id=record.axis_id)


def _apply_site(record: AxisMasterRecord, site: Site) -> None:
    values = _site_values(record, site)
    client = values.get("client", site.client)
    code = values.get("code", site.code)
    if (client.pk != site.client_id or code != site.code) and _site_code_taken(client, code, site.pk):
        logger.warning("Site %s: código %s já existe no cliente do Field; código e cliente mantidos.", record.axis_id, code)
        values.pop("code", None)
        values.pop("client", None)
    changed = _changes(site, values)
    if changed:
        Site.objects.filter(pk=site.pk).update(**changed)  # update() não geocodifica
        for key, value in changed.items():
            setattr(site, key, value)


# ---------------------------------------------------------------------------------------------------------- cargo


def _job_title_name_taken(company_id, name, exclude_pk=None) -> bool:
    if not name:
        return False
    return JobTitle.objects.filter(company_id=company_id, name__iexact=name).exclude(pk=exclude_pk).exists()


def _create_job_title(record: AxisMasterRecord):
    company = default_company()
    name = _text(record.data.get("name"), 100)
    if company is None or not name or _job_title_name_taken(company.pk, name):
        return None
    return JobTitle.objects.create(company=company, name=name, axis_job_title_id=record.axis_id, is_active=record.active)


def _apply_job_title(record: AxisMasterRecord, job_title: JobTitle) -> None:
    values = {"is_active": record.active}
    name = _text(record.data.get("name"), 100)
    if name and name != job_title.name:
        if _job_title_name_taken(job_title.company_id, name, job_title.pk):
            logger.warning("Cargo %s: já existe outro cargo %r na empresa; nome mantido.", record.axis_id, name)
        else:
            values["name"] = name
    _save(job_title, values)


def ensure_job_title(axis_id, name, is_technician=None):
    """Cargo do Field para o `job_title_id` do colaborador; cria a partir do próprio colaborador se o
    `job_title.*` ainda não chegou (a ordem dos eventos não importa)."""
    if not axis_id:
        return None
    found = JobTitle.objects.filter(axis_job_title_id=axis_id).first()
    if found is not None:
        return found
    record = AxisMasterRecord.objects.filter(kind=AxisMasterRecord.KIND_JOB_TITLE, axis_id=axis_id).first()
    if record is None:
        if not name:
            return None
        data = {"job_title_id": str(axis_id), "name": name}
        if is_technician is not None:
            data["is_technician"] = is_technician
        record = AxisMasterRecord.objects.create(
            kind=AxisMasterRecord.KIND_JOB_TITLE, axis_id=axis_id, name=str(name)[:255], data=data
        )
    obj, _ = sync_record(record)
    return obj


# -------------------------------------------------------------------------------------------------- colaborador


def _create_collaborator(record: AxisMasterRecord):
    data = record.data
    if not should_create_collaborator(data):
        return None
    company = default_company()
    name = _text(pick(data, "name", "full_name", default=""), 150)
    if company is None or not name:
        return None
    email = _text(pick(data, "email", "corporate_email", default=""), 254)
    person = None
    if email:
        person = Person.objects.filter(email__iexact=email, collaborator_role__isnull=True).first()
    if person is None:
        person = Person.objects.create(name=name, email=email, phone=_phone(data.get("phone")), company=company)
    elif person.company_id is None:
        person.company = company
        person.save(update_fields=["company", "updated_at"])
    return Collaborator.objects.create(person=person, axis_collaborator_id=record.axis_id)


def _apply_collaborator(record: AxisMasterRecord, collaborator: Collaborator) -> None:
    data = record.data
    person = collaborator.person
    person_values = {}
    if _has(data, "name", "full_name"):
        person_values["name"] = _text(pick(data, "name", "full_name", default=""), 150) or person.name
    if _has(data, "email", "corporate_email"):
        person_values["email"] = _text(pick(data, "email", "corporate_email", default=""), 254)
    if "phone" in data:
        person_values["phone"] = _phone(data["phone"])
    _save(person, person_values)

    status = str(data.get("status") or "")
    if not record.active and status != "desligado":
        status = "desligado"  # `offboarded` sem o estado completo (contrato anterior à V1)
    values = {"is_active": record.active, "axis_status": status[:20]}
    if _has(data, "matricula", "registration"):
        values["registration"] = _text(pick(data, "matricula", "registration", default=""), 30)
    if "yellow_badge" in data:
        values["yellow_badge"] = _text(data["yellow_badge"], 50)
    if "job_title_id" in data:
        job_title = ensure_job_title(data.get("job_title_id"), data.get("job_title_name"), data.get("job_title_is_technician"))
        if job_title is not None or not data.get("job_title_id"):
            values["job_title"] = job_title  # cargo que não deu para resolver (sem nome nem empresa) fica como está
    if "supervisor_id" in data:
        supervisor = None
        if data.get("supervisor_id"):
            supervisor = (
                Collaborator.objects.filter(axis_collaborator_id=data["supervisor_id"]).exclude(pk=collaborator.pk).first()
            )
        values["manager"] = supervisor  # supervisor que ainda não está no Field é resolvido quando chegar
    _save(collaborator, values)
    _resolve_direct_reports(record, collaborator)


def _resolve_direct_reports(record: AxisMasterRecord, supervisor: Collaborator) -> None:
    """Quem tem este colaborador como supervisor no Core e chegou antes dele passa a tê-lo como gestor."""
    pending = AxisMasterRecord.objects.filter(
        kind=AxisMasterRecord.KIND_COLLABORATOR, data__supervisor_id=str(record.axis_id)
    ).values_list("axis_id", flat=True)
    for report in Collaborator.objects.filter(axis_collaborator_id__in=list(pending)).exclude(pk=supervisor.pk):
        if report.manager_id != supervisor.pk:
            report.manager = supervisor
            report.save(update_fields=["manager", "updated_at"])


# -------------------------------------------------------------------------------------------- usuário e feriado


def _apply_user(record: AxisMasterRecord, user) -> None:
    """Espelha ativo/inativo (usuário desativado no Core não entra mais no Field). Não cria usuário."""
    if not _has(record.data, "status", "active"):
        return
    if user.is_active != record.active:
        user.is_active = record.active
        user.save(update_fields=["is_active"])


def _holiday_values(record: AxisMasterRecord) -> dict:
    values = {"is_active": record.active}
    day = parse_date(str(record.data.get("date") or "")[:10]) if record.data.get("date") else None
    if day is not None:
        values["date"] = day
    if "name" in record.data:
        values["name"] = _text(record.data["name"], 150)
    return values


def _create_holiday(record: AxisMasterRecord):
    values = _holiday_values(record)
    if "date" not in values:
        return None
    return Holiday.objects.create(axis_holiday_id=record.axis_id, **values)


def _apply_holiday(record: AxisMasterRecord, holiday: Holiday) -> None:
    _save(holiday, _holiday_values(record))


_CREATORS = {
    AxisMasterRecord.KIND_CLIENT: _create_client,
    AxisMasterRecord.KIND_SITE: _create_site,
    AxisMasterRecord.KIND_JOB_TITLE: _create_job_title,
    AxisMasterRecord.KIND_COLLABORATOR: _create_collaborator,
    AxisMasterRecord.KIND_HOLIDAY: _create_holiday,
}

_APPLIERS = {
    AxisMasterRecord.KIND_CLIENT: _apply_client,
    AxisMasterRecord.KIND_SITE: _apply_site,
    AxisMasterRecord.KIND_JOB_TITLE: _apply_job_title,
    AxisMasterRecord.KIND_COLLABORATOR: _apply_collaborator,
    AxisMasterRecord.KIND_USER: _apply_user,
    AxisMasterRecord.KIND_HOLIDAY: _apply_holiday,
}

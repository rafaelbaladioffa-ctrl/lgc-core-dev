"""`project.approved` do Core -> obra do Field (PT-08; PA-06, PA-17).

Um projeto do Core = um site = uma obra. A obra nasce em `planning`, ligada por `axis_project_id`; reentrega do
evento (ou outro `project.approved` do mesmo projeto) só reaproveita a obra existente. O que o Field não consegue
casar (cliente, site, responsável) vira **pendência visível** na obra (`axis_pending_issues`) e notificação aos
administradores: a obra é criada mesmo assim, o evento nunca se perde.

`apply_project_approved` roda DENTRO da transação do webhook; o que é lento (baixar a SOW) fica para depois do
commit (`sow_plan.schedule`).
"""

import logging
import uuid
from datetime import date

from django.db import transaction

from core.models import Client, Collaborator, Company, Responsible, Site, notify_user
from projects.models import Project
from users.models import User

from . import field_events, sow_plan
from .apply import sync_record
from .models import AxisMasterRecord

logger = logging.getLogger(__name__)


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _date(value):
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def _linked(model, field, axis_id, kind):
    """Objeto do Field com este id do Axis; se ainda não casou, casa (ou cria, MI-01) pelo cache e procura de novo."""
    if axis_id is None:
        return None
    found = model.objects.filter(**{field: axis_id}).first()
    if found:
        return found
    record = AxisMasterRecord.objects.filter(kind=kind, axis_id=axis_id).first()
    if record:
        sync_record(record)
        return model.objects.filter(**{field: axis_id}).first()
    return None


def _responsible_for(collaborator: Collaborator | None):
    if collaborator is None or not collaborator.person_id:
        return None
    responsible = Responsible.objects.filter(person_id=collaborator.person_id, kind=Responsible.KIND_CSTR, is_active=True).first()
    return responsible


def admins():
    return list(User.objects.filter(is_superuser=True, is_active=True))


def responsible_user(project: Project):
    if project.responsible_cstr_id and project.responsible_cstr.person_id:
        return project.responsible_cstr.person.user
    return None


def notify_project(project: Project, title: str, message: str, *, to_responsible=True):
    """Notificação in-app ao responsável da obra; sem responsável com usuário, aos administradores."""
    users = []
    user = responsible_user(project) if to_responsible else None
    users = [user] if user else admins()
    for target in users:
        notify_user(target, title=title, message=message, url=f"/projetos/{project.pk}", project_id=project.pk, project_code=project.code)
    return len(users)


def _pick_company(client, responsible):
    if client is not None and client.company_id:
        return client.company
    if responsible is not None and responsible.person_id and responsible.person.company_id:
        return responsible.person.company
    return Company.objects.filter(is_active=True).order_by("pk").first() or Company.objects.order_by("pk").first()


def apply_project_approved(payload: dict, occurred_at) -> tuple[Project, bool]:
    """Cria (ou reaproveita) a obra. Devolve `(obra, criada)`. Roda na transação do webhook."""
    axis_project_id = _uuid(payload.get("project_id"))
    quote = payload.get("accepted_quote") if isinstance(payload.get("accepted_quote"), dict) else {}
    site_data = payload.get("site") if isinstance(payload.get("site"), dict) else {}

    existing = Project.objects.select_for_update().filter(axis_project_id=axis_project_id).first()
    if existing is not None:
        cost_center = _uuid(payload.get("cost_center_id"))
        if cost_center and existing.axis_cost_center_id != cost_center:
            Project.objects.filter(pk=existing.pk).update(axis_cost_center_id=cost_center)
        return existing, False

    issues = []
    client = _linked(Client, "axis_client_id", _uuid(payload.get("client_id")), AxisMasterRecord.KIND_CLIENT)
    if client is None:
        issues.append("Cliente do Axis sem par no Field: vincule o cliente (manage.py axis_sync ou cadastro) e ajuste a obra.")

    site_axis_id = _uuid(site_data.get("site_id") or payload.get("site_id"))
    site = None
    if site_axis_id is None:
        issues.append("O projeto aprovado não trouxe site: informe o site da obra.")
    else:
        site = _linked(Site, "axis_site_id", site_axis_id, AxisMasterRecord.KIND_SITE)
        if site is None:
            label = site_data.get("code") or payload.get("site_code") or str(site_axis_id)
            issues.append(f"Site {label} do Axis sem par no Field: vincule o site e ajuste a obra.")
        elif client is not None and site.client_id != client.pk:
            issues.append(f"O site {site.code or site.name} pertence a outro cliente no Field: confira os cadastros.")
            site = None

    collaborator = _linked(
        Collaborator, "axis_collaborator_id", _uuid(payload.get("responsible_collaborator_id")), AxisMasterRecord.KIND_COLLABORATOR
    )
    responsible = _responsible_for(collaborator)
    if responsible is None:
        if payload.get("responsible_collaborator_id"):
            why = "colaborador sem par no Field" if collaborator is None else "colaborador sem cadastro de Responsável CSTR"
            issues.append(f"Responsável do projeto no Axis sem correspondente no Field ({why}): defina o Responsável CSTR da obra.")
        else:
            issues.append("O projeto aprovado não tem responsável: defina o Responsável CSTR da obra.")

    company = _pick_company(client, responsible)
    if company is None:
        raise ValueError("Não há empresa cadastrada no Field para criar a obra.")

    start = _date(quote.get("planned_start_date")) or _date(payload.get("planned_start_date"))
    end = _date(quote.get("planned_end_date")) or _date(payload.get("planned_end_date"))
    if start and end and end < start:
        issues.append("As datas previstas do Axis estão invertidas: confira início e término.")
        start = end = None
    team = [dict(line) for line in (quote.get("team") or []) if isinstance(line, dict)]
    sow_document_id = _uuid(quote.get("sow_document_id"))

    code = str(payload.get("code") or "").strip()
    project = Project.objects.create(
        company=company,
        name=str(payload.get("name") or code or "Obra sem nome")[:200],
        po=str(payload.get("client_po_number") or "")[:100],
        client=client,
        site=site,
        responsible_cstr=responsible,
        status=Project.STATUS_PLANNING,
        planned_start=start,
        planned_end=end,
        description=f"Obra criada a partir do projeto {code} do Axis." if code else "Obra criada a partir do Axis.",
        axis_project_id=axis_project_id,
        axis_cost_center_id=_uuid(payload.get("cost_center_id")),
        planned_team=team,
        axis_pending_issues=issues,
        axis_sow_document_id=sow_document_id,
        sow_plan_status=Project.SOW_PLAN_PENDING if sow_document_id else Project.SOW_PLAN_NO_SOW,
        sow_plan_note="" if sow_document_id else "O Axis não informou a SOW da cotação aceita.",
    )

    if issues:
        names = "\n".join(f"• {text}" for text in issues)
        for admin in admins():
            notify_user(
                admin,
                title="Obra criada com pendências",
                message=f'A obra "{project.name}" ({project.code}) veio do Axis com pendências:\n{names}',
                url=f"/projetos/{project.pk}",
                project_id=project.pk,
                project_code=project.code,
            )

    if sow_document_id:
        transaction.on_commit(lambda: sow_plan.schedule(project.pk))
    else:
        field_events.emit_created(project, tasks_count=0)
    return project, True

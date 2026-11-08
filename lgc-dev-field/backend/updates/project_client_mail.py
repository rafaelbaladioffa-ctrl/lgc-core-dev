from django.db.models import Q
from django.utils import timezone

from core.email_texts import TEXTS, fmt_date, tr
from core.emailing import build_email, normalize_language, render_html
from core.models import Responsible
from projects.models import ProjectOccurrence, ProjectTask

NEWLINE = chr(10)
NAME_PARTICLES = {"da", "de", "do", "das", "dos", "e"}


def format_person_name(name):
    """'RAFAEL BALADI' / 'maria da silva' -> 'Rafael Baladi' / 'Maria da Silva'."""
    words = (name or "").split()
    return " ".join(
        w.lower() if i and w.lower() in NAME_PARTICLES else w[:1].upper() + w[1:].lower()
        for i, w in enumerate(words)
    )
WORKDAY_START = "07:30"
WORKDAY_END = "16:40"

STATUS_LABELS = {
    ProjectTask.STATUS_NOT_STARTED: "Não Iniciada",
    ProjectTask.STATUS_IN_PROGRESS: "Em Andamento",
    ProjectTask.STATUS_PAUSED: "Pausada",
    ProjectTask.STATUS_COMPLETED: "Concluída",
    ProjectTask.STATUS_CANCELED: "Cancelada",
}


def task_completion_date(task):
    """Data em que a tarefa foi concluída (None se não está concluída).
    `actual_end` só existe quando a tarefa passou pelo fluxo do técnico; nas
    concluídas por edição direta/ação em massa usa `updated_at` como aproximação."""
    if task.status != ProjectTask.STATUS_COMPLETED:
        return None
    reference = task.actual_end or task.updated_at
    return timezone.localtime(reference).date() if reference else None


def weekly_advance(tasks, current_percent, start):
    """Avanço (em pontos percentuais) desde o início do período: percentual atual
    menos o percentual no fim do dia anterior a `start` (tarefas já concluídas
    antes disso). Nunca negativo (tarefa reaberta/removida não conta como recuo)."""
    tasks = list(tasks)
    if not tasks:
        return 0
    done_before = sum(1 for t in tasks if (d := task_completion_date(t)) is not None and d < start)
    before = round(done_before / len(tasks) * 100)
    return max(0, current_percent - before)


def compute_progress_defaults(project, date):
    """Calcula os valores padrão (percentual, atividades, certificação,
    finalização e colaboradores) a partir das ProjectTask do projeto.
    Usado apenas para preencher automaticamente uma Atualização Diária de
    Projeto recém-criada — depois disso os campos ficam editáveis livremente.
    """
    all_tasks = list(project.project_tasks.select_related("task").prefetch_related("collaborators"))

    total = len(all_tasks)
    completed = [pt for pt in all_tasks if pt.status == ProjectTask.STATUS_COMPLETED]
    percent = round((len(completed) / total) * 100) if total else 0

    executed_today = [pt for pt in all_tasks if task_completion_date(pt) == date]
    activities_text = "\n".join(
        f"{pt.display_name} — {STATUS_LABELS.get(pt.status, pt.status)}" for pt in executed_today
    )

    certification_done = any(
        pt.status == ProjectTask.STATUS_COMPLETED and "certifica" in pt.display_name.lower()
        for pt in all_tasks
    )
    project_finished = total > 0 and percent == 100

    collaborator_ids = sorted(
        {collaborator.pk for pt in all_tasks for collaborator in pt.collaborators.all()}
    )

    return {
        "percent": percent,
        "activities_text": activities_text,
        "certification_done": certification_done,
        "project_finished": project_finished,
        "collaborator_ids": collaborator_ids,
    }


def build_project_update_body(project_update):
    project_update.refresh_from_tasks()
    project = project_update.project

    responsible_aws = (
        format_person_name(project.responsible_client.person.name) if project.responsible_client_id else "Não informado"
    )
    responsible_cstr = (
        format_person_name(project.responsible_cstr.person.name) if project.responsible_cstr_id else "Não informado"
    )
    collaborators_line = (
        ", ".join(
            format_person_name(name)
            for name in project_update.collaborators.order_by("person__name").values_list("person__name", flat=True)
        )
        or "Não informados"
    )

    lines = [
        "📋 Atualização Diária de Projeto",
        "",
        f"Nome do Projeto: {project.name}",
        f"PO: {project.po or 'Não informada'}",
        f"Responsável AWS: {responsible_aws}",
        f"Responsável CSTR: {responsible_cstr}",
        "",
        f"👷 Colaboradores: {collaborators_line}",
        "",
        f"📅 Data: {project_update.date:%d/%m/%Y}",
        f"Hora de início: {WORKDAY_START}",
        f"Hora de término: {WORKDAY_END}",
        "",
        f"📊 Percentual de Conclusão: {project_update.completion_percent}%",
        "",
        "🛠️ Atividades Executadas:",
        project_update.activities_text.strip() or "Nenhuma atividade concluída registrada nesta data.",
        "",
        f"✅ Certificação Finalizada: {'Sim' if project_update.certification_done else 'Não'}",
        f"🏁 Projeto finalizado: {'Sim' if project_update.project_finished else 'Não'}",
        "",
        "⚠️ Observações:",
        project_update.summary.strip() or "Nenhuma observação.",
    ]

    return "\n".join(lines)


def build_occurrence_notes(project_update, lang, start=None):
    """Observações do e-mail: anotação manual da atualização (se houver) mais as
    ocorrências do projeto em aberto/em andamento e as ocorridas ou resolvidas na
    data da atualização (ou, com `start`, em qualquer dia de start até a data —
    usado no Update Semanal). Ocorrências canceladas ficam de fora."""
    project = project_update.project
    date = project_update.date
    open_statuses = (ProjectOccurrence.STATUS_OPEN, ProjectOccurrence.STATUS_IN_PROGRESS)
    occurrences = (
        project.occurrences.exclude(status=ProjectOccurrence.STATUS_CANCELED)
        .filter(
            Q(status__in=open_statuses)
            | (Q(occurred_at__range=(start, date)) | Q(resolved_at__range=(start, date))
               if start
               else Q(occurred_at=date) | Q(resolved_at=date))
        )
        .order_by("occurred_at", "id")
    )
    statuses = TEXTS[lang]["occ_status"]
    lines = []
    manual = project_update.summary.strip()
    if manual:
        lines.append(manual)
    for occurrence in occurrences:
        line = f"• {fmt_date(lang, occurrence.occurred_at)} — {occurrence.title} ({statuses[occurrence.status]})"
        if occurrence.description.strip():
            line += f": {occurrence.description.strip()}"
        lines.append(line)
    return NEWLINE.join(lines)


def build_project_update_message(project_update, recipient_email, pdf_bytes, pdf_filename, lang="pt"):
    """Monta o e-mail corporativo (HTML + texto) da Atualização de Projeto."""
    lang = normalize_language(lang)
    project_update.refresh_from_tasks()
    project = project_update.project

    client_label = (
        (project.client.trade_name or project.client.legal_name) if project.client_id else tr(lang, "client_fallback")
    )
    responsible_client = (
        format_person_name(project.responsible_client.person.name)
        if project.responsible_client_id
        else tr(lang, "not_informed")
    )
    responsible_cstr = (
        format_person_name(project.responsible_cstr.person.name)
        if project.responsible_cstr_id
        else tr(lang, "not_informed")
    )
    yes_no = lambda value: tr(lang, "yes" if value else "no")  # noqa: E731
    summary = [
        (tr(lang, "project"), project.name),
        (tr(lang, "code"), project.code or "—"),
        (tr(lang, "site"), (project.site.name or project.site.code) if project.site_id else tr(lang, "not_informed")),
        (tr(lang, "po"), project.po or tr(lang, "po_missing")),
        (tr(lang, "responsible", client=client_label), responsible_client),
        (tr(lang, "responsible_company"), responsible_cstr),
        (tr(lang, "date"), fmt_date(lang, project_update.date)),
        (tr(lang, "certification"), yes_no(project_update.certification_done)),
        (tr(lang, "finished"), yes_no(project_update.project_finished)),
    ]
    observations = build_occurrence_notes(project_update, lang) or tr(lang, "no_observations")
    sections = [(tr(lang, "observations"), observations)]
    percent = f"{project_update.completion_percent}%"

    html = render_html(
        title=tr(lang, "project_title"),
        intro=tr(lang, "project_intro"),
        highlight=(tr(lang, "completion"), percent),
        summary=summary,
        sections=sections,
        lang=lang,
    )
    text_lines = [tr(lang, "project_title").upper(), ""]
    text_lines += [f"{label}: {value}" for label, value in summary]
    text_lines += ["", f"{tr(lang, 'completion')}: {percent}", ""]
    for heading, body in sections:
        text_lines += [heading.upper(), body, ""]
    text_lines.append(f"Consultimer — {tr(lang, 'attachment_note')}")
    site_label = (project.site.code or project.site.name) if project.site_id else tr(lang, "not_informed")
    subject = f"{tr(lang, 'project_subject')} | {site_label} | {project.name}"
    return build_email(
        subject=subject,
        to=[recipient_email],
        text=NEWLINE.join(text_lines),
        html=html,
        attachments=[(pdf_filename, pdf_bytes, "application/pdf")],
    )


def send_project_daily_update_email(project_update, extra_recipients=None, lang="pt"):
    """Envia a Atualização Diária de Projeto para todos os ClientResponsible
    ativos do cliente vinculado ao projeto, mais quaisquer destinatários
    extras informados (usuários do sistema escolhidos ou e-mails avulsos
    digitados na tela) via `extra_recipients` — lista de tuplas (nome, e-mail).

    Retorna uma tupla (enviados, sem_email) com os nomes em cada caso.
    """
    project = project_update.project
    responsibles = []
    if project.client_id:
        responsibles = list(
            Responsible.objects.filter(
                kind=Responsible.KIND_CLIENT, client_id=project.client_id, is_active=True
            ).select_related("person")
        )

    recipients = [(r.person.name, r.person.email) for r in responsibles]
    recipients += list(extra_recipients or [])

    # Deduplica por e-mail (case-insensitive), preservando a primeira ocorrência.
    seen_emails = set()
    deduped = []
    for name, email in recipients:
        key = (email or "").strip().lower()
        if key and key not in seen_emails:
            seen_emails.add(key)
            deduped.append((name, email))
        elif not key:
            deduped.append((name, email))

    # Import tardio para evitar import circular (project_pdf importa deste módulo).
    from .project_pdf import build_project_daily_update_pdf

    pdf_bytes = build_project_daily_update_pdf(project_update).read()
    pdf_filename = f"atualizacao-projeto-{project.code or project.pk}-{project_update.date:%Y-%m-%d}.pdf"

    sent, skipped = [], []
    for name, recipient_email in deduped:
        if not recipient_email:
            skipped.append(name)
            continue
        build_project_update_message(project_update, recipient_email, pdf_bytes, pdf_filename, lang).send(
            fail_silently=False
        )
        sent.append(name)

    if sent:
        type(project_update).objects.filter(pk=project_update.pk).update(sent_at=timezone.now())
        project_update.sent_at = timezone.now()

    return sent, skipped


def _weekly_project_data(project_update, lang, start):
    """Dados de um projeto no Update Semanal (mesma fonte do e-mail individual)."""
    project_update.refresh_from_tasks()
    project = project_update.project
    client_label = (
        (project.client.trade_name or project.client.legal_name) if project.client_id else tr(lang, "client_fallback")
    )
    not_informed = tr(lang, "not_informed")
    return {
        "name": project.name,
        "code": project.code or "—",
        "site": (project.site.name or project.site.code) if project.site_id else not_informed,
        "po": project.po or tr(lang, "po_missing"),
        "responsible_client_label": tr(lang, "responsible", client=client_label),
        "responsible_client": format_person_name(project.responsible_client.person.name)
        if project.responsible_client_id
        else not_informed,
        "responsible_cstr": format_person_name(project.responsible_cstr.person.name)
        if project.responsible_cstr_id
        else not_informed,
        "percent": project_update.completion_percent,
        "advance": weekly_advance(project.project_tasks.all(), project_update.completion_percent, start),
        "certification": project_update.certification_done,
        "finished": project_update.project_finished,
        "notes": build_occurrence_notes(project_update, lang, start=start),
    }


def build_weekly_update_message(project_updates, recipient_email, start, end, lang="pt"):
    """Um único e-mail com todos os projetos (Update Semanal), sem anexo."""
    from .weekly_layout import WEEKLY_WIDTH, render_weekly_body

    lang = normalize_language(lang)
    period = f"{fmt_date(lang, start)} – {fmt_date(lang, end)}"
    projects = [_weekly_project_data(pu, lang, start) for pu in project_updates]

    html = render_html(
        title=tr(lang, "weekly_title"),
        intro=tr(lang, "weekly_intro", start=fmt_date(lang, start), end=fmt_date(lang, end)),
        raw_html=render_weekly_body(lang, projects),
        lang=lang,
        width=WEEKLY_WIDTH,
        note=tr(lang, "attachment_note"),
    )
    yes_no = lambda value: tr(lang, "yes" if value else "no")  # noqa: E731
    text_lines = [tr(lang, "weekly_title").upper(), period, ""]
    for p in projects:
        text_lines += [
            f"{p['name'].upper()} — {p['percent']}% ({tr(lang, 'weekly_col_advance')}: +{p['advance']}%)",
            f"{tr(lang, 'code')}: {p['code']} | {tr(lang, 'site')}: {p['site']} | {tr(lang, 'po')}: {p['po']}",
            f"{p['responsible_client_label']}: {p['responsible_client']}",
            f"{tr(lang, 'certification')}: {yes_no(p['certification'])} | {tr(lang, 'finished')}: {yes_no(p['finished'])}",
        ]
        if p["notes"]:
            text_lines += [f"{tr(lang, 'observations')}:", p["notes"]]
        text_lines.append("")
    text_lines.append(f"Consultimer — {tr(lang, 'attachment_note')}")
    subject = f"{tr(lang, 'weekly_subject')} | {period} | {len(projects)} {tr(lang, 'weekly_projects')}"
    from .weekly_pdf import build_weekly_update_pdf

    pdf_bytes = build_weekly_update_pdf(projects, start, end, lang).read()
    pdf_filename = f"update-semanal-{start:%Y-%m-%d}_{end:%Y-%m-%d}.pdf"
    return build_email(
        subject=subject,
        to=[recipient_email],
        text=NEWLINE.join(text_lines),
        html=html,
        attachments=[(pdf_filename, pdf_bytes, "application/pdf")],
    )


def send_weekly_update_email(project_updates, start, end, extra_recipients=None, lang="pt"):
    """Envia o Update Semanal. Cada destinatário recebe um e-mail só: responsáveis
    do cliente recebem apenas os projetos do próprio cliente; destinatários extras
    (usuários/e-mails avulsos escolhidos na tela) recebem todos os projetos.
    Retorna (enviados, sem_email) com os nomes."""
    # destinatário (e-mail minúsculo) -> (nome, {pk das atualizações})
    plan = {}
    skipped = []

    def add(name, email, updates):
        key = (email or "").strip().lower()
        if not key:
            skipped.append(name)
            return
        entry = plan.setdefault(key, [name, email, {}])
        for pu in updates:
            entry[2][pu.pk] = pu

    client_ids = {pu.project.client_id for pu in project_updates if pu.project.client_id}
    for responsible in Responsible.objects.filter(
        kind=Responsible.KIND_CLIENT, client_id__in=client_ids, is_active=True
    ).select_related("person"):
        own = [pu for pu in project_updates if pu.project.client_id == responsible.client_id]
        add(responsible.person.name, responsible.person.email, own)
    for name, email in extra_recipients or []:
        add(name, email, project_updates)

    order = {pu.pk: i for i, pu in enumerate(project_updates)}
    sent = []
    for name, email, updates in plan.values():
        ordered = sorted(updates.values(), key=lambda pu: order[pu.pk])
        build_weekly_update_message(ordered, email, start, end, lang).send(fail_silently=False)
        sent.append(name)

    if sent:
        now = timezone.now()
        type(project_updates[0]).objects.filter(pk__in=[pu.pk for pu in project_updates]).update(sent_at=now)
    return sent, skipped

from core.email_texts import fmt_date, tr
from core.emailing import branded_subject, build_email, normalize_language, render_html

from .pdf import build_daily_updates_pdf


def build_daily_update_message(daily_update, recipient_email, pdf_bytes, pdf_filename, lang="pt"):
    """Monta o e-mail corporativo (HTML + texto) da Atualização Diária de alocação."""
    lang = normalize_language(lang)
    date_label = fmt_date(lang, daily_update.allocation_date)

    sections = []
    allocations = daily_update.allocations.select_related("project", "project__site").prefetch_related("collaborators")
    for allocation in allocations.order_by("project__name"):
        project = allocation.project
        heading = f"{project.name} ({project.code})" if project.code else project.name
        team = ", ".join(
            allocation.collaborators.order_by("person__name").values_list("person__name", flat=True)
        ) or tr(lang, "not_informed_pl")
        site = (project.site.name or project.site.code) if project.site_id else tr(lang, "not_informed")
        lines = [
            f"{tr(lang, 'po')}: {project.po or tr(lang, 'po_missing')}",
            f"{tr(lang, 'site')}: {site}",
            f"{tr(lang, 'team')}: {team}",
        ]
        sections.append((heading, chr(10).join(lines)))

    summary = [(tr(lang, "date"), date_label)]
    if daily_update.created_by_id:
        sender = daily_update.created_by.get_full_name() or daily_update.created_by.get_username()
        summary.append((tr(lang, "sent_by"), sender))

    html = render_html(
        title=tr(lang, "daily_title"),
        intro=tr(lang, "daily_intro", date=date_label),
        summary=summary,
        sections=sections,
        lang=lang,
    )
    text_lines = [tr(lang, "daily_title").upper(), ""]
    text_lines += [f"{label}: {value}" for label, value in summary]
    text_lines.append("")
    for heading, body in sections:
        text_lines += [heading, body, ""]
    text_lines.append(f"Consultimer — {tr(lang, 'attachment_note')}")

    return build_email(
        subject=branded_subject(tr(lang, "daily_subject"), date_label),
        to=[recipient_email],
        text=chr(10).join(text_lines),
        html=html,
        attachments=[(pdf_filename, pdf_bytes, "application/pdf")],
    )


def send_daily_update_emails(daily_update, lang="pt"):
    """Envia a Atualização Diária para cada colaborador alocado (e-mail
    individual, mesmo conteúdo e PDF anexado para todos), no idioma `lang`.

    Retorna uma tupla (enviados, sem_email) com a lista de nomes em cada caso.
    """
    daily_update.refresh_description()

    collaborators = {
        collaborator
        for allocation in daily_update.allocations.all()
        for collaborator in allocation.collaborators.all()
    }

    pdf_bytes = build_daily_updates_pdf([daily_update], daily_update.allocation_date).read()
    pdf_filename = f"atualizacao-diaria-{daily_update.allocation_date:%Y-%m-%d}.pdf"

    sent, skipped = [], []
    for collaborator in sorted(collaborators, key=lambda c: c.person.name):
        if not collaborator.person.email:
            skipped.append(collaborator.person.name)
            continue
        build_daily_update_message(daily_update, collaborator.person.email, pdf_bytes, pdf_filename, lang).send(
            fail_silently=False
        )
        sent.append(collaborator.person.name)

    return sent, skipped

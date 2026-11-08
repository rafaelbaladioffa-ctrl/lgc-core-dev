from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ORANGE = colors.HexColor("#F16023")
ORANGE_LIGHT = colors.HexColor("#FFF3EC")
NAVY = colors.HexColor("#172033")
SLATE = colors.HexColor("#526174")
LINE = colors.HexColor("#DDE3EA")
PAPER = colors.HexColor("#F7F9FB")


def _styles():
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "TitleCSTR", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=21,
            leading=25, textColor=NAVY, alignment=TA_LEFT, spaceAfter=3 * mm,
        ),
        "subtitle": ParagraphStyle(
            "SubtitleCSTR", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5,
            leading=13, textColor=SLATE,
        ),
        "metric_label": ParagraphStyle(
            "MetricLabel", parent=styles["Normal"], fontSize=8, leading=10, textColor=SLATE,
            alignment=TA_CENTER,
        ),
        "metric_value": ParagraphStyle(
            "MetricValue", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=15,
            leading=18, textColor=NAVY, alignment=TA_CENTER,
        ),
        "project": ParagraphStyle(
            "Project", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12,
            leading=15, textColor=NAVY,
        ),
        "label": ParagraphStyle(
            "Label", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=7.5,
            leading=10, textColor=SLATE,
        ),
        "value": ParagraphStyle(
            "Value", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5,
            leading=13, textColor=NAVY,
        ),
        "technician": ParagraphStyle(
            "Technician", parent=styles["Normal"], fontName="Helvetica", fontSize=9,
            leading=12, textColor=NAVY,
        ),
    }


def build_daily_updates_pdf(updates, allocation_date):
    updates = list(updates)
    allocations = []
    for update in updates:
        allocations.extend(update.allocations.all())

    grouped_projects = {}
    for allocation in allocations:
        group = grouped_projects.setdefault(
            allocation.project_id,
            {"project": allocation.project, "collaborators": {}},
        )
        for collaborator in allocation.collaborators.all():
            group["collaborators"][collaborator.pk] = collaborator

    project_entries = sorted(
        grouped_projects.values(),
        key=lambda entry: entry["project"].name.lower(),
    )
    site_ids = {
        entry["project"].site_id
        for entry in project_entries
        if entry["project"].site_id
    }
    collaborator_ids = {
        collaborator_id
        for entry in project_entries
        for collaborator_id in entry["collaborators"]
    }

    output = BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=24 * mm,
        bottomMargin=18 * mm,
        title=f"Atualização Diária - {allocation_date:%d/%m/%Y}",
        author="Consultimer",
    )
    styles = _styles()
    story = [
        Paragraph("ATUALIZAÇÃO DIÁRIA DE ALOCAÇÕES", styles["title"]),
        Paragraph(
            f"Planejamento de equipes para <b>{allocation_date:%d/%m/%Y}</b>",
            styles["subtitle"],
        ),
        Spacer(1, 7 * mm),
    ]

    metrics = (
        (str(len(project_entries)), "PROJETOS"),
        (str(len(site_ids)), "SITES"),
        (str(len(collaborator_ids)), "COLABORADORES"),
        (str(len(updates)), "ATUALIZAÇÕES"),
    )
    metric_table = Table(
        [[Paragraph(value, styles["metric_value"]) for value, _ in metrics],
         [Paragraph(label, styles["metric_label"]) for _, label in metrics]],
        colWidths=[43.5 * mm] * 4,
        rowHeights=[10 * mm, 7 * mm],
    )
    metric_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PAPER),
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    story.extend((metric_table, Spacer(1, 8 * mm)))

    for number, entry in enumerate(project_entries, 1):
        project = entry["project"]
        technicians = sorted(entry["collaborators"].values(), key=lambda item: item.person.name.lower())
        project_heading = Table(
            [[Paragraph(f"{number:02d}", styles["metric_value"]), Paragraph(project.name, styles["project"])]],
            colWidths=[14 * mm, 160 * mm],
        )
        project_heading.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), ORANGE),
            ("TEXTCOLOR", (0, 0), (0, 0), colors.white),
            ("BACKGROUND", (1, 0), (1, 0), ORANGE_LIGHT),
            ("BOX", (0, 0), (-1, -1), 0.7, ORANGE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (1, 0), (1, 0), 4 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ]))

        info = Table(
            [[
                Paragraph("CÓDIGO", styles["label"]),
                Paragraph("PO", styles["label"]),
                Paragraph("SITE", styles["label"]),
            ], [
                Paragraph(project.code or "Não informado", styles["value"]),
                Paragraph(project.po or "Não informada", styles["value"]),
                Paragraph(project.site.name if project.site else "Não informado", styles["value"]),
            ]],
            colWidths=[58 * mm, 58 * mm, 58 * mm],
        )
        info.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.7, LINE),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
            ("BACKGROUND", (0, 0), (-1, 0), PAPER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ]))

        technician_cells = [Paragraph("EQUIPE ALOCADA", styles["label"])]
        technician_cells.extend(
            Paragraph(f"- {collaborator.person.name}", styles["technician"])
            for collaborator in technicians
        )
        if not technicians:
            technician_cells.append(Paragraph("Nenhum colaborador informado", styles["technician"]))
        team = Table([[cell] for cell in technician_cells], colWidths=[174 * mm])
        team.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.7, LINE),
            ("BACKGROUND", (0, 0), (-1, 0), PAPER),
            ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 1.8 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.8 * mm),
        ]))
        story.extend((KeepTogether([project_heading, info, team]), Spacer(1, 5 * mm)))

    logo_path = Path(settings.BASE_DIR) / "core" / "static" / "core" / "img" / "consultimer-logo-light.png"

    def decorate_page(canvas, doc):
        canvas.saveState()
        width, height = A4
        canvas.setStrokeColor(ORANGE)
        canvas.setLineWidth(2)
        canvas.line(16 * mm, height - 16 * mm, width - 16 * mm, height - 16 * mm)
        if logo_path.exists():
            canvas.drawImage(str(logo_path), 16 * mm, height - 13.5 * mm, width=39 * mm, height=8 * mm,
                             preserveAspectRatio=True, anchor="sw", mask="auto")
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(SLATE)
        generated = timezone.localtime().strftime("Emitido em %d/%m/%Y às %H:%M")
        canvas.drawString(16 * mm, 9 * mm, generated)
        canvas.drawRightString(width - 16 * mm, 9 * mm, f"Página {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=decorate_page, onLaterPages=decorate_page)
    output.seek(0)
    return output

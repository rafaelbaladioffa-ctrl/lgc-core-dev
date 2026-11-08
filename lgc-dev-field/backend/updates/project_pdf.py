from io import BytesIO
from pathlib import Path

from django.conf import settings
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
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

from .project_client_mail import WORKDAY_END, WORKDAY_START

ORANGE = colors.HexColor("#F16023")
ORANGE_LIGHT = colors.HexColor("#FFF3EC")
NAVY = colors.HexColor("#172033")
SLATE = colors.HexColor("#526174")
LINE = colors.HexColor("#DDE3EA")
PAPER = colors.HexColor("#F7F9FB")
GREEN = colors.HexColor("#16A34A")
RED = colors.HexColor("#DC2626")

LETTERHEAD_PATH = Path(settings.BASE_DIR) / "core" / "static" / "core" / "img" / "letterhead-consultimer.png"

# Margens calculadas para não sobrepor o logo (topo) e a barra de rodapé (base)
# do papel timbrado da Consultimer.
TOP_MARGIN = 34 * mm
BOTTOM_MARGIN = 30 * mm
SIDE_MARGIN = 18 * mm


def _styles():
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "TitleCSTR", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=18,
            leading=22, textColor=NAVY, alignment=TA_LEFT, spaceAfter=2 * mm,
        ),
        "subtitle": ParagraphStyle(
            "SubtitleCSTR", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5,
            leading=13, textColor=SLATE,
        ),
        "section": ParagraphStyle(
            "Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10.5,
            leading=13, textColor=colors.white,
        ),
        "label": ParagraphStyle(
            "Label", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=7.5,
            leading=10, textColor=SLATE,
        ),
        "value": ParagraphStyle(
            "Value", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5,
            leading=13, textColor=NAVY,
        ),
        "metric_label": ParagraphStyle(
            "MetricLabel", parent=styles["Normal"], fontSize=8, leading=10, textColor=SLATE,
        ),
        "metric_value": ParagraphStyle(
            "MetricValue", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=16,
            leading=19, textColor=ORANGE,
        ),
        "activity": ParagraphStyle(
            "Activity", parent=styles["Normal"], fontName="Helvetica", fontSize=9, leading=13,
            textColor=NAVY,
        ),
        "note": ParagraphStyle(
            "Note", parent=styles["Normal"], fontName="Helvetica", fontSize=9, leading=13,
            textColor=SLATE,
        ),
    }


def _section_header(title, styles, width):
    table = Table([[Paragraph(title, styles["section"])]], colWidths=[width])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ORANGE),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    return table


def build_project_daily_update_pdf(project_update):
    project = project_update.project
    styles = _styles()
    content_width = A4[0] - 2 * SIDE_MARGIN

    responsible_aws = project.responsible_client.person.name if project.responsible_client_id else "Não informado"
    responsible_cstr = project.responsible_cstr.person.name if project.responsible_cstr_id else "Não informado"
    collaborators_line = (
        ", ".join(project_update.collaborators.order_by("person__name").values_list("person__name", flat=True))
        or "Não informados"
    )

    output = BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=SIDE_MARGIN,
        leftMargin=SIDE_MARGIN,
        topMargin=TOP_MARGIN,
        bottomMargin=BOTTOM_MARGIN,
        title=f"Atualização Diária de Projeto - {project.name}",
        author="Consultimer",
    )

    story = [
        Paragraph("ATUALIZAÇÃO DIÁRIA DE PROJETO", styles["title"]),
        Paragraph(
            f"{project.name} — {project_update.date:%d/%m/%Y}",
            styles["subtitle"],
        ),
        Spacer(1, 5 * mm),
    ]

    info = Table(
        [
            [
                Paragraph("PROJETO", styles["label"]),
                Paragraph("PO", styles["label"]),
            ],
            [
                Paragraph(project.name, styles["value"]),
                Paragraph(project.po or "Não informada", styles["value"]),
            ],
            [
                Paragraph("RESPONSÁVEL AWS", styles["label"]),
                Paragraph("RESPONSÁVEL CSTR", styles["label"]),
            ],
            [
                Paragraph(responsible_aws, styles["value"]),
                Paragraph(responsible_cstr, styles["value"]),
            ],
        ],
        colWidths=[content_width / 2] * 2,
    )
    info.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
        ("BACKGROUND", (0, 0), (-1, 0), PAPER),
        ("BACKGROUND", (0, 2), (-1, 2), PAPER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    story.extend((info, Spacer(1, 4 * mm)))

    collab_table = Table(
        [[Paragraph("COLABORADORES", styles["label"])], [Paragraph(collaborators_line, styles["value"])]],
        colWidths=[content_width],
    )
    collab_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("BACKGROUND", (0, 0), (-1, 0), PAPER),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    story.extend((collab_table, Spacer(1, 5 * mm)))

    metrics = (
        (f"{project_update.completion_percent}%", "CONCLUSÃO"),
        (WORKDAY_START, "INÍCIO"),
        (WORKDAY_END, "TÉRMINO"),
        ("Sim" if project_update.certification_done else "Não", "CERTIFICAÇÃO"),
    )
    metric_table = Table(
        [[Paragraph(value, styles["metric_value"]) for value, _ in metrics],
         [Paragraph(label, styles["metric_label"]) for _, label in metrics]],
        colWidths=[content_width / 4] * 4,
        rowHeights=[9 * mm, 6 * mm],
    )
    metric_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PAPER),
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5 * mm),
    ]))
    story.extend((metric_table, Spacer(1, 6 * mm)))

    story.append(_section_header("ATIVIDADES EXECUTADAS", styles, content_width))
    activity_lines = [line for line in project_update.activities_text.splitlines() if line.strip()]
    if activity_lines:
        activity_rows = [[Paragraph(f"• {line}", styles["activity"])] for line in activity_lines]
    else:
        activity_rows = [[Paragraph("Nenhuma atividade concluída registrada nesta data.", styles["activity"])]]
    activities = Table(activity_rows, colWidths=[content_width])
    activities.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.8 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.8 * mm),
    ]))
    story.extend((activities, Spacer(1, 5 * mm)))

    status_table = Table(
        [[
            Paragraph("PROJETO FINALIZADO", styles["label"]),
            Paragraph("Sim" if project_update.project_finished else "Não", styles["value"]),
        ]],
        colWidths=[content_width * 0.5, content_width * 0.5],
    )
    status_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("BACKGROUND", (0, 0), (0, 0), PAPER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    story.extend((status_table, Spacer(1, 5 * mm)))

    story.append(_section_header("OBSERVAÇÕES", styles, content_width))
    notes = Table(
        [[Paragraph(project_update.summary.strip() or "Nenhuma observação.", styles["note"])]],
        colWidths=[content_width],
    )
    notes.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 * mm),
    ]))
    story.append(KeepTogether([notes]))

    def draw_letterhead(canvas, doc):
        canvas.saveState()
        if LETTERHEAD_PATH.exists():
            canvas.drawImage(
                str(LETTERHEAD_PATH), 0, 0, width=A4[0], height=A4[1],
                preserveAspectRatio=False, mask="auto",
            )
        canvas.restoreState()

    document.build(story, onFirstPage=draw_letterhead, onLaterPages=draw_letterhead)
    output.seek(0)
    return output

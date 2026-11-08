"""PDF do Update Semanal: mesma tela do e-mail (indicadores + tabela com uma linha
por projeto, barra de avanço e observações), em A4 paisagem. Usa os mesmos dados
montados para o e-mail (`project_client_mail._weekly_project_data`)."""

from io import BytesIO
from pathlib import Path

from django.conf import settings
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from core.email_texts import fmt_date, tr
from core.emailing import FOOTER_LINES

ORANGE = colors.HexColor("#F58530")
DARK = colors.HexColor("#262528")
TEXT = colors.HexColor("#202124")
MUTED = colors.HexColor("#6B6B70")
LINE = colors.HexColor("#E4E4E7")
PAPER = colors.HexColor("#F4F4F5")
TRACK = colors.HexColor("#E4E4E7")
OK_BG, OK_FG = colors.HexColor("#DCFCE7"), colors.HexColor("#166534")
NO_BG, NO_FG = colors.HexColor("#F4F4F5"), colors.HexColor("#52525B")

LOGO_PATH = Path(settings.BASE_DIR) / "core" / "static" / "core" / "img" / "consultimer-logo-branco.png"

PAGE = landscape(A4)
MARGIN = 12 * mm
HEADER_H = 20 * mm
FOOTER_H = 12 * mm
CONTENT_W = PAGE[0] - 2 * MARGIN
# Projeto, Site, PO, Resp. cliente, Progresso, Avanço, Certificação, Finalizado
COL_WIDTHS = [78 * mm, 22 * mm, 32 * mm, 34 * mm, 22 * mm, 42 * mm, 21 * mm, 21 * mm]


class AdvanceBar(Flowable):
    """Barra de avanço (laranja) com o valor ao lado."""

    def __init__(self, fraction, label, width):
        super().__init__()
        self.fraction, self.label, self.width, self.height = max(0.0, min(1.0, fraction)), label, width, 5 * mm

    def draw(self):
        bar_w, bar_h, y = self.width - 13 * mm, 2.2 * mm, self.height / 2 - 1.1 * mm
        c = self.canv
        c.setFillColor(TRACK)
        c.roundRect(0, y, bar_w, bar_h, bar_h / 2, stroke=0, fill=1)
        if self.fraction > 0:
            c.setFillColor(ORANGE)
            c.roundRect(0, y, max(bar_h, bar_w * self.fraction), bar_h, bar_h / 2, stroke=0, fill=1)
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawRightString(self.width, y - 0.3 * mm, self.label)


class Pill(Flowable):
    """Etiqueta arredondada Sim/Não centralizada na célula."""

    def __init__(self, text, ok, width):
        super().__init__()
        self.text, self.ok, self.width, self.height = text, ok, width, 5 * mm

    def draw(self):
        c = self.canv
        bg, fg = (OK_BG, OK_FG) if self.ok else (NO_BG, NO_FG)
        pill_w = 12 * mm
        x = (self.width - pill_w) / 2
        c.setFillColor(bg)
        c.roundRect(x, 0.6 * mm, pill_w, 4 * mm, 2 * mm, stroke=0, fill=1)
        c.setFillColor(fg)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawCentredString(self.width / 2, 1.9 * mm, self.text)


def _styles():
    base = getSampleStyleSheet()["Normal"]

    def style(name, **kw):
        return ParagraphStyle(name, parent=base, textColor=kw.pop("textColor", TEXT), **kw)

    return {
        "title": style("WTitle", fontName="Helvetica-Bold", fontSize=18, leading=22),
        "intro": style("WIntro", fontSize=9.5, leading=13, textColor=MUTED),
        "head": style("WHead", fontName="Helvetica-Bold", fontSize=7, leading=9, textColor=MUTED),
        "cell": style("WCell", fontSize=8.5, leading=11),
        "cell_bold": style("WCellBold", fontName="Helvetica-Bold", fontSize=8.5, leading=11),
        "stat": style("WStat", fontName="Helvetica-Bold", fontSize=18, leading=21, alignment=1),
        "stat_label": style("WStatLabel", fontSize=7, leading=9, textColor=MUTED, alignment=1),
        "note": style("WNote", fontSize=8, leading=11, textColor=MUTED),
    }


def build_weekly_update_pdf(projects, start, end, lang="pt"):
    """`projects`: lista de dicts no formato de `_weekly_project_data`. Devolve BytesIO."""
    st = _styles()
    total = len(projects)
    average = round(sum(p["percent"] for p in projects) / total) if total else 0
    average_advance = round(sum(p["advance"] for p in projects) / total) if total else 0
    finished = sum(1 for p in projects if p["finished"])
    advance_scale = max(10, *(p["advance"] for p in projects)) if projects else 10

    story = [
        Paragraph(tr(lang, "weekly_title"), st["title"]),
        Spacer(1, 1.5 * mm),
        Paragraph(tr(lang, "weekly_intro", start=fmt_date(lang, start), end=fmt_date(lang, end)), st["intro"]),
        Spacer(1, 5 * mm),
    ]

    stats = [
        (str(total), tr(lang, "weekly_stat_projects")),
        (f"{average}%", tr(lang, "weekly_stat_avg")),
        (f"+{average_advance}%", tr(lang, "weekly_stat_advance")),
        (str(finished), tr(lang, "weekly_stat_done")),
    ]
    tile_w = sum(COL_WIDTHS) / 4
    stat_table = Table(
        [[
            [Paragraph(value, st["stat"]), Paragraph(label.upper(), st["stat_label"])]
            for value, label in stats
        ]],
        colWidths=[tile_w] * 4,
        hAlign="LEFT",
    )
    stat_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PAPER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ("LINEAFTER", (0, 0), (-2, -1), 3 * mm, colors.white),
    ]))
    story += [stat_table, Spacer(1, 6 * mm)]

    header = [
        Paragraph(tr(lang, key).upper(), st["head"])
        for key in ("weekly_col_project", "site", "po", "weekly_col_resp_client", "weekly_col_progress", "weekly_col_advance")
    ] + [
        Paragraph(f'<para alignment="center">{tr(lang, key).upper()}</para>', st["head"])
        for key in ("weekly_col_cert", "weekly_col_done")
    ]
    rows = [header]
    commands = [
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
    ]
    advance_w, pill_w = COL_WIDTHS[5] - 2 * mm, COL_WIDTHS[6] - 2 * mm
    for p in projects:
        row = len(rows)
        rows.append([
            Paragraph(f'<b>{_esc(p["name"])}</b><br/><font size="7" color="#6B6B70">{_esc(p["code"])}</font>', st["cell"]),
            Paragraph(_esc(p["site"]), st["cell"]),
            Paragraph(_esc(p["po"]), st["cell"]),
            Paragraph(_esc(p["responsible_client"]), st["cell"]),
            Paragraph(f'{p["percent"]}%', st["cell_bold"]),
            AdvanceBar(p["advance"] / advance_scale, f'+{p["advance"]}%', advance_w),
            Pill(tr(lang, "yes" if p["certification"] else "no"), p["certification"], pill_w),
            Pill(tr(lang, "yes" if p["finished"] else "no"), p["finished"], pill_w),
        ])
        commands.append(("LINEBELOW", (0, row), (-1, row), 0.5, LINE))
        if p["notes"]:
            note_row = len(rows)
            notes = _esc(p["notes"]).replace("\n", "<br/>")
            rows.append([Paragraph(f'<b>{tr(lang, "observations")}:</b> {notes}', st["note"])] + [""] * 7)
            commands += [
                ("SPAN", (0, note_row), (-1, note_row)),
                ("BACKGROUND", (0, note_row), (-1, note_row), PAPER),
                ("LINEBEFORE", (0, note_row), (0, note_row), 2, ORANGE),
                ("LEFTPADDING", (0, note_row), (0, note_row), 3 * mm),
                ("TOPPADDING", (0, note_row), (-1, note_row), 1.5 * mm),
                ("BOTTOMPADDING", (0, note_row), (-1, note_row), 1.5 * mm),
                ("LINEBELOW", (0, note_row), (-1, note_row), 0.5, LINE),
                # a linha do projeto "cola" na de observações (sem divisor entre as duas)
                ("LINEBELOW", (0, row), (-1, row), 0, colors.white),
            ]

    table = Table(rows, colWidths=COL_WIDTHS, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle(commands))
    story.append(table)

    footer_lines = FOOTER_LINES[lang]
    period_label = f"{tr(lang, 'weekly_title')} {fmt_date(lang, start)} – {fmt_date(lang, end)}"

    def decorate(canvas, doc):
        canvas.saveState()
        width, height = PAGE
        canvas.setFillColor(DARK)
        canvas.rect(0, height - HEADER_H, width, HEADER_H, stroke=0, fill=1)
        canvas.setFillColor(ORANGE)
        canvas.rect(0, height - HEADER_H - 1.2 * mm, width, 1.2 * mm, stroke=0, fill=1)
        if LOGO_PATH.exists():
            logo_h = 11 * mm
            canvas.drawImage(
                str(LOGO_PATH), MARGIN, height - HEADER_H + (HEADER_H - logo_h) / 2,
                width=logo_h * 400 / 94, height=logo_h, mask="auto",
            )
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(MARGIN, 7 * mm, f"{footer_lines[0]} — {footer_lines[1]}")
        canvas.drawRightString(width - MARGIN, 7 * mm, f"{period_label}  |  {doc.page}")
        canvas.restoreState()

    output = BytesIO()
    SimpleDocTemplate(
        output,
        pagesize=PAGE,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=HEADER_H + 1.2 * mm + 8 * mm,
        bottomMargin=FOOTER_H + 4 * mm,
        title=f"{tr(lang, 'weekly_title')} {fmt_date(lang, start)} - {fmt_date(lang, end)}",
        author="Consultimer",
    ).build(story, onFirstPage=decorate, onLaterPages=decorate)
    output.seek(0)
    return output


def _esc(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

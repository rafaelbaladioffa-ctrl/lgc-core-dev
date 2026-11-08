"""Layout do e-mail do Update Semanal (vários projetos num só e-mail).

Pensado para leitura em desktop (largura de 1100px): indicadores da semana e uma
única tabela com uma linha por projeto (progresso, site, PO, responsáveis,
certificação e finalização); as observações aparecem numa linha própria logo
abaixo do projeto, só quando existem. Só tabelas e estilos inline (compatível
com Outlook); as classes `c-*` ativam as cores do tema escuro (ver DARK_CSS em
core/emailing.py).
"""

from html import escape

from core.email_texts import tr
from core.emailing import COLOR_ACCENT, COLOR_BORDER, COLOR_MUTED, COLOR_TEXT

WEEKLY_WIDTH = 1100
BAR_BG = "#e4e4e7"
ADVANCE_COLOR = COLOR_ACCENT
HEAD_STYLE = (
    f"padding:8px 8px 8px 0;border-bottom:2px solid {COLOR_BORDER};font-size:11px;font-weight:600;"
    f"text-transform:uppercase;letter-spacing:.05em;color:{COLOR_MUTED};text-align:left;"
)


def _bar(percent, height=8, color=COLOR_ACCENT):
    """Barra de progresso em tabela (sem CSS moderno, para o Outlook renderizar)."""
    percent = max(0, min(100, int(percent)))
    fill = (
        f'<td width="{percent}%" bgcolor="{color}" style="background:{color};height:{height}px;line-height:{height}px;font-size:0;">&nbsp;</td>'
        if percent
        else ""
    )
    rest = (
        f'<td width="{100 - percent}%" style="height:{height}px;line-height:{height}px;font-size:0;">&nbsp;</td>'
        if percent < 100
        else ""
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="c-track" '
        f'style="background:{BAR_BG};border-radius:{height // 2}px;overflow:hidden;"><tr>{fill}{rest}</tr></table>'
    )


def _pill(lang, value):
    cls, bg, fg = ("c-ok", "#dcfce7", "#166534") if value else ("c-no", "#f4f4f5", "#52525b")
    text = tr(lang, "yes" if value else "no")
    return (
        f'<span class="{cls}" style="display:inline-block;background:{bg};color:{fg};border-radius:10px;'
        f'padding:2px 10px;font-size:12px;font-weight:600;white-space:nowrap;">{escape(text)}</span>'
    )


def _stat(value, label):
    return (
        f'<td class="c-hl" width="25%" align="center" style="background:#f4f4f5;padding:14px 8px;border-radius:6px;">'
        f'<div class="c-txt" style="font-size:26px;font-weight:700;line-height:1.1;color:{COLOR_TEXT};">{escape(str(value))}</div>'
        f'<div class="c-mut" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:{COLOR_MUTED};margin-top:4px;">{escape(label)}</div>'
        f"</td>"
    )


def _head(label, width, align="left"):
    return (
        f'<th class="c-mut c-brd" width="{width}" align="{align}" style="{HEAD_STYLE}text-align:{align};">{escape(label)}</th>'
    )


def _cell(content, width=None, align="left", muted=False, bold=False, nowrap=False):
    cls = "c-mut c-brd" if muted else "c-txt c-brd"
    color = COLOR_MUTED if muted else COLOR_TEXT
    weight = ("font-weight:700;" if bold else "") + ("white-space:nowrap;" if nowrap else "")
    w = f' width="{width}"' if width else ""
    return (
        f'<td class="{cls}"{w} align="{align}" valign="middle" style="padding:10px 8px 10px 0;border-bottom:1px solid {COLOR_BORDER};'
        f'font-size:13px;color:{color};{weight}text-align:{align};">{content}</td>'
    )


def render_weekly_body(lang, projects):
    """`projects`: lista de dicts (name, code, site, po, responsible_client,
    percent, advance, certification, finished, notes)."""
    total = len(projects)
    average = round(sum(p["percent"] for p in projects) / total) if total else 0
    finished = sum(1 for p in projects if p["finished"])
    average_advance = round(sum(p["advance"] for p in projects) / total) if total else 0
    # A barra de avanço é proporcional ao maior avanço da semana (piso de 10%),
    # para que diferenças pequenas continuem visíveis; o número exato fica ao lado.
    advance_scale = max(10, *(p["advance"] for p in projects)) if projects else 10
    gap = '<td width="10" style="font-size:0;">&nbsp;</td>'

    parts = [
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>'
        + _stat(total, tr(lang, "weekly_stat_projects"))
        + gap
        + _stat(f"{average}%", tr(lang, "weekly_stat_avg"))
        + gap
        + _stat(f"+{average_advance}%", tr(lang, "weekly_stat_advance"))
        + gap
        + _stat(finished, tr(lang, "weekly_stat_done"))
        + "</tr></table>"
    ]

    header = (
        "<tr>"
        + _head(tr(lang, "weekly_col_project"), "27%")
        + _head(tr(lang, "site"), "9%")
        + _head(tr(lang, "po"), "12%")
        + _head(tr(lang, "weekly_col_resp_client"), "12%")
        + _head(tr(lang, "weekly_col_progress"), "9%")
        + _head(tr(lang, "weekly_col_advance"), "17%")
        + _head(tr(lang, "weekly_col_cert"), "7%", "center")
        + _head(tr(lang, "weekly_col_done"), "7%", "center")
        + "</tr>"
    )

    rows = []
    for p in projects:
        advance = (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="padding-right:8px;">{_bar(p["advance"] * 100 / advance_scale, 8, ADVANCE_COLOR)}</td>'
            f'<td width="40" align="right" class="c-txt" style="font-size:13px;font-weight:700;color:{COLOR_TEXT};">+{p["advance"]}%</td>'
            f"</tr></table>"
        )
        name = (
            f'<span style="font-weight:700;">{escape(p["name"])}</span>'
            f'<div class="c-mut" style="font-size:11px;font-weight:400;color:{COLOR_MUTED};">{escape(p["code"])}</div>'
        )
        rows.append(
            "<tr>"
            + _cell(name)
            + _cell(escape(p["site"]), nowrap=True)
            + _cell(escape(p["po"]), nowrap=True)
            + _cell(escape(p["responsible_client"]), nowrap=True)
            + _cell(f'{p["percent"]}%', bold=True)
            + _cell(advance)
            + _cell(_pill(lang, p["certification"]), align="center")
            + _cell(_pill(lang, p["finished"]), align="center")
            + "</tr>"
        )
        if p["notes"]:
            rows.append(
                f'<tr><td colspan="8" class="c-brd" style="padding:0 0 10px;border-bottom:1px solid {COLOR_BORDER};">'
                f'<div class="c-hl c-mut" style="background:#f4f4f5;border-left:3px solid {COLOR_ACCENT};padding:8px 12px;font-size:12px;line-height:1.5;color:{COLOR_MUTED};">'
                f'<b>{escape(tr(lang, "observations"))}:</b> {escape(p["notes"]).replace(chr(10), "<br>")}</div></td></tr>'
            )

    parts.append(
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">{header}{"".join(rows)}</table>'
    )
    return "".join(parts)

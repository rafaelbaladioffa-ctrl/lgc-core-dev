"""View de "impressão" da Central de Operações (Operação do Dia) usada pelo
bot do WhatsApp: renderiza os mesmos dados de OperationsBoard/timeline como
uma página HTML autocontida (sem precisar do React/JS do frontend), pra ser
fotografada por um navegador headless e mandada como imagem no WhatsApp.

A lógica de segmentos/lanes da timeline é um port direto de
frontend/src/utils/timeline.ts — mantenha os dois em sincronia se aquele
arquivo mudar.
"""

from datetime import timedelta

from django.shortcuts import render
from django.utils import timezone
from rest_framework.views import APIView

from api.operations import build_board_data, build_timeline_data

from .permissions import BotSharedSecretPermission

WINDOW_START_HOUR = 7
WINDOW_END_HOUR = 19
WINDOW_MINUTES = (WINDOW_END_HOUR - WINDOW_START_HOUR) * 60

PRESENCE_COLOR = {
    "not_started": "#6c7d97",
    "available": "#34d399",
    "in_progress": "#fbbf24",
    "lunch": "#a78bfa",
    "personal": "#5b9bff",
    "meal": "#2dd4bf",
    "meeting": "#f472b6",
    "traveling": "#22d3ee",
    "support": "#a3e635",
    "site_blocked": "#f87171",
    "awaiting_release": "#f16023",
    "off_duty": "#6c7d97",
    "on_leave": "#9333ea",
}
BUSY_COLOR = {"in_progress": "#fbbf24", "paused": "#f16023"}
DONE_COLOR = "#5b9bff"
PRESENCE_LABEL = {
    "not_started": "Indisponível",
    "available": "Disponível",
    "in_progress": "Em Execução",
    "lunch": "Horário de Almoço",
    "personal": "Particular",
    "meal": "Café",
    "meeting": "Reunião",
    "traveling": "Em Deslocamento",
    "support": "Apoio a outro técnico",
    "site_blocked": "Sem Acesso ao Site",
    "awaiting_release": "Aguardando Liberações",
    "off_duty": "Fim de Expediente",
}
AWAY_STATUSES = {"lunch", "personal", "meal", "meeting", "traveling", "support", "site_blocked", "awaiting_release"}


def _fmt(value):
    """Formata um float como string de ponto fixo, sempre com "." decimal —
    o Django Template Language localiza {{ float }} pra vírgula quando o
    locale ativo é pt_BR (USE_I18N=True), o que quebra silenciosamente
    qualquer `left:{{ x }}%` no CSS inline (left:0,0% é inválido, o
    navegador simplesmente ignora a propriedade)."""
    return f"{value:.2f}"


def _initials(name):
    parts = (name or "").strip().split()
    letters = "".join(p[0] for p in parts[:2])
    return letters.upper() or "?"


def _pct(dt, base):
    day_start = base.replace(hour=WINDOW_START_HOUR, minute=0, second=0, microsecond=0)
    minutes = (dt - day_start).total_seconds() / 60
    return max(0.0, min(100.0, (minutes / WINDOW_MINUTES) * 100))


def _subtract_intervals(base, cuts):
    pieces = [base]
    for cut in cuts:
        next_pieces = []
        for p in pieces:
            if cut[1] <= p[0] or cut[0] >= p[1]:
                next_pieces.append(p)
                continue
            if cut[0] > p[0]:
                next_pieces.append((p[0], cut[0]))
            if cut[1] < p[1]:
                next_pieces.append((cut[1], p[1]))
        pieces = next_pieces
    return [p for p in pieces if (p[1] - p[0]).total_seconds() >= 60]


def _build_tech_segments(blocks, status_events, now):
    """Port de buildTechSegments (timeline.ts) — sempre "ao vivo" (isLive=True),
    já que a imagem é gerada na hora."""
    segments = []
    task_intervals = []

    sorted_events = sorted(status_events, key=lambda e: e["changed_at"])
    last_status = sorted_events[-1]["status"] if sorted_events else None

    # Trechos em que o técnico estava fora da execução (almoço, café, deslocamento,
    # bloqueio...): escolher esses status pausa as tarefas, então a barra da tarefa
    # concluída é recortada ali e o trecho aparece como a barra do próprio status.
    # Esses trechos NÃO entram em task_intervals — senão o laço de presença os
    # descartaria e sobraria um buraco na linha do técnico.
    away_intervals = []
    for i, ev in enumerate(sorted_events):
        if ev["status"] not in AWAY_STATUSES:
            continue
        away_end = sorted_events[i + 1]["changed_at"] if i + 1 < len(sorted_events) else now
        if away_end > ev["changed_at"]:
            away_intervals.append((ev["changed_at"], away_end))

    for b in blocks:
        # Rastreamento próprio do técnico: uma barra por trecho trabalhado; a pausa
        # vira um vão ocupado pela barra do status, e ao voltar a tarefa recomeça.
        if b.get("working_intervals") is not None:
            for iv in b["working_intervals"]:
                iv_start = iv["start"]
                iv_end = iv["end"] or now
                if iv_end <= iv_start:
                    continue
                for piece_start, piece_end in _subtract_intervals((iv_start, iv_end), away_intervals):
                    is_open_tail = iv["end"] is None and piece_end == iv_end
                    segments.append(
                        {
                            "color": DONE_COLOR if b["status"] == "completed" else BUSY_COLOR["in_progress"],
                            "label": b["name"],
                            "start": piece_start,
                            "end": None if is_open_tail else piece_end,
                        }
                    )
                    task_intervals.append((piece_start, piece_end))
            continue
        if b["status"] == "completed" and b["actual_start"] and b["actual_end"]:
            start, end = b["actual_start"], b["actual_end"]
            for piece_start, piece_end in _subtract_intervals((start, end), away_intervals):
                segments.append({"color": DONE_COLOR, "label": b["name"], "start": piece_start, "end": piece_end})
                task_intervals.append((piece_start, piece_end))
        elif b["status"] in ("in_progress", "paused") and b["actual_start"]:
            start = b["actual_start"]
            task_intervals.append((start, now))
            if b["status"] == "paused":
                if last_status in AWAY_STATUSES:
                    segments.append(
                        {
                            "color": PRESENCE_COLOR[last_status],
                            "label": f"{PRESENCE_LABEL[last_status]} · {b['name']}",
                            "start": start,
                            "end": None,
                        }
                    )
                else:
                    segments.append({"color": BUSY_COLOR["paused"], "label": f"Em pausa · {b['name']}", "start": start, "end": None})
            else:
                segments.append({"color": BUSY_COLOR["in_progress"], "label": b["name"], "start": start, "end": None})

    for i, ev in enumerate(sorted_events):
        if ev["status"] == "not_started":
            continue
        start = ev["changed_at"]
        end = sorted_events[i + 1]["changed_at"] if i + 1 < len(sorted_events) else now
        if end <= start:
            continue
        is_last_event = i == len(sorted_events) - 1
        for piece_start, piece_end in _subtract_intervals((start, end), task_intervals):
            is_open_tail = is_last_event and piece_end == end
            segments.append(
                {
                    "color": PRESENCE_COLOR.get(ev["status"], "#6c7d97"),
                    "label": PRESENCE_LABEL.get(ev["status"], ev["status_display"]),
                    "start": piece_start,
                    "end": None if is_open_tail else piece_end,
                }
            )

    segments.sort(key=lambda s: s["start"])
    return segments


def _assign_lanes(segments, now):
    open_end = now + timedelta(days=3650)
    sorted_segs = sorted(segments, key=lambda s: s["start"])
    lane_ends = []
    raw = []
    for seg in sorted_segs:
        seg_end = seg["end"] or open_end
        lane = next((i for i, end in enumerate(lane_ends) if end <= seg["start"]), None)
        if lane is None:
            lane = len(lane_ends)
            lane_ends.append(None)
        lane_ends[lane] = seg_end
        raw.append({"segment": seg, "lane": lane})
    lane_count = max(1, len(lane_ends))
    return [{"segment": r["segment"], "lane": r["lane"]} for r in raw], lane_count


def _group_by_pair(technicians):
    by_id = {t["id"]: t for t in technicians}
    seen = set()
    ordered = []
    for t in technicians:
        if t["id"] in seen:
            continue
        seen.add(t["id"])
        partner = None
        if t.get("pair_partner"):
            partner = by_id.get(t["pair_partner"]["id"])
            if partner:
                seen.add(partner["id"])
        ordered.append(t)
        if partner:
            ordered.append(partner)
    return ordered


def _track_height(count):
    return 52 if count <= 1 else 10 + count * 30


def _bar_top(index, count):
    return 8 if count <= 1 else 6 + index * 30


def _bar_height(count):
    return 36 if count <= 1 else 26


class OperationsPrintView(APIView):
    """GET /api/bot/operations-print/?site=<id|all>

    Página HTML autocontida (sem CSS/JS externo) com o mesmo conteúdo da
    Central de Operações — usada pelo bot do WhatsApp pra tirar um
    screenshot via navegador headless e mandar como imagem."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        site_param = request.query_params.get("site", "all")
        site_id = None if site_param == "all" else site_param

        board = build_board_data(site_id)
        now = timezone.localtime()
        today = timezone.localdate()
        timeline = build_timeline_data(site_id, today)
        timeline_by_id = {t["id"]: t for t in timeline["technicians"]}

        # Técnico com ausência planejada (férias, atestado, folga) não entra
        # no print — é ruído pra quem recebe a imagem no WhatsApp; quem
        # precisa gerenciar a ausência em si faz isso pela Central de
        # Operações, não por aqui.
        ordered_technicians = [t for t in _group_by_pair(board["technicians"]) if not t["on_leave"]]

        tech_rows = []
        for tech in ordered_technicians:
            tl = timeline_by_id.get(tech["id"], {"blocks": [], "status_events": []})
            segments = _build_tech_segments(tl["blocks"], tl["status_events"], now)
            laned, lane_count = _assign_lanes(segments, now)
            height = _track_height(lane_count)
            bars = []
            for item in laned:
                seg = item["segment"]
                left = _pct(seg["start"], now)
                right = _pct(seg["end"], now) if seg["end"] else _pct(now, now)
                width = max(0.6, right - left)
                bars.append(
                    {
                        "left": _fmt(left),
                        "width": _fmt(width),
                        "top": _bar_top(item["lane"], lane_count),
                        "height": _bar_height(lane_count),
                        "color": seg["color"],
                        "label": seg["label"],
                    }
                )
            has_in_progress = any(t["status"] == "in_progress" for t in tech["current_tasks"])
            has_paused = any(t["status"] == "paused" for t in tech["current_tasks"])
            if has_in_progress:
                status_color = BUSY_COLOR["in_progress"]
            elif has_paused:
                status_color = BUSY_COLOR["paused"]
            else:
                status_color = PRESENCE_COLOR.get(tech["presence_status"], "#6c7d97")

            tech_rows.append(
                {
                    "tech": tech,
                    "initials": _initials(tech["name"]),
                    "height": height,
                    "bars": bars,
                    "status_color": status_color,
                    "current_task_name": tech["current_tasks"][0]["name"] if tech["current_tasks"] else None,
                }
            )

        hour_marks = [
            {"hour": h, "left": _fmt(((h - WINDOW_START_HOUR) / (WINDOW_END_HOUR - WINDOW_START_HOUR)) * 100)}
            for h in range(WINDOW_START_HOUR, WINDOW_END_HOUR + 1)
        ]

        techs_with_queue = sorted(
            (t for t in board["technicians"] if t["queue"]), key=lambda t: len(t["queue"]), reverse=True
        )
        side_groups = [{"tech": t, "count": len(t["queue"]), "items": t["queue"][:2]} for t in techs_with_queue[:3]]
        other_count = len(techs_with_queue) - len(side_groups)

        context = {
            "stats": board["stats"],
            "pool": board["pool"],
            "tech_rows": tech_rows,
            "hour_marks": hour_marks,
            "now_label": now.strftime("%d/%m/%Y %H:%M"),
            "now_pct": _fmt(_pct(now, now)),
            "side_groups": side_groups,
            "other_count": other_count,
        }
        return render(request, "bot/operations_print.html", context)

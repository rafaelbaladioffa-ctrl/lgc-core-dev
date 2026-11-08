"""Leitura dos modelos de SOW anteriores à seção "Connections & Cable Types".

Cada linha de ligação é convertida numa linha "canônica" que parse_line já
entende ("2x 36F SM LC/LC (76m) (Path A)"); origem, destino, pontos
intermediários, grupo e a linha original vão no contexto. Modelos cobertos:

- cabeçalho com o cabo + linhas com "-->"/"<-->"
  ("Euclid Brick to Euclid Spines: 08x Fiber Trunks 36F SM LC/LC." /
   "01x PR017-53 --> PR003-58: 76 meters - Route A (orange)");
- duas rotas na mesma linha ("2x A <--> B (Route A - 62m / Route B - 48m)"),
  que viram um item por rota com a quantidade dividida;
- cabo e quantidade "un." na própria linha
  ("038-68 --> 040-68: 02un. 2F fiber LC/LC 52 meters (route A).");
- "QTY: 8 - 2F TB Robust Fiber" e "CONSOLE_COPPER: 40x GREEN RJ45 & 1x ORANGE RJ45";
- linhas soltas "Nx ..." ("1 x 8F LC<>LC with 48m", "- 5x 2F ... up to 30m").
"""

import re

_FOOTER_TAIL_RE = re.compile(r"Note: This SOW is Amazon Confidential.*$", re.IGNORECASE)
_FOOTER_LINE_RE = re.compile(r"^\s*(Note: This SOW is Amazon Confidential|disclosed, in whole or in part)", re.IGNORECASE)
_ARROW_RE = re.compile(r"\s*(?:<-->|-->|<->)\s*")
_HEADING_RE = re.compile(r"^(?P<group>[^:]{3,100}?)(?::|\s-\s)\s*(?P<qty>\d+)\s*[xX]\s+(?P<desc>.+?)\s*[.:]?\s*$")
_PAREN_HEADING_RE = re.compile(r"^\(\s*(?P<group>.+?)\s+-\s+(?P<desc>.+?)\s*\)\s*$")
_LABEL_RE = re.compile(r"^\s*(?P<label>[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*:\s*(?P<rest>.*)$")
_QTY_LINE_RE = re.compile(r"^\s*QTY\s*:\s*(?P<qty>\d+)\s*-\s*(?P<desc>.+?)[\s\-]*$", re.IGNORECASE)
_LOOSE_ITEM_RE = re.compile(r"^\s*-?\s*(?P<qty>\d+)\s*[xX]\s+(?P<rest>\S.*)$")
_LEADING_QTY_RE = re.compile(r"^\s*-?\s*(?:(?P<qty>\d+)\s*[xX]\s+)?(?P<rest>.*)$")
_UNITS_RE = re.compile(r"\b(?P<qty>\d+)\s*un\.?\s*", re.IGNORECASE)
_ROUTE_PAIR_RE = re.compile(r"route\s*(?P<route>[ab])\s*-\s*(?P<len>\d+(?:\.\d+)?)\s*(?:m|meters?)\b", re.IGNORECASE)
_LENGTHS_RE = re.compile(
    r"(?P<len1>\d+(?:\.\d+)?)\s*(?:(?:m|meters?)\s*)?(?:and\s+(?P<len2>\d+(?:\.\d+)?)\s*)?(?:m|meters?)\b", re.IGNORECASE
)
_ROUTE_RE = re.compile(r"\broute\s*(?P<route>[ab])\b", re.IGNORECASE)
_COLOR_RE = re.compile(r"\((?P<color>orange|green|yellow|blue|white|black|red|gr[ae]y|aqua)\)", re.IGNORECASE)
_DEST_SPLIT_RE = re.compile(r"^(?P<dest>.+?)(?:\s*:\s*|\s+-\s+|\s*(?=\())(?P<tail>.*)$")
_FIBER_COUNT_TOKEN_RE = re.compile(r"\b\d+\s*F\b", re.IGNORECASE)
_COPPER_TOKEN_RE = re.compile(r"\b(UTP|CAT\s?6A?|RJ45)\b", re.IGNORECASE)


def clean_line(line):
    return re.sub(r"\s+", " ", _FOOTER_TAIL_RE.sub("", line)).strip()


def core_descriptor(desc):
    """Reduz a descrição do cabo ao trecho que o catálogo reconhece:
    "Fiber Trunks 36F SM LC/LC" -> "36F SM LC/LC", "Patch Fiber (8F) SMF LC/LC"
    -> "8F SM LC/LC", "Cable UTP CAT6" -> "UTP CAT6"."""
    desc = re.sub(r"\((\d+\s*F)\)", r"\1", desc, flags=re.IGNORECASE)
    desc = re.sub(r"\bSMF\b", "SM", desc, flags=re.IGNORECASE)
    desc = re.sub(r"\s+", " ", desc).strip(" .:-,")
    fiber = _FIBER_COUNT_TOKEN_RE.search(desc)
    if fiber:
        return desc[fiber.start() :].strip(" .:-,")
    copper = _COPPER_TOKEN_RE.search(desc)
    if copper:
        return desc[copper.start() :].strip(" .:-,")
    return desc


def _parse_arrow_row(line, heading_desc):
    """Uma linha com "-->"/"<-->" -> lista de (linha_canônica, contexto)."""
    leading = _LEADING_QTY_RE.match(line)
    qty = int(leading.group("qty")) if leading.group("qty") else None
    nodes = _ARROW_RE.split(leading.group("rest"))
    if len(nodes) < 2:
        return []
    origin = nodes[0].strip()
    split = _DEST_SPLIT_RE.match(nodes[-1].strip())
    destination, tail = (split.group("dest"), split.group("tail")) if split else (nodes[-1].strip(), "")
    via = [node.strip() for node in nodes[1:-1]]

    units = _UNITS_RE.search(tail)
    if qty is None and not units and not _LENGTHS_RE.search(tail):
        return []  # ex. lista "Cabling Priority": repete a ligação sem quantidade nem metragem
    desc = heading_desc
    if units:
        qty = qty or int(units.group("qty"))
        after_units = tail[units.end() :]
        length_match = _LENGTHS_RE.search(after_units)
        inline_desc = after_units[: length_match.start()] if length_match else after_units
        if inline_desc.strip():
            desc = inline_desc
    qty = qty or 1
    color_match = _COLOR_RE.search(tail)
    color = color_match.group("color") if color_match else ""
    descriptor = core_descriptor(desc or "")
    context = {"origin": origin, "destination": destination}
    if via:
        context["via"] = " → ".join(via)

    pairs = list(_ROUTE_PAIR_RE.finditer(tail))
    if len(pairs) > 1:
        each = qty // len(pairs) if qty % len(pairs) == 0 else qty
        return [
            (f"{each}x {descriptor} {color} ({pair.group('len')}m) (Path {pair.group('route').upper()})", dict(context))
            for pair in pairs
        ]

    if pairs:
        length, second, route = pairs[0].group("len"), None, pairs[0].group("route")
    else:
        length_match = _LENGTHS_RE.search(tail)
        length = length_match.group("len1") if length_match else None
        second = length_match.group("len2") if length_match else None
        route_match = _ROUTE_RE.search(tail)
        route = route_match.group("route") if route_match else None
    if second:
        # "90 and 36 meters": dois trechos — sem regra segura de soma, vai para revisão.
        context["segments_m"] = f"{length} + {second}"
        length = None
    canonical = f"{qty}x {descriptor} {color}".strip()
    if length:
        canonical += f" ({length}m)"
    if route:
        canonical += f" (Path {route.upper()})"
    return [(canonical, context)]


def extract_legacy_lines(text):
    """Linhas de item dos modelos antigos, como (linha_canônica, contexto);
    o contexto sempre traz "raw" (a linha original do SOW)."""
    items = []
    group = heading_desc = None
    for raw_line in (text or "").splitlines():
        if _FOOTER_LINE_RE.match(raw_line):
            continue
        line = clean_line(raw_line)
        if not line:
            continue

        if _ARROW_RE.search(line) and re.search(r"\d", line):
            for canonical, context in _parse_arrow_row(line, heading_desc):
                items.append((canonical, {"group": group, "raw": line, **context}))
            continue

        label = _LABEL_RE.match(line)
        parts = [line]
        if label:
            group = label.group("label")
            line = label.group("rest")
            parts = re.split(r"\s*&\s*", line)
        else:
            paren = _PAREN_HEADING_RE.match(line)
            heading = _HEADING_RE.match(line)
            if paren or (heading and not _LOOSE_ITEM_RE.match(line)):
                match = paren or heading
                group, heading_desc = match.group("group").strip(), match.group("desc")
                continue

        qty_line = _QTY_LINE_RE.match(line)
        if qty_line:
            items.append(
                (f"{qty_line.group('qty')}x {core_descriptor(qty_line.group('desc'))}", {"group": group, "raw": raw_line.strip()})
            )
            continue

        for part in parts:
            loose = _LOOSE_ITEM_RE.match(part)
            if loose:
                items.append((f"{loose.group('qty')}x {loose.group('rest')}", {"group": group, "raw": raw_line.strip()}))
    return items

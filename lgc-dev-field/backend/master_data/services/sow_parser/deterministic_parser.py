"""Parser determinístico (regex/regras) para linhas de SOW — a primeira
etapa da extração, ANTES de qualquer chamada de IA (ver
master_data/services/sow_parser/service.py). Roda sempre, mesmo sem IA
configurada (modo DETERMINISTIC_ONLY): reconhece os padrões mais comuns de
um SOW real (quantidade, contagem de fibras, metragem exata/máxima, cor,
path/rota, pré-terminado, e o texto candidato a família de cabo) por regex
puro, sem depender de rede/LLM.

Independente de Django/DRF de propósito (mesmo espírito de
task_rule_resolver.py) — só master_data.models é importado, e só dentro
das funções que realmente precisam consultar o banco (resolução de família/
part number), para manter a extração textual pura testável sem banco."""

import re
from decimal import Decimal, InvalidOperation

PARSER_VERSION = "v1"

_QUANTITY_RE = re.compile(r"^\s*(\d+)\s*[xX]\s*")
_FIBER_COUNT_RE = re.compile(r"\b(\d+)\s*F\b", re.IGNORECASE)

# Ordem importa: padrões mais específicos ("with", parênteses, "up to",
# "até") são tentados antes do fallback genérico "<número>m" solto.
_LENGTH_PATTERNS = (
    (re.compile(r"\bwith\s+(\d+(?:\.\d+)?)\s*m\b", re.IGNORECASE), "EXACT"),
    (re.compile(r"\bup\s+to\s+(\d+(?:\.\d+)?)\s*m\b", re.IGNORECASE), "MAXIMUM"),
    (re.compile(r"\bat[ée]\s+(\d+(?:\.\d+)?)\s*m\b", re.IGNORECASE), "MAXIMUM"),
    (re.compile(r"\((\d+(?:\.\d+)?)\s*m\)"), "EXACT"),
    (re.compile(r"\b(\d+(?:\.\d+)?)\s*m\b", re.IGNORECASE), "EXACT"),
)

_PATH_RE = re.compile(r"\(?\s*\b(route|path|rota)\s+([ab])\b\s*\)?", re.IGNORECASE)
_FROM_TO_RE = re.compile(r"\bfrom\s+\S+\s+to\s+\S+\b", re.IGNORECASE)
# "from ORIGEM to DESTINO", ou "ORIGEM to DESTINO" quando a origem parece
# posição de rack (ex. GRU65.01-02-020-50) — sem isso, nomes de família com
# "to" ("MPO to 4xLC Breakout") seriam partidos. O destino pode ter espaços.
_FROM_ORIGIN_DESTINATION_RE = re.compile(r"\bfrom\s+(\S+)\s+to\s+(.+?)\s*$", re.IGNORECASE)
_RACK_ORIGIN_DESTINATION_RE = re.compile(r"(\S*\d\S*\.\S*\d\S*)\s+to\s+(.+?)\s*$", re.IGNORECASE)
_PRETERMINATED_RE = re.compile(r"\bpr[eé][- ]?terminat(?:ed|ed|o|a|os|as)\b", re.IGNORECASE)

_COLOR_WORDS = (
    "GREEN",
    "ORANGE",
    "YELLOW",
    "BLUE",
    "WHITE",
    "BLACK",
    "RED",
    "GRAY",
    "GREY",
    "VIOLET",
    "PURPLE",
    "PINK",
    "AQUA",
)
_COLOR_RE = re.compile(r"\b(" + "|".join(_COLOR_WORDS) + r")\b", re.IGNORECASE)

# Palavras "de preenchimento" que aparecem junto do nome do cabo mas não
# fazem parte do texto candidato usado para resolver a família (plural
# tratado à parte, ver _strip_trailing_plural).
_FILLER_WORDS_RE = re.compile(r"\b(cable|cables|cord|cords|wire|wires)\b", re.IGNORECASE)

_COPPER_HINTS = ("CAT5", "CAT6", "CAT6A", "CAT7", "COPPER", "UTP", "RJ45")
_FIBER_HINTS = ("FIBER", "FIBRA", "OS1", "OS2", "OM3", "OM4", "MPO", "LC", "SC", "SINGLE MODE", "MULTIMODE")


def split_sow_text_into_lines(text):
    """Cada linha não vazia do texto do SOW é candidata a um item — mesma
    convenção usada no critério de aceite (3 linhas coladas -> 3 itens)."""
    return [line.strip() for line in (text or "").splitlines() if line.strip()]


_CONNECTIONS_HEADER_RE = re.compile(r"^\s*connections\s*&\s*cable\s+types\s*:?\s*$", re.IGNORECASE)
_SECTION_END_RE = re.compile(
    r"^\s*(AWS STANDARD GUIDELINES|PROJECT RISK ASSESSMENT|GENERAL REQUIREMENTS|BID INSTRUCTION|REVISION HISTORY)\b"
)
_PAGE_FOOTER_RE = re.compile(r"^\s*(Note: This SOW is Amazon Confidential|disclosed, in whole or in part)", re.IGNORECASE)
_GROUP_RE = re.compile(r"^\s*==\s*(.+?)\s*==\s*$")
_ROOM_RE = re.compile(r"^\s*(room\s+[\w-]+)\s*$", re.IGNORECASE)
_CONNECTION_LINE_RE = re.compile(r"^\s*\d+\s*[xX]\s+\S")
_SOW_DOCUMENT_RE = re.compile(r"scope\s+of\s+work|infrastructure\s+delivery|bid\s+instruction", re.IGNORECASE)


def extract_sow_lines(text):
    """Linhas de item do SOW, cada uma com seu contexto ({"group", "room"}).

    Quando o texto traz a seção "Connections & Cable Types" (SOWs de cabling
    da AWS), só as linhas de ligação dessa seção viram item — o texto
    contratual, datas e contatos são ignorados; "== Grupo ==" e "Room X-Y"
    viram contexto, e uma linha quebrada pelo PDF é reemendada à anterior.
    Sem essa seção, tenta os modelos antigos (legacy_formats); se nada for
    reconhecido, cada linha não vazia vira item (listas coladas à mão)."""
    from .legacy_formats import extract_legacy_lines

    items = _extract_connections_section(text)
    if items:
        return items
    items = extract_legacy_lines(text)
    if items or _SOW_DOCUMENT_RE.search(text or ""):
        # Documento de SOW sem nenhuma ligação reconhecida (ex. só instalação
        # de bridges/racks): nada vira item, em vez de cada parágrafo.
        return items
    return [(line, {}) for line in split_sow_text_into_lines(text)]


def _extract_connections_section(text):
    raw_lines = (text or "").splitlines()
    start = next((i for i, line in enumerate(raw_lines) if _CONNECTIONS_HEADER_RE.match(line)), None)
    if start is None:
        return []

    items = []
    group = room = None
    for line in raw_lines[start + 1 :]:
        stripped = line.strip()
        if _SECTION_END_RE.match(stripped):
            break
        if not stripped or _PAGE_FOOTER_RE.match(stripped):
            continue
        group_match = _GROUP_RE.match(stripped)
        if group_match:
            group, room = group_match.group(1), None
            continue
        room_match = _ROOM_RE.match(stripped)
        if room_match:
            room = room_match.group(1).title()
            continue
        if _CONNECTION_LINE_RE.match(stripped):
            items.append((stripped, {"group": group, "room": room}))
        elif items:
            previous_line, context = items[-1]
            items[-1] = (f"{previous_line} {stripped}", context)
    return items


def _extract_quantity(text):
    match = _QUANTITY_RE.match(text)
    if not match:
        return None, text
    quantity = int(match.group(1))
    remainder = text[match.end() :]
    return quantity, remainder


def _extract_length(text):
    for pattern, length_type in _LENGTH_PATTERNS:
        match = pattern.search(text)
        if match:
            try:
                length_m = Decimal(match.group(1))
            except InvalidOperation:
                continue
            remainder = text[: match.start()] + text[match.end() :]
            return length_type, length_m, remainder
    return None, None, text


def _extract_path(text):
    match = _PATH_RE.search(text)
    if not match:
        return None, text
    path_code = f"PATH-{match.group(2).upper()}"
    remainder = text[: match.start()] + text[match.end() :]
    return path_code, remainder


def _extract_fiber_count(text):
    match = _FIBER_COUNT_RE.search(text)
    if not match:
        return None
    return int(match.group(1))


def _extract_color(text):
    match = _COLOR_RE.search(text)
    if not match:
        return None
    color = match.group(1).upper()
    return "GRAY" if color == "GREY" else color


def _extract_preterminated(text):
    return bool(_PRETERMINATED_RE.search(text))


def _clean_candidate(text):
    text = _FROM_TO_RE.sub(" ", text)
    text = re.sub(r"\b(around|approx\.?|approximately|aprox\.?|cerca de)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"[,;]", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" -")
    return text


def _strip_color(text, color):
    if not color:
        return text
    return re.sub(re.escape(color), "", text, flags=re.IGNORECASE)


def _strip_fillers(text):
    return _FILLER_WORDS_RE.sub("", text)


def _strip_trailing_plural(text):
    """'2F ROBUST FIBERS' -> '2F ROBUST FIBER' (só a última palavra, e só
    quando termina em 'S' com mais de uma letra) — cobre o caso mais comum
    de divergência singular/plural entre o SOW e o CableAlias cadastrado,
    sem tentar um stemmer completo."""
    words = text.split(" ")
    if not words:
        return text
    last = words[-1]
    if len(last) > 1 and last.upper().endswith("S"):
        words[-1] = last[:-1]
        return " ".join(words)
    return text


def guess_medium(candidate_text):
    upper = candidate_text.upper()
    if any(hint in upper for hint in _COPPER_HINTS):
        return "COPPER"
    if any(hint in upper for hint in _FIBER_HINTS):
        return "FIBER"
    return ""


def _looks_like_part_number(token):
    if len(token) < 6:
        return False
    has_digit = any(ch.isdigit() for ch in token)
    has_alpha = any(ch.isalpha() for ch in token)
    return has_digit and has_alpha


def resolve_part_number(candidate_text):
    """Procura, entre os tokens alfanuméricos do texto candidato, um que
    bata (case-insensitive) com CableSpec.part_number — mesma prioridade
    dada pelo pedido original ("Ao encontrar part number: procurar
    CableSpec correspondente"). Retorna a instância de CableSpec ou None.
    Consulta o banco (ao contrário do resto deste módulo) — só chamada
    pelo service, nunca pelos testes puros de extração textual."""
    from master_data.models import CableSpec

    tokens = re.split(r"[\s,;]+", candidate_text)
    for token in tokens:
        token = token.strip(".()")
        if not token or not _looks_like_part_number(token):
            continue
        spec = CableSpec.objects.filter(part_number__iexact=token, active=True).select_related("cable_family").first()
        if spec is not None:
            return spec
    return None


def resolve_cable_family_by_text(candidate_text):
    """Tenta resolver `candidate_text` contra CableAlias.normalized_alias
    ou CableFamily.name (ambos comparados normalizados — mesma função
    normalize_alias_text já usada por CableAlias), tentando algumas
    variantes (com/sem cor, singular/plural) antes de desistir. Retorna a
    CableFamily ou None. Consulta o banco — só chamada pelo service."""
    from master_data.models import CableAlias, CableFamily, normalize_alias_text

    color = _extract_color(candidate_text)
    variants = [candidate_text, _strip_color(candidate_text, color)]
    all_variants = []
    for variant in variants:
        cleaned = _clean_candidate(variant)
        if not cleaned:
            continue
        all_variants.append(cleaned)
        stripped = _strip_trailing_plural(cleaned)
        if stripped != cleaned:
            all_variants.append(stripped)

    seen = set()
    for variant in all_variants:
        normalized = normalize_alias_text(variant)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        alias = CableAlias.objects.filter(normalized_alias=normalized, active=True).select_related(
            "cable_family"
        ).first()
        if alias is not None:
            return alias.cable_family
        family = CableFamily.objects.filter(active=True, name__iexact=variant).first()
        if family is not None:
            return family
    return None


def parse_line(raw_text):
    """Extrai o máximo possível de `raw_text` (uma linha do SOW) sem
    nenhuma chamada de IA. Retorna um dict "draft" com os campos
    reconhecidos (valores primitivos, nunca instâncias de model — a
    resolução contra o banco de família/spec acontece à parte, ver
    resolve_part_number/resolve_cable_family_by_text, chamadas pelo
    service depois de decidir se usa o resultado determinístico ou o da
    IA). Nunca levanta exceção — campos não reconhecidos ficam None."""

    remainder = raw_text
    quantity, remainder = _extract_quantity(remainder)
    length_type, length_m, remainder = _extract_length(remainder)
    path_code, remainder = _extract_path(remainder)
    origin = destination = None
    od_match = _FROM_ORIGIN_DESTINATION_RE.search(remainder) or _RACK_ORIGIN_DESTINATION_RE.search(remainder)
    if od_match:
        origin, destination = od_match.group(1), od_match.group(2).strip(" .")
        remainder = remainder[: od_match.start()]
    fiber_count = _extract_fiber_count(remainder)
    color = _extract_color(remainder)
    preterminated = _extract_preterminated(remainder) or None
    candidate_text = _clean_candidate(remainder)
    medium_guess = guess_medium(candidate_text)

    return {
        "raw_text": raw_text,
        "item_type": "CABLE",
        "quantity": quantity,
        "candidate_text": candidate_text,
        "length_type": length_type,
        "length_m": length_m,
        "path_code": path_code,
        "fiber_count": fiber_count,
        "color": color,
        "preterminated": preterminated,
        "medium_guess": medium_guess,
        "origin": origin,
        "destination": destination,
    }

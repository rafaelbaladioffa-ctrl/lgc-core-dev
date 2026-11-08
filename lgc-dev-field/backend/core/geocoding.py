import logging
import re
import time

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Nomes de provedores de datacenter que costumam aparecer como prefixo do
# endereço (ex: "Ascenty - Rua Papa João Paulo II, 4"). O Nominatim não
# reconhece esses nomes de negócio como parte do logradouro.
_VENDOR_PREFIX_RE = re.compile(
    r"^(ascenty|equinix|scala|odata|ciron|cirion|classe a microsoft)\s*-\s*",
    re.IGNORECASE,
)

# Depois do nome do provedor, muitos endereços têm complementos
# (bloco/andar/condomínio/bairro) separados por " - " ou vírgula depois do
# número, que o Nominatim também não interpreta bem. Este padrão captura só
# "logradouro + número" (para no primeiro token numérico).
_STREET_AND_NUMBER_RE = re.compile(r"^(.*?\d[\d/º°]*)")


def _strip_vendor_prefix(text):
    return _VENDOR_PREFIX_RE.sub("", text, count=1).strip()


def _street_and_number(text):
    match = _STREET_AND_NUMBER_RE.match(text)
    return match.group(1).strip() if match else None


def _request_nominatim(query, headers):
    try:
        response = requests.get(
            NOMINATIM_URL,
            params={"q": query, "format": "json", "limit": 1},
            headers=headers,
            timeout=8,
        )
        response.raise_for_status()
        results = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Falha ao geocodificar '%s': %s", query, exc)
        return None

    if not results:
        return None

    try:
        return float(results[0]["lat"]), float(results[0]["lon"])
    except (KeyError, TypeError, ValueError):
        return None


def geocode_address(query):
    """Converte um endereço em (latitude, longitude) usando o Nominatim
    (OpenStreetMap), um serviço gratuito de geocodificação. Retorna None
    se o endereço não puder ser localizado ou em caso de erro de rede.
    """
    query = (query or "").strip()
    if not query:
        return None

    contact = getattr(settings, "DEFAULT_FROM_EMAIL", "contato@consultimer.com")
    headers = {"User-Agent": f"ERP-CSTR/1.0 ({contact})"}
    return _request_nominatim(query, headers)


def geocode_site_address(address, city, state):
    """Geocodifica o endereço de um Site tentando, em ordem, variações cada
    vez mais simples até uma funcionar — muitos endereços cadastrados têm
    prefixo de provedor de datacenter (Ascenty, Equinix, Scala, Odata...) e
    complementos (bloco/andar/condomínio) que o Nominatim não reconhece
    como parte do logradouro:

    1. Endereço completo, como cadastrado.
    2. Sem o prefixo do provedor.
    3. Só "logradouro + número" (descartando complementos), com cidade/UF.
    4. Só cidade/UF (aproximado, mas ainda baseado no endereço cadastrado).
    """
    city_state = ", ".join(filter(None, (city, state, "Brasil")))
    address = (address or "").strip()

    candidates = []
    if address:
        candidates.append(", ".join(filter(None, (address, city_state))))

        stripped = _strip_vendor_prefix(address)
        if stripped and stripped != address:
            candidates.append(", ".join(filter(None, (stripped, city_state))))

        street_number = _street_and_number(stripped or address)
        if street_number and street_number not in (address, stripped):
            candidates.append(", ".join(filter(None, (street_number, city_state))))

    if city_state:
        candidates.append(city_state)

    seen = set()
    for index, query in enumerate(candidates):
        if query in seen:
            continue
        seen.add(query)
        if index:
            time.sleep(1)  # respeita o limite de 1 req/s do Nominatim entre tentativas
        result = geocode_address(query)
        if result:
            return result
    return None

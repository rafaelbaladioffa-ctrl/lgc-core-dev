"""Cadastro guiado de modelo de cabo, passo a passo.

O usuário só escolhe/informa características (meio, tipo, nº de fibras,
conectores, fabricante, part number...). O CÓDIGO e o NOME da família e da
especificação são sempre gerados aqui, seguindo o padrão já usado no catálogo:

    Família FIBRA   FIB-{n}F-{conectores}      nome "{n}F {A}-{B}"       FIB-8F-LCLC / 8F LC-LC
    Família ROBUST  FIB-{n}F-ROBUST            nome "{n}F Robust"
    Breakout        BRK-{A}-{pernas}{B}        nome "{A} to {pernas}x{B} Breakout"
    AOC             FIB-{vel}-AOC-{comp}       nome "{vel}-AOC-{comp}"
    Cobre           COP-{CAT}[-{blindagem}]    nome "{CAT} {blindagem}"  COP-CAT6 / CAT6 UTP
    Especificação   SPEC-{família sem prefixo}-{part number sem sufixo de metragem}

Conectores iguais de até 2 letras são unidos (LC+LC -> LCLC); os demais levam
hífen (MPO-MPO, MPO-LC). Nenhuma função daqui confia em código/nome vindo do
cliente: `create_from_wizard` recalcula tudo a partir das características.
"""

import re

from django.db import transaction

from master_data.models import CableAlias, CableFamily, CableSpec, normalize_alias_text

CATEGORY_TRUNK = "TRUNK"
CATEGORY_PATCH = "PATCH"
CATEGORY_ROBUST = "ROBUST"
CATEGORY_BREAKOUT = "BREAKOUT"
CATEGORY_AOC = "AOC"
CATEGORY_COPPER = "COPPER"

FIBER_CATEGORIES = (CATEGORY_TRUNK, CATEGORY_PATCH, CATEGORY_ROBUST, CATEGORY_BREAKOUT, CATEGORY_AOC)
CATEGORY_TITLES = {
    CATEGORY_TRUNK: "Trunk",
    CATEGORY_PATCH: "Patch",
    CATEGORY_ROBUST: "Robust",
    CATEGORY_BREAKOUT: "Breakout",
    CATEGORY_AOC: "AOC",
    CATEGORY_COPPER: "Copper",
}

COPPER_TYPES = ("CAT5E", "CAT6", "CAT6A")
SHIELDINGS = ("UTP", "F/UTP", "S/FTP")

DEFAULT_CONNECTORS = ("LC", "LCU", "MPO", "MMC", "SC", "QSFP28", "RJ45")
DEFAULT_FIBER_COUNTS = (2, 8, 12, 18, 24, 36, 48, 72, 96, 144, 288)
DEFAULT_FIBER_TYPES = ("OS2", "OM3", "OM4", "OM5")
DEFAULT_COLORS = ("YELLOW", "AQUA", "ORANGE", "GREEN", "BLUE", "BLACK")
DEFAULT_POLARITIES = ("A", "B", "C")

WORK_GROUP_NONE = "NONE"  # o usuário escolheu explicitamente "sem grupo"
ALIAS_TYPE_NAME = "NAME_VARIATION"
ALIAS_TYPE_PART_NUMBER = "PART_NUMBER"
CREATED_BY_WIZARD_NOTE = "Criado pelo cadastro guiado de cabos."


class WizardError(Exception):
    """Entrada inválida ou conflito que impede o cadastro."""

    def __init__(self, message, errors=None):
        super().__init__(message)
        self.errors = errors or [message]


def _text(value):
    return str(value or "").strip()


def _upper(value):
    return _text(value).upper()


def _positive_int(value, label, errors, *, required):
    if value in (None, ""):
        if required:
            errors.append(f"{label} é obrigatório.")
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        errors.append(f"{label} deve ser um número inteiro.")
        return None
    if number <= 0:
        errors.append(f"{label} deve ser maior que zero.")
        return None
    return number


def clean_input(data):
    """Valida e normaliza as respostas do passo a passo. Levanta WizardError
    com todas as mensagens quando algo está faltando ou inválido."""
    errors = []
    data = data or {}

    medium = _upper(data.get("medium"))
    if medium not in (CableFamily.MEDIUM_FIBER, CableFamily.MEDIUM_COPPER):
        errors.append("Escolha o meio: fibra ou cobre.")
        raise WizardError(errors[0], errors)

    cleaned = {
        "medium": medium,
        "category": CATEGORY_COPPER if medium == CableFamily.MEDIUM_COPPER else _upper(data.get("category")),
        "fiber_count": None,
        "connector_a": _upper(data.get("connector_a")),
        "connector_b": _upper(data.get("connector_b")),
        "copper_type": "",
        "shielding": "",
        "legs": None,
        "speed": "",
        "length": "",
        "preterminated": bool(data.get("preterminated", medium == CableFamily.MEDIUM_FIBER)),
        "work_group": _upper(data.get("work_group")),
        "reuse_family_id": data.get("reuse_family_id") or None,
        "aliases": [],
        "spec": None,
    }

    if medium == CableFamily.MEDIUM_COPPER:
        cleaned["copper_type"] = _upper(data.get("copper_type"))
        cleaned["shielding"] = _upper(data.get("shielding")) or "UTP"
        if cleaned["copper_type"] not in COPPER_TYPES:
            errors.append("Escolha o tipo de cobre (CAT5E, CAT6 ou CAT6A).")
        if cleaned["shielding"] not in SHIELDINGS:
            errors.append("Escolha a blindagem (UTP, F/UTP ou S/FTP).")
        cleaned["connector_a"] = cleaned["connector_a"] or "RJ45"
        cleaned["connector_b"] = cleaned["connector_b"] or "RJ45"
    else:
        category = cleaned["category"]
        if category not in FIBER_CATEGORIES:
            errors.append("Escolha o tipo de cabo.")
        elif category in (CATEGORY_TRUNK, CATEGORY_PATCH):
            cleaned["fiber_count"] = _positive_int(data.get("fiber_count"), "Nº de fibras", errors, required=True)
            if not cleaned["connector_a"] or not cleaned["connector_b"]:
                errors.append("Informe o conector A e o conector B.")
        elif category == CATEGORY_ROBUST:
            cleaned["fiber_count"] = _positive_int(data.get("fiber_count"), "Nº de fibras", errors, required=True)
            cleaned["connector_a"] = cleaned["connector_a"] or "LC"
            cleaned["connector_b"] = cleaned["connector_b"] or "LC"
        elif category == CATEGORY_BREAKOUT:
            cleaned["legs"] = _positive_int(data.get("legs"), "Nº de pernas", errors, required=True)
            cleaned["fiber_count"] = _positive_int(data.get("fiber_count"), "Nº de fibras", errors, required=False)
            if cleaned["fiber_count"] is None and cleaned["legs"]:
                cleaned["fiber_count"] = cleaned["legs"] * 2
            if not cleaned["connector_a"] or not cleaned["connector_b"]:
                errors.append("Informe o conector A (lado do tronco) e o conector B (lado das pernas).")
        elif category == CATEGORY_AOC:
            cleaned["speed"] = _upper(data.get("speed"))
            cleaned["length"] = _upper(data.get("length"))
            cleaned["fiber_count"] = _positive_int(data.get("fiber_count"), "Nº de fibras", errors, required=False)
            cleaned["connector_a"] = cleaned["connector_a"] or "QSFP28"
            cleaned["connector_b"] = cleaned["connector_b"] or cleaned["connector_a"]
            if not cleaned["speed"]:
                errors.append("Informe a velocidade (ex.: 100G).")
            if not cleaned["length"]:
                errors.append("Informe o comprimento (ex.: 20M).")

    valid_groups = {value for value, _ in CableFamily.WORK_GROUP_CHOICES}
    if cleaned["work_group"] and cleaned["work_group"] != WORK_GROUP_NONE and cleaned["work_group"] not in valid_groups:
        errors.append("Grupo de trabalho inválido.")

    for alias in data.get("aliases") or []:
        alias = _text(alias)
        if alias and alias not in cleaned["aliases"]:
            cleaned["aliases"].append(alias)

    spec = data.get("spec")
    if spec:
        cleaned["spec"] = {
            "manufacturer": _text(spec.get("manufacturer")),
            "part_number": _text(spec.get("part_number")),
            "fiber_type": _upper(spec.get("fiber_type")),
            "jacket_color": _upper(spec.get("jacket_color")),
            "polarity": _upper(spec.get("polarity")),
        }
        if not cleaned["spec"]["part_number"] and not cleaned["spec"]["manufacturer"]:
            errors.append("Na especificação, informe ao menos o fabricante ou o part number.")

    if errors:
        raise WizardError(errors[0], errors)
    return cleaned


def _connector_part(a, b):
    if a == b and len(a) <= 2:
        return f"{a}{b}"
    return f"{a}-{b}"


def base_family_identity(cleaned):
    """(código, nome) padrão da família, antes de checar colisões no banco."""
    category = cleaned["category"]
    n = cleaned["fiber_count"]
    a, b = cleaned["connector_a"], cleaned["connector_b"]

    if cleaned["medium"] == CableFamily.MEDIUM_COPPER:
        ctype, shield = cleaned["copper_type"], cleaned["shielding"]
        code = f"COP-{ctype}" if shield == "UTP" else f"COP-{ctype}-{shield.replace('/', '')}"
        return code, f"{ctype} {shield}"
    if category == CATEGORY_BREAKOUT:
        legs = cleaned["legs"]
        return f"BRK-{a}-{legs}{b}", f"{a} to {legs}x{b} Breakout"
    if category == CATEGORY_AOC:
        return f"FIB-{cleaned['speed']}-AOC-{cleaned['length']}", f"{cleaned['speed']}-AOC-{cleaned['length']}"
    if category == CATEGORY_ROBUST:
        return f"FIB-{n}F-ROBUST", f"{n}F Robust"
    return f"FIB-{n}F-{_connector_part(a, b)}", f"{n}F {a}-{b}"


def effective_work_group(cleaned):
    """Grupo gravado: o escolhido; vazio = o sugerido; NONE = nenhum."""
    chosen = cleaned["work_group"]
    if chosen == WORK_GROUP_NONE:
        return ""
    return chosen or suggest_work_group(cleaned)


def suggest_work_group(cleaned):
    """Grupo de trabalho sugerido pelas mesmas regras do catálogo atual."""
    category = cleaned["category"]
    n = cleaned["fiber_count"] or 0
    a, b = cleaned["connector_a"], cleaned["connector_b"]
    if cleaned["medium"] == CableFamily.MEDIUM_COPPER:
        return "COPPER_CAT6" if cleaned["copper_type"] == "CAT6" else ""
    if category == CATEGORY_BREAKOUT:
        return "BREAKOUT"
    if category == CATEGORY_AOC:
        return "AOC"
    if n == 2:
        return "FIBER_2F"
    if category == CATEGORY_TRUNK:
        if any(c.startswith(("MPO", "MMC")) for c in (a, b)):
            return "TRUNK_MPO"
        if a.startswith("LC") and b.startswith("LC"):
            return "TRUNK_LC_SMALL" if n <= 18 else "TRUNK_LC_LARGE"
    return ""


def find_equivalent_family(cleaned):
    """Família já cadastrada com as mesmas características (ou com o mesmo
    código padrão e a mesma categoria). Evita criar duplicata."""
    code, _ = base_family_identity(cleaned)
    queryset = CableFamily.objects.filter(cable_category__iexact=cleaned["category"])
    if cleaned["category"] in (CATEGORY_COPPER, CATEGORY_AOC, CATEGORY_BREAKOUT):
        # Nesses tipos as características de fibras/conectores não distinguem
        # os modelos (CAT6 x CAT6A, AOC 100G x 400G, breakout de 4 x 8 pernas):
        # a identidade é o próprio código gerado.
        return queryset.filter(code=code).first()
    by_traits = queryset.filter(
        medium=cleaned["medium"],
        fiber_count=cleaned["fiber_count"],
        connector_a__iexact=cleaned["connector_a"],
        connector_b__iexact=cleaned["connector_b"],
    ).first()
    if by_traits is not None:
        return by_traits
    return queryset.filter(code=code).first()


def resolve_new_family_identity(cleaned):
    """Código e nome únicos para uma família NOVA. Se o código padrão já é
    de outra família (ex.: patch e trunk com mesmo nº de fibras e conectores),
    acrescenta a categoria e, se preciso, um número."""
    code, name = base_family_identity(cleaned)
    category_suffix = CATEGORY_TITLES.get(cleaned["category"], cleaned["category"]).upper()
    candidate = code
    if CableFamily.objects.filter(code=candidate).exists():
        candidate = f"{code}-{category_suffix}"
    counter = 2
    while CableFamily.objects.filter(code=candidate).exists():
        candidate = f"{code}-{category_suffix}-{counter}"
        counter += 1
    if candidate != code:
        name = f"{name} {CATEGORY_TITLES.get(cleaned['category'], '')}".strip()
    return candidate, name


def suggest_aliases(cleaned):
    category = cleaned["category"]
    n = cleaned["fiber_count"]
    a, b = cleaned["connector_a"], cleaned["connector_b"]
    if cleaned["medium"] == CableFamily.MEDIUM_COPPER:
        ctype, shield = cleaned["copper_type"], cleaned["shielding"]
        return [ctype, f"{ctype} {shield}", f"{ctype} CABLE", f"{ctype} COPPER"]
    if category == CATEGORY_BREAKOUT:
        legs = cleaned["legs"]
        return [f"{a} TO {legs}X {b} BREAKOUT", f"{a} TO {legs}X{b} BREAKOUT"]
    if category == CATEGORY_AOC:
        return [f"{cleaned['speed']}-AOC-{cleaned['length']}"]
    if category == CATEGORY_ROBUST:
        return [f"{n}F ROBUST", f"{n}F ROBUST FIBER", f"{n}F ROBUST CORD"]
    return [f"{n}F {a}-{b}", f"{n}F {a}/{b}", f"{n}F {a}<>{b}"]


_LENGTH_PLACEHOLDER = re.compile(r"-?X{2,}M$", re.IGNORECASE)


def _clean_part_number(part_number):
    return _LENGTH_PLACEHOLDER.sub("", part_number.strip())


def _slug(text):
    return re.sub(r"[^A-Z0-9]+", "", text.upper())


def base_spec_identity(cleaned, family_code, family_name):
    """(código, nome) padrão da especificação."""
    spec = cleaned["spec"]
    stripped = family_code.split("-", 1)[1] if "-" in family_code else family_code
    tail = _clean_part_number(spec["part_number"]) if spec["part_number"] else (_slug(spec["manufacturer"])[:12] or "CSTR")
    code = f"SPEC-{stripped}-{tail}"

    parts = []
    if cleaned["fiber_count"] and cleaned["medium"] == CableFamily.MEDIUM_FIBER:
        parts.append(f"{cleaned['fiber_count']}F")
    if spec["fiber_type"]:
        parts.append(spec["fiber_type"])
    if spec["jacket_color"]:
        parts.append(spec["jacket_color"].title())
    descriptive = bool(spec["fiber_type"] or spec["jacket_color"] or spec["polarity"])
    if descriptive and cleaned["connector_a"] and cleaned["connector_b"] and cleaned["medium"] == CableFamily.MEDIUM_FIBER:
        parts.append(f"{cleaned['connector_a']}/{cleaned['connector_b']}")
        if spec["polarity"]:
            parts.append(f"{cleaned['connector_a']}-{spec['polarity']}")
    name = " ".join(parts) if descriptive else family_name
    return code, name


def resolve_spec_identity(cleaned, family_code, family_name):
    code, name = base_spec_identity(cleaned, family_code, family_name)
    candidate, counter = code, 2
    while CableSpec.objects.filter(code=candidate).exists():
        candidate = f"{code}-{counter}"
        counter += 1
    return candidate, name


def _alias_entries(cleaned, family):
    """Aliases pedidos + o part number como alias (padrão do catálogo)."""
    entries = [(text, ALIAS_TYPE_NAME) for text in cleaned["aliases"]]
    spec = cleaned["spec"]
    if spec and spec["part_number"]:
        entries.append((spec["part_number"], ALIAS_TYPE_PART_NUMBER))
    result, seen = [], set()
    for text, alias_type in entries:
        normalized = normalize_alias_text(text)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        existing = CableAlias.objects.filter(normalized_alias=normalized).select_related("cable_family").first()
        if existing is None:
            state, message = "new", ""
        elif family is not None and existing.cable_family_id == family.pk:
            state, message = "exists", "Já cadastrado nesta família."
        else:
            state = "conflict"
            message = f'O alias "{normalized}" já pertence à família {existing.cable_family.code}.'
        result.append({"text": text, "type": alias_type, "state": state, "message": message})
    return result


def build_preview(data):
    """Tudo o que o passo a passo precisa mostrar, sem gravar nada."""
    cleaned = clean_input(data)
    equivalent = find_equivalent_family(cleaned)
    errors = []

    if equivalent is not None:
        family = {
            "mode": "existing",
            "id": equivalent.pk,
            "code": equivalent.code,
            "name": equivalent.name,
        }
        family_for_aliases, family_code, family_name = equivalent, equivalent.code, equivalent.name
    else:
        code, name = resolve_new_family_identity(cleaned)
        family = {"mode": "new", "id": None, "code": code, "name": name}
        family_for_aliases, family_code, family_name = None, code, name

    suggestion = suggest_work_group(cleaned)
    family.update(
        {
            "category": cleaned["category"],
            "fiber_count": cleaned["fiber_count"],
            "connector_a": cleaned["connector_a"],
            "connector_b": cleaned["connector_b"],
            "work_group_suggestion": suggestion,
            "work_group": effective_work_group(cleaned),
            "preterminated": cleaned["preterminated"],
        }
    )

    # Sugestões (marcadas por padrão) + aliases já escolhidos/digitados.
    suggested = suggest_aliases(cleaned)
    requested = cleaned["aliases"] or []
    probe = dict(cleaned, aliases=list(dict.fromkeys(suggested + requested)))
    aliases = _alias_entries(probe, family_for_aliases)
    for entry in aliases:
        entry["suggested"] = entry["text"] in suggested
        if entry["type"] == ALIAS_TYPE_PART_NUMBER:
            entry["selected"] = True  # o part number sempre entra como alias (padrão do catálogo)
        else:
            entry["selected"] = (entry["text"] in requested) if requested else entry["suggested"]
        if entry["state"] == "conflict" and entry["selected"] and entry["type"] == ALIAS_TYPE_NAME:
            errors.append(entry["message"])

    spec = None
    if cleaned["spec"]:
        spec_code, spec_name = resolve_spec_identity(cleaned, family_code, family_name)
        spec_conflicts = []
        part_number = cleaned["spec"]["part_number"]
        if part_number and CableSpec.objects.filter(part_number__iexact=part_number, active=True).exists():
            spec_conflicts.append(f'Já existe uma especificação ativa com o part number "{part_number}".')
        for entry in aliases:
            if entry["type"] == ALIAS_TYPE_PART_NUMBER and entry["state"] == "conflict":
                spec_conflicts.append(entry["message"])
        errors.extend(spec_conflicts)
        spec = {"code": spec_code, "name": spec_name, "part_number": part_number, "conflicts": spec_conflicts}

    return {
        "family": family,
        "aliases": aliases,
        "spec": spec,
        "errors": errors,
        "can_create": not errors,
    }


@transaction.atomic
def create_from_wizard(data, user):
    """Grava família (nova ou existente), aliases e especificação. Código e
    nome são sempre os gerados pelo sistema. Tudo ou nada."""
    cleaned = clean_input(data)
    equivalent = find_equivalent_family(cleaned)

    reuse_id = cleaned["reuse_family_id"]
    if equivalent is not None and str(reuse_id) != str(equivalent.pk):
        raise WizardError(
            f'Já existe a família "{equivalent.code}" com essas características. Use a família existente.'
        )
    if equivalent is None and reuse_id:
        raise WizardError("A família escolhida para reaproveitar não existe mais. Refaça o passo a passo.")

    created = {"family": None, "family_created": False, "aliases": [], "spec": None}
    if equivalent is not None:
        family = equivalent
    else:
        code, name = resolve_new_family_identity(cleaned)
        family = CableFamily.objects.create(
            code=code,
            name=name,
            medium=cleaned["medium"],
            fiber_count=cleaned["fiber_count"],
            connector_a=cleaned["connector_a"],
            connector_b=cleaned["connector_b"],
            cable_category=cleaned["category"],
            preterminated=cleaned["preterminated"],
            work_group=effective_work_group(cleaned),
            description=CREATED_BY_WIZARD_NOTE,
            active=True,
            created_by=user,
            updated_by=user,
        )
        created["family_created"] = True
    created["family"] = {"id": family.pk, "code": family.code, "name": family.name}

    entries = _alias_entries(cleaned, family if equivalent is not None else None)
    conflicts = [entry["message"] for entry in entries if entry["state"] == "conflict"]
    if conflicts:
        raise WizardError(conflicts[0], conflicts)
    for entry in entries:
        if entry["state"] != "new":
            continue
        CableAlias.objects.create(
            cable_family=family,
            alias=entry["text"],
            alias_type=entry["type"],
            description=CREATED_BY_WIZARD_NOTE,
            active=True,
            created_by=user,
            updated_by=user,
        )
        created["aliases"].append(entry["text"])

    spec_data = cleaned["spec"]
    if spec_data:
        part_number = spec_data["part_number"]
        if part_number and CableSpec.objects.filter(part_number__iexact=part_number, active=True).exists():
            raise WizardError(f'Já existe uma especificação ativa com o part number "{part_number}".')
        spec_code, spec_name = resolve_spec_identity(cleaned, family.code, family.name)
        spec = CableSpec.objects.create(
            cable_family=family,
            code=spec_code,
            name=spec_name,
            manufacturer=spec_data["manufacturer"],
            part_number=part_number,
            fiber_type=spec_data["fiber_type"],
            jacket_color=spec_data["jacket_color"],
            polarity=spec_data["polarity"],
            connector_a=cleaned["connector_a"],
            connector_b=cleaned["connector_b"],
            fiber_count=cleaned["fiber_count"],
            description=CREATED_BY_WIZARD_NOTE,
            active=True,
            created_by=user,
            updated_by=user,
        )
        created["spec"] = {"id": spec.pk, "code": spec.code, "name": spec.name}

    return created


def wizard_options():
    """Opções dos seletores: valores já usados no catálogo + padrões."""

    def merged(defaults, existing):
        values = list(defaults)
        for value in existing:
            if value and value not in values:
                values.append(value)
        return values

    connectors = set()
    for field in ("connector_a", "connector_b"):
        connectors.update(CableFamily.objects.values_list(field, flat=True))
        connectors.update(CableSpec.objects.values_list(field, flat=True))
    fiber_counts = set(CableFamily.objects.exclude(fiber_count=None).values_list("fiber_count", flat=True))
    fiber_counts.update(DEFAULT_FIBER_COUNTS)

    return {
        "connectors": merged(DEFAULT_CONNECTORS, sorted(c.upper() for c in connectors if c)),
        "fiber_counts": sorted(fiber_counts),
        "fiber_types": merged(DEFAULT_FIBER_TYPES, sorted(set(CableSpec.objects.values_list("fiber_type", flat=True)))),
        "colors": merged(DEFAULT_COLORS, sorted(set(CableSpec.objects.values_list("jacket_color", flat=True)))),
        "polarities": merged(DEFAULT_POLARITIES, sorted(set(CableSpec.objects.values_list("polarity", flat=True)))),
        "manufacturers": sorted(set(m for m in CableSpec.objects.values_list("manufacturer", flat=True) if m)),
        "copper_types": list(COPPER_TYPES),
        "shieldings": list(SHIELDINGS),
        "work_groups": [{"value": value, "label": label} for value, label in CableFamily.WORK_GROUP_CHOICES],
    }

"""Cadastro guiado de modelos de cabo a partir de texto.

Formato do texto: uma linha por modelo, campos separados por "|", nesta ordem:

    codigo | nome | meio | fibras | conector A | conector B | fabricante | part number | aliases

- Só `codigo` e `nome` são obrigatórios; os demais campos podem ficar vazios.
- `meio`: FIBRA/FIBER ou COBRE/COPPER (vazio = FIBRA).
- `aliases`: nomes alternativos separados por ";".
- Linhas em branco e linhas que começam com "#" são ignoradas.

Nada é gravado aqui: `parse_cable_import_text` só monta os rascunhos.
A gravação acontece em `finalize_cable_import`, em uma única transação, e
só para itens aprovados sem conflito.
"""

from django.db import transaction

from master_data.models import (
    CableAlias,
    CableFamily,
    CableImport,
    CableImportItem,
    CableSpec,
    normalize_alias_text,
)

COLUMNS = (
    "code",
    "name",
    "medium",
    "fiber_count",
    "connector_a",
    "connector_b",
    "manufacturer",
    "part_number",
    "aliases",
)

MEDIUM_ALIASES = {
    "": CableFamily.MEDIUM_FIBER,
    "FIBRA": CableFamily.MEDIUM_FIBER,
    "FIBER": CableFamily.MEDIUM_FIBER,
    "COBRE": CableFamily.MEDIUM_COPPER,
    "COPPER": CableFamily.MEDIUM_COPPER,
}

CONFLICT_FAMILY_CODE_EXISTS = "FAMILY_CODE_EXISTS"
CONFLICT_ALIAS_OTHER_FAMILY = "ALIAS_OTHER_FAMILY"
CONFLICT_PART_NUMBER_EXISTS = "PART_NUMBER_EXISTS"
CONFLICT_PART_NUMBER_IS_ALIAS = "PART_NUMBER_IS_ALIAS"
CONFLICT_SPEC_CODE_EXISTS = "SPEC_CODE_EXISTS"
CONFLICT_DUPLICATE_IN_IMPORT = "DUPLICATE_IN_IMPORT"
CONFLICT_PARSE_ERROR = "PARSE_ERROR"


class CableImportError(Exception):
    """Operação recusada pelo fluxo (ex: finalizar com conflitos pendentes)."""

    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details or []


def _conflict(code, message):
    return {"code": code, "message": message}


def _split_line(raw_line):
    parts = [part.strip() for part in raw_line.split("|")]
    if len(parts) > len(COLUMNS):
        raise ValueError(f"a linha tem {len(parts)} campos; o máximo é {len(COLUMNS)}")
    parts += [""] * (len(COLUMNS) - len(parts))
    return dict(zip(COLUMNS, parts))


def payload_from_line(raw_line):
    """Converte uma linha do texto em payload. Levanta ValueError com a
    mensagem de erro quando a linha não pode virar um cadastro."""
    fields = _split_line(raw_line)
    if not fields["code"]:
        raise ValueError("código é obrigatório")
    if not fields["name"]:
        raise ValueError("nome é obrigatório")

    medium_key = fields["medium"].upper()
    if medium_key not in MEDIUM_ALIASES:
        raise ValueError(f'meio inválido: "{fields["medium"]}" (use FIBRA ou COBRE)')

    fiber_count = None
    if fields["fiber_count"]:
        try:
            fiber_count = int(fields["fiber_count"])
        except ValueError as exc:
            raise ValueError(f'nº de fibras inválido: "{fields["fiber_count"]}"') from exc
        if fiber_count <= 0:
            raise ValueError("nº de fibras deve ser maior que zero")

    aliases = [alias.strip() for alias in fields["aliases"].split(";") if alias.strip()]

    return {
        "code": fields["code"],
        "name": fields["name"],
        "medium": MEDIUM_ALIASES[medium_key],
        "fiber_count": fiber_count,
        "connector_a": fields["connector_a"],
        "connector_b": fields["connector_b"],
        "manufacturer": fields["manufacturer"],
        "part_number": fields["part_number"],
        "aliases": aliases,
    }


def _partial_payload(raw_line):
    """Para linhas com erro: guarda código e nome (quando existirem) para o
    usuário corrigir na revisão, sem tentar validar o resto."""
    parts = [part.strip() for part in raw_line.split("|")]
    return {
        "code": parts[0] if len(parts) > 0 else "",
        "name": parts[1] if len(parts) > 1 else "",
        "medium": CableFamily.MEDIUM_FIBER,
        "fiber_count": None,
        "connector_a": "",
        "connector_b": "",
        "manufacturer": "",
        "part_number": "",
        "aliases": [],
    }


def parse_cable_import_text(text):
    """Separa o texto em linhas úteis. Devolve lista de dicts com
    `line_number`, `raw_line`, `payload` e `parse_error` (None se a linha
    estiver ok). Linhas com erro são mantidas para o usuário corrigir."""
    rows = []
    for line_number, raw in enumerate((text or "").splitlines(), start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        try:
            payload = payload_from_line(stripped)
            parse_error = None
        except ValueError as exc:
            payload = _partial_payload(stripped)
            parse_error = str(exc)
        rows.append(
            {
                "line_number": line_number,
                "raw_line": stripped,
                "payload": payload,
                "parse_error": parse_error,
            }
        )
    return rows


def detect_conflicts(payload, *, parse_error=None, import_items=None):
    """Lista os conflitos que impedem gravar este cadastro. `import_items` é
    uma lista de payloads dos OUTROS itens da mesma importação, usada para
    pegar duplicidade interna. Itens com erro de leitura não são gravados."""
    conflicts = []
    if parse_error:
        conflicts.append(_conflict(CONFLICT_PARSE_ERROR, parse_error))
        return conflicts

    code = (payload.get("code") or "").strip()
    part_number = (payload.get("part_number") or "").strip()
    aliases = [normalize_alias_text(alias) for alias in payload.get("aliases") or [] if alias.strip()]

    if CableFamily.objects.filter(code=code).exists():
        conflicts.append(_conflict(CONFLICT_FAMILY_CODE_EXISTS, f'Já existe uma família com o código "{code}".'))

    for alias in aliases:
        existing = CableAlias.objects.filter(normalized_alias=alias).select_related("cable_family").first()
        if existing is not None and existing.cable_family.code != code:
            conflicts.append(
                _conflict(
                    CONFLICT_ALIAS_OTHER_FAMILY,
                    f'O alias "{alias}" já aponta para a família "{existing.cable_family.code}".',
                )
            )

    if part_number:
        if CableSpec.objects.filter(part_number__iexact=part_number, active=True).exists():
            conflicts.append(
                _conflict(CONFLICT_PART_NUMBER_EXISTS, f'Já existe uma especificação ativa com o part number "{part_number}".')
            )
        if CableSpec.objects.filter(code=part_number).exists():
            conflicts.append(_conflict(CONFLICT_SPEC_CODE_EXISTS, f'Já existe uma especificação com o código "{part_number}".'))
        if CableAlias.objects.filter(normalized_alias=normalize_alias_text(part_number)).exists():
            conflicts.append(
                _conflict(CONFLICT_PART_NUMBER_IS_ALIAS, f'O part number "{part_number}" já é usado como alias de cabo.')
            )

    for other in import_items or []:
        if code and other.get("code") == code:
            conflicts.append(_conflict(CONFLICT_DUPLICATE_IN_IMPORT, f'O código "{code}" aparece em mais de uma linha.'))
            break
    for other in import_items or []:
        other_part = (other.get("part_number") or "").strip()
        if part_number and other_part and other_part.upper() == part_number.upper():
            conflicts.append(
                _conflict(CONFLICT_DUPLICATE_IN_IMPORT, f'O part number "{part_number}" aparece em mais de uma linha.')
            )
            break
    other_aliases = {
        normalize_alias_text(alias)
        for other in import_items or []
        if other.get("code") != code
        for alias in other.get("aliases") or []
    }
    if any(alias in other_aliases for alias in aliases):
        conflicts.append(_conflict(CONFLICT_DUPLICATE_IN_IMPORT, "Um alias deste cadastro aparece em outra linha da importação."))

    return conflicts


def _other_payloads(cable_import, exclude_item_id=None):
    """Payloads dos outros itens da importação, exceto rejeitados."""
    return [
        item.payload
        for item in cable_import.items.exclude(pk=exclude_item_id).exclude(status=CableImportItem.STATUS_REJECTED)
    ]


def _required_fields_error(payload):
    if not (payload.get("code") or "").strip():
        return "código é obrigatório"
    if not (payload.get("name") or "").strip():
        return "nome é obrigatório"
    return None


def recompute_item_conflicts(item):
    """Recalcula e salva os conflitos de um item depois de uma edição. Usa os
    outros itens da mesma importação (exceto rejeitados) para duplicidade."""
    item.conflicts = detect_conflicts(
        item.payload,
        parse_error=_required_fields_error(item.payload),
        import_items=_other_payloads(item.cable_import, exclude_item_id=item.pk),
    )
    item.save(update_fields=("conflicts", "updated_at"))
    return item


def create_cable_import(*, text, title, user):
    """Cria a importação e um item por linha do texto, já com conflitos."""
    cable_import = CableImport.objects.create(
        title=(title or "").strip()[:200],
        source_text=text or "",
        created_by=user,
        updated_by=user,
    )
    rows = parse_cable_import_text(text)
    for row in rows:
        payload = row["payload"]
        others = [other["payload"] for other in rows if other is not row and not other["parse_error"]]
        CableImportItem.objects.create(
            cable_import=cable_import,
            line_number=row["line_number"],
            raw_line=row["raw_line"],
            payload=payload,
            conflicts=detect_conflicts(payload, parse_error=row["parse_error"], import_items=others),
            created_by=user,
            updated_by=user,
        )

    cable_import.total_models = len(rows)
    cable_import.save(update_fields=("total_models", "updated_at"))
    return cable_import


def _refresh_import_status(cable_import):
    remaining = cable_import.items.filter(
        status__in=(CableImportItem.STATUS_PENDING, CableImportItem.STATUS_APPROVED)
    ).exists()
    cable_import.status = CableImport.STATUS_DRAFT if remaining else CableImport.STATUS_FINALIZED
    cable_import.total_created = cable_import.items.filter(status=CableImportItem.STATUS_CREATED).count()
    cable_import.save(update_fields=("status", "total_created", "updated_at"))


def _create_family_from_payload(payload, user):
    family = CableFamily.objects.create(
        code=payload["code"],
        name=payload["name"],
        medium=payload["medium"],
        fiber_count=payload["fiber_count"],
        connector_a=payload["connector_a"],
        connector_b=payload["connector_b"],
        description="Criada pelo fluxo guiado de cabos.",
        active=True,
        created_by=user,
        updated_by=user,
    )
    for alias in payload["aliases"]:
        CableAlias.objects.create(
            cable_family=family,
            alias=alias,
            alias_type="NAME_VARIATION",
            description="Criado pelo fluxo guiado de cabos.",
            active=True,
            created_by=user,
            updated_by=user,
        )
    if payload["part_number"]:
        CableSpec.objects.create(
            cable_family=family,
            code=payload["part_number"],
            name=payload["name"],
            manufacturer=payload["manufacturer"],
            part_number=payload["part_number"],
            connector_a=payload["connector_a"],
            connector_b=payload["connector_b"],
            fiber_count=payload["fiber_count"],
            description="Criada pelo fluxo guiado de cabos.",
            active=True,
            created_by=user,
            updated_by=user,
        )
    return family


def finalize_cable_import(cable_import, user):
    """Grava todos os itens APROVADOS. Tudo ou nada: se algum item aprovado
    tiver conflito no momento da gravação, nada é criado e a função levanta
    CableImportError com a lista de itens bloqueados."""
    approved = list(cable_import.items.filter(status=CableImportItem.STATUS_APPROVED).order_by("line_number", "pk"))
    if not approved:
        raise CableImportError("Nenhum item aprovado para cadastrar.")

    with transaction.atomic():
        blocked = []
        for item in approved:
            conflicts = detect_conflicts(
                item.payload,
                import_items=[other.payload for other in approved if other.pk != item.pk],
            )
            if conflicts:
                blocked.append({"line_number": item.line_number, "code": item.payload.get("code"), "conflicts": conflicts})
        if blocked:
            raise CableImportError("Há itens aprovados com conflito. Corrija ou rejeite antes de cadastrar.", blocked)

        for item in approved:
            family = _create_family_from_payload(item.payload, user)
            item.created_family = family
            item.status = CableImportItem.STATUS_CREATED
            item.updated_by = user
            item.save(update_fields=("created_family", "status", "updated_by", "updated_at"))

        _refresh_import_status(cable_import)
    return cable_import

"""Normalização final de um item de SOW já extraído (parser
determinístico + merge com IA, ver service.py) — resolve TODOS os
códigos contra o banco. A IA NUNCA é fonte de verdade: mesmo que o parser
determinístico ou a IA proponham um código, se ele não existir (ou não
estiver ativo) no banco, o campo vira null e um warning é registrado —
nunca aceito de olhos fechados (ver docstring do pacote pai)."""

from decimal import Decimal

# Warnings que sempre forçam requires_review=True — ausência de rede/
# workstream/path/metragem NÃO é crítica (podem continuar null, ver
# pedido original), só o resto é.
CRITICAL_WARNING_CODES = {
    "UNKNOWN_CABLE_FAMILY",
    "SPEC_FAMILY_MISMATCH",
    "INVALID_QUANTITY",
    "QUANTITY_NOT_DETECTED",
    "PARSER_AI_CONFLICT",
}


def build_warning(code, field, message, critical=None):
    return {
        "code": code,
        "field": field,
        "message": message,
        "critical": critical if critical is not None else code in CRITICAL_WARNING_CODES,
    }


def normalize_parsed_item(draft):
    """`draft` é um dict com chaves de CÓDIGO/valor primitivo (nunca
    instâncias de model) — ver master_data.services.sow_parser.service
    para como ele é montado a partir do parser determinístico + IA.
    Retorna um dict pronto para criar um SowParsedItem: instâncias de
    model já resolvidas (ou None), warnings consolidados,
    confidence_score e requires_review calculados. Nunca cria nenhum
    registro de Master Data — só resolve o que já existe."""

    from master_data.models import CableFamily, CableSpec, Network, Path, Workstream

    warnings = list(draft.get("warnings") or [])
    metadata = dict(draft.get("normalization_metadata") or {})

    item_type = (draft.get("item_type") or "CABLE").upper()

    cable_family = None
    cable_family_code = draft.get("cable_family_code")
    if cable_family_code:
        cable_family = CableFamily.objects.filter(code=cable_family_code, active=True).first()
        if cable_family is None:
            warnings.append(
                build_warning(
                    "UNKNOWN_CABLE_FAMILY",
                    "cable_family",
                    f'Família de cabo "{cable_family_code}" não encontrada nos Cadastros Mestres.',
                )
            )
    elif item_type == "CABLE":
        warnings.append(
            build_warning("UNKNOWN_CABLE_FAMILY", "cable_family", "Família de cabo não pôde ser identificada.")
        )

    cable_spec = None
    cable_spec_code = draft.get("cable_spec_code")
    if cable_spec_code:
        cable_spec = (
            CableSpec.objects.filter(code=cable_spec_code, active=True).select_related("cable_family").first()
        )
        if cable_spec is None:
            warnings.append(
                build_warning(
                    "UNKNOWN_CABLE_SPEC",
                    "cable_spec",
                    f'Especificação "{cable_spec_code}" não encontrada nos Cadastros Mestres.',
                    critical=False,
                )
            )

    if cable_spec is not None:
        if cable_family is None:
            cable_family = cable_spec.cable_family
            metadata["cable_family"] = {"source": "cable_spec", "derived": True}
        elif cable_spec.cable_family_id != cable_family.pk:
            warnings.append(
                build_warning(
                    "SPEC_FAMILY_MISMATCH",
                    "cable_spec",
                    f'Especificação "{cable_spec.code}" pertence à família "{cable_spec.cable_family.code}", '
                    f'diferente da família resolvida ("{cable_family.code}").',
                )
            )
            cable_spec = None

    network = None
    network_code = draft.get("network_code")
    if network_code:
        network = Network.objects.filter(code=network_code, active=True).first()
        if network is None:
            warnings.append(
                build_warning("UNKNOWN_NETWORK", "network", f'Rede "{network_code}" não encontrada.', critical=False)
            )

    workstream = None
    workstream_code = draft.get("workstream_code")
    if workstream_code:
        workstream = Workstream.objects.filter(code=workstream_code, active=True).first()
        if workstream is None:
            warnings.append(
                build_warning(
                    "UNKNOWN_WORKSTREAM",
                    "workstream",
                    f'Workstream "{workstream_code}" não encontrado.',
                    critical=False,
                )
            )

    paths = []
    for path_code in draft.get("path_codes") or []:
        if not path_code:
            continue
        path = Path.objects.filter(code=path_code, active=True).first()
        if path is not None:
            if path not in paths:
                paths.append(path)
        else:
            warnings.append(
                build_warning("UNKNOWN_PATH", "paths", f'Rota "{path_code}" não encontrada.', critical=False)
            )

    medium = (draft.get("medium") or "").upper()
    if not medium and cable_family is not None and cable_family.medium:
        medium = cable_family.medium
        metadata["medium"] = {"source": "cable_family", "derived": True}

    color = (draft.get("color") or "").upper()

    quantity = draft.get("quantity")
    if quantity is None or quantity <= 0:
        warnings.append(
            build_warning(
                "INVALID_QUANTITY" if quantity is not None else "QUANTITY_NOT_DETECTED",
                "quantity",
                "Quantidade não encontrada ou inválida no texto do escopo.",
            )
        )
        quantity = None

    length_m = draft.get("length_m")
    length_type = draft.get("length_type")
    if length_m is None:
        warnings.append(build_warning("MISSING_LENGTH", "length_m", "Metragem não encontrada no escopo.", critical=False))
    elif not length_type:
        length_type = "UNKNOWN"

    for extra_warning in draft.get("conflict_warnings") or []:
        warnings.append(extra_warning)

    has_critical = any(w.get("critical") for w in warnings)

    # Confidence sempre calculado aqui (não pelo autorrelato da IA/parser)
    # — garante um critério ÚNICO e determinístico, igual em modo
    # DETERMINISTIC_ONLY ou com IA (o valor bruto que a IA propôs continua
    # disponível em ai_raw_payload, só não é usado como score final).
    confidence_score = Decimal("1.00")
    if item_type == "CABLE" and cable_family is None:
        confidence_score -= Decimal("0.50")
    if quantity is None:
        confidence_score -= Decimal("0.30")
    if length_m is None:
        confidence_score -= Decimal("0.10")
    if has_critical and confidence_score > Decimal("0.79"):
        confidence_score = Decimal("0.79")
    confidence_score = max(Decimal("0"), min(Decimal("1"), confidence_score)).quantize(Decimal("0.01"))

    requires_review = (
        confidence_score < Decimal("0.80") or (item_type == "CABLE" and cable_family is None) or has_critical
    )

    return {
        "item_type": item_type,
        "cable_family": cable_family,
        "cable_spec": cable_spec,
        "network": network,
        "workstream": workstream,
        "paths": paths,
        "quantity": quantity,
        "unit": draft.get("unit") or "",
        "length_type": length_type or "",
        "length_m": length_m,
        "medium": medium,
        "preterminated": draft.get("preterminated"),
        "color": color,
        "fiber_count": draft.get("fiber_count"),
        "confidence_score": confidence_score,
        "requires_review": requires_review,
        "warnings": warnings,
        "normalization_metadata": metadata,
    }

"""Orquestrador do módulo de ingestão de SOW — o único lugar que decide a
ordem das etapas (parser determinístico -> IA opcional -> merge -> preview
armazenado como SowParsedItem) e as regras de aprovação/finalização
(SowParsedItem aprovado -> ScopeItem definitivo). Nunca cria
GeneratedTask, nunca altera TaskTemplate, nunca cria Master Data novo (ver
docstring de SowImport em master_data/models.py) — isso é garantido aqui
E reforçado pelo normalizer (que só resolve códigos já existentes)."""

import logging
import os

from django.utils import timezone

from .ai_parser import AiSowParserError, get_ai_sow_parser
from .deterministic_parser import PARSER_VERSION, extract_sow_lines, parse_line, resolve_cable_family_by_text, resolve_part_number
from .normalizer import build_warning, normalize_parsed_item

logger = logging.getLogger("master_data.sow_import")

# Campos comparados no merge determinístico × IA — quando os dois lados
# resolvem um valor E divergem, o valor determinístico é preservado e um
# warning PARSER_AI_CONFLICT é registrado (nunca a IA sobrescreve
# silenciosamente, ver pedido original).
_MERGEABLE_FIELDS = (
    "cable_family_code",
    "cable_spec_code",
    "network_code",
    "workstream_code",
    "quantity",
    "unit",
    "length_type",
    "length_m",
    "medium",
    "preterminated",
    "color",
    "fiber_count",
)


class SowProcessingError(Exception):
    """Erro ao processar o texto do SOW (ex: texto vazio, já processado)
    — vira status FAILED + error_message quando ocorre dentro de
    `_run_parsing`; levantado diretamente por `process_sow_import` quando
    a ação em si é inválida (ex: chamar process em um import já
    processado)."""


class UnsupportedSourceTypeError(Exception):
    """O arquivo enviado não pôde ter seu texto extraído automaticamente
    nesta versão (ver extract_text_from_file)."""


class ApprovalBlockedError(Exception):
    """Bloqueio de aprovação/rejeição/reprocessamento de um
    SowParsedItem (ex: quantity<=0, família não resolvida para item
    CABLE, item já aprovado)."""


class ReprocessBlockedError(Exception):
    """Reprocessamento completo do SowImport bloqueado porque já existe
    pelo menos um item APROVADO (evita reprocessamento destrutivo — não
    há versionamento completo nesta primeira versão, ver limitações
    conhecidas no relatório final)."""


class FinalizeBlockedError(Exception):
    """Finalização bloqueada porque ainda há item PENDING/NEEDS_REVIEW."""


def extract_text_from_file(uploaded_file):
    """Texto do arquivo enviado: PDF com texto selecionável (via pypdf) ou
    texto UTF-8 simples. Levanta UnsupportedSourceTypeError com mensagem clara
    para DOCX, imagem ou PDF escaneado."""
    try:
        raw = uploaded_file.read()
    finally:
        uploaded_file.seek(0)
    if raw[:5] == b"%PDF-":
        return _extract_pdf_text(raw)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        raise UnsupportedSourceTypeError(
            "Não foi possível extrair texto deste arquivo automaticamente (só texto simples e PDF "
            "são lidos; DOCX/imagem ainda não). Cole o texto do SOW diretamente no campo de texto."
        )


def _extract_pdf_text(raw):
    import io

    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:  # arquivo enviado pelo usuário: qualquer PDF corrompido vira mensagem clara
        raise UnsupportedSourceTypeError(f"Não foi possível ler o PDF: {exc}")
    if not text.strip():
        raise UnsupportedSourceTypeError(
            "O PDF não tem texto selecionável (provavelmente é uma imagem escaneada). Cole o texto do SOW diretamente."
        )
    return text


def build_master_data_context():
    """Contexto de Master Data ATIVO enviado à IA — só as entidades
    relevantes para o schema do parser (nunca a tabela inteira, nunca nada
    fora do necessário, ver pedido original 'Não enviar tabelas
    irrelevantes')."""
    from master_data.models import CableAlias, CableFamily, CableSpec, Network, Path, Workstream

    return {
        "cable_families": [
            {"code": f.code, "name": f.name, "medium": f.medium}
            for f in CableFamily.objects.filter(active=True).order_by("code")
        ],
        "cable_aliases": [
            {"alias": a.alias, "cable_family_code": a.cable_family.code}
            for a in CableAlias.objects.filter(active=True).select_related("cable_family").order_by("alias")
        ],
        "cable_specs": [
            {"code": s.code, "part_number": s.part_number, "cable_family_code": s.cable_family.code}
            for s in CableSpec.objects.filter(active=True).select_related("cable_family").order_by("code")
        ],
        "networks": [{"code": n.code, "name": n.name} for n in Network.objects.filter(active=True).order_by("code")],
        "workstreams": [
            {"code": w.code, "name": w.name} for w in Workstream.objects.filter(active=True).order_by("code")
        ],
        "paths": [{"code": p.code, "name": p.name} for p in Path.objects.filter(active=True).order_by("code")],
    }


def _resolve_deterministic_cable(candidate_text):
    if not candidate_text:
        return None, None
    spec = resolve_part_number(candidate_text)
    if spec is not None:
        return spec.cable_family.code, spec.code
    family = resolve_cable_family_by_text(candidate_text)
    return (family.code if family else None), None


def _merge_draft(det_draft, ai_item):
    """Funde o draft determinístico (`det_draft`, de deterministic_parser.
    parse_line) com o item correspondente da IA (`ai_item`, já validado
    pelo schema, ou None se a IA não foi usada/falhou). Retorna
    (merged_dict_pronto_para_normalizer, payload_bruto_da_ia_para_auditoria).
    Regra central: quando os dois lados resolvem um valor e divergem, o
    valor DETERMINÍSTICO é mantido e um warning PARSER_AI_CONFLICT é
    registrado — a IA nunca sobrescreve silenciosamente."""

    candidate_text = det_draft.get("candidate_text") or ""
    family_code, spec_code = _resolve_deterministic_cable(candidate_text)

    merged = {
        "item_type": det_draft.get("item_type") or "CABLE",
        "cable_family_code": family_code,
        "cable_spec_code": spec_code,
        "network_code": None,
        "workstream_code": None,
        "path_codes": [det_draft["path_code"]] if det_draft.get("path_code") else [],
        "quantity": det_draft.get("quantity"),
        "unit": det_draft.get("unit") or "",
        "length_type": det_draft.get("length_type"),
        "length_m": det_draft.get("length_m"),
        "medium": det_draft.get("medium_guess") or "",
        "preterminated": det_draft.get("preterminated"),
        "color": det_draft.get("color"),
        "fiber_count": det_draft.get("fiber_count"),
        "warnings": [],
        "conflict_warnings": [],
        "normalization_metadata": {
            "deterministic": {"candidate_text": candidate_text},
            "sow_context": {
                key: value
                for key, value in {
                    **(det_draft.get("sow_context") or {}),
                    "origin": det_draft.get("origin"),
                    "destination": det_draft.get("destination"),
                }.items()
                if value
            },
        },
    }

    if ai_item is None:
        return merged, {}

    for field in _MERGEABLE_FIELDS:
        det_value = merged.get(field)
        ai_value = ai_item.get(field)
        if ai_value in (None, ""):
            continue
        if det_value in (None, ""):
            merged[field] = ai_value
            merged["normalization_metadata"].setdefault("ai_filled", []).append(field)
            continue
        equal = (
            str(det_value).strip().casefold() == str(ai_value).strip().casefold()
            if isinstance(det_value, str) or isinstance(ai_value, str)
            else det_value == ai_value
        )
        if not equal:
            merged["conflict_warnings"].append(
                build_warning(
                    "PARSER_AI_CONFLICT",
                    field,
                    f"Parser determinístico e IA divergem em '{field}' — mantido o valor "
                    f"determinístico ({det_value!r}); IA propôs {ai_value!r}.",
                )
            )
            merged["normalization_metadata"].setdefault("conflicts", {})[field] = {
                "deterministic_value": det_value,
                "ai_value": ai_value,
            }

    for code in ai_item.get("paths") or []:
        if code and code not in merged["path_codes"]:
            merged["path_codes"].append(code)

    return merged, dict(ai_item)


def _draft_from_line(line, context):
    """parse_line + contexto do extrator. Nos modelos antigos a linha é uma
    versão canônica montada pelo extrator; o item guarda a linha original do
    SOW (`raw`) e a origem/destino já separados por ele."""
    context = dict(context)
    draft = parse_line(line)
    raw = context.pop("raw", None)
    if raw:
        draft["raw_text"] = raw
    for key in ("origin", "destination"):
        if context.get(key):
            draft[key] = context.pop(key)
    draft["sow_context"] = context
    return draft


def _run_parsing(sow_import):
    from master_data.models import SowParsedItem

    sow_import.status = "PROCESSING"
    sow_import.processing_started_at = timezone.now()
    sow_import.error_message = ""
    sow_import.save(update_fields=("status", "processing_started_at", "error_message", "updated_at"))

    try:
        lines = extract_sow_lines(sow_import.source_text)
        if not lines:
            raise SowProcessingError(
                "Nenhuma ligação de cabo foi encontrada neste SOW (ex.: escopo só de instalação de "
                "bridges/racks). Se houver cabos, cole as linhas de cabeamento no campo de texto."
            )

        deterministic_drafts = [_draft_from_line(line, context) for line, context in lines]

        ai_items = None
        ai_provider_label = ""
        ai_model_label = ""
        ai_mode = "DETERMINISTIC_ONLY"
        ai_error_code = None
        ai_parser = get_ai_sow_parser()
        if ai_parser is not None:
            ai_provider_label = os.getenv("AI_PROVIDER", "openrouter").strip().lower()
            try:
                master_data_context = build_master_data_context()
                ai_items, ai_meta = ai_parser.parse(sow_import.source_text, deterministic_drafts, master_data_context)
            except AiSowParserError as exc:
                ai_error_code = getattr(exc, "code", None) or "OPENROUTER_UPSTREAM_ERROR"
                logger.warning(
                    "SOW %s: IA indisponível (%s), seguindo em modo determinístico (%s)",
                    sow_import.code,
                    ai_error_code,
                    exc,
                )
                ai_items = None
            else:
                if len(ai_items) != len(deterministic_drafts):
                    logger.warning(
                        "SOW %s: IA devolveu %d item(ns), esperado %d (um por linha) — descartando resposta "
                        "da IA para este import e seguindo em modo determinístico.",
                        sow_import.code,
                        len(ai_items),
                        len(deterministic_drafts),
                    )
                    ai_items = None
                else:
                    ai_mode = "HYBRID_AI"
                    ai_model_label = ai_meta["resolved_model"]

        created_items = []
        total_warnings = 0
        for index, det_draft in enumerate(deterministic_drafts, start=1):
            ai_item = ai_items[index - 1] if ai_items is not None else None
            merged, ai_raw_payload = _merge_draft(det_draft, ai_item)
            normalized = normalize_parsed_item(merged)
            if ai_error_code:
                normalized["warnings"].append(
                    build_warning(
                        "AI_UNAVAILABLE",
                        "ai",
                        f"IA configurada mas indisponível ({ai_error_code}) — item processado em modo determinístico.",
                        critical=False,
                    )
                )

            item = SowParsedItem.objects.create(
                sow_import=sow_import,
                sequence=index,
                raw_text=det_draft["raw_text"],
                item_type=normalized["item_type"],
                suggested_cable_family=normalized["cable_family"],
                suggested_cable_spec=normalized["cable_spec"],
                suggested_network=normalized["network"],
                suggested_workstream=normalized["workstream"],
                quantity=normalized["quantity"],
                unit=normalized["unit"],
                length_type=normalized["length_type"],
                length_m=normalized["length_m"],
                medium=normalized["medium"],
                preterminated=normalized["preterminated"],
                color=normalized["color"],
                fiber_count=normalized["fiber_count"],
                confidence_score=normalized["confidence_score"],
                requires_review=normalized["requires_review"],
                warnings=normalized["warnings"],
                ai_raw_payload=ai_raw_payload or {},
                normalization_metadata=normalized["normalization_metadata"],
            )
            if normalized["paths"]:
                item.suggested_paths.set(normalized["paths"])
            created_items.append(item)
            total_warnings += len(normalized["warnings"])

        sow_import.status = "READY_FOR_REVIEW"
        sow_import.parser_version = PARSER_VERSION
        sow_import.ai_provider = ai_provider_label
        sow_import.ai_model = ai_model_label
        sow_import.ai_mode = ai_mode
        sow_import.total_items_detected = len(created_items)
        sow_import.total_items_approved = 0
        sow_import.total_items_rejected = 0
        sow_import.total_warnings = total_warnings
        sow_import.processing_finished_at = timezone.now()
        sow_import.error_message = ""
        sow_import.save()
        return created_items
    except Exception as exc:  # noqa: BLE001 - nunca deixar o import preso em PROCESSING
        logger.exception("SOW %s: falha ao processar", sow_import.code)
        sow_import.status = "FAILED"
        sow_import.error_message = str(exc)
        sow_import.processing_finished_at = timezone.now()
        sow_import.save(update_fields=("status", "error_message", "processing_finished_at", "updated_at"))
        return []


def process_sow_import(sow_import):
    """Primeira execução do parser sobre `sow_import.source_text`. Só
    permitida uma vez (ver reprocess_sow_import para rodar de novo)."""
    if sow_import.parsed_items.exists():
        raise SowProcessingError("Esta importação já foi processada — use 'Reprocessar' para executar novamente.")
    if not (sow_import.source_text or "").strip():
        sow_import.status = "FAILED"
        sow_import.error_message = "Nenhum texto para processar — informe o texto do SOW."
        sow_import.save(update_fields=("status", "error_message", "updated_at"))
        return []
    return _run_parsing(sow_import)


def reprocess_sow_import(sow_import):
    """Reexecuta o parser do zero para este import — bloqueado (sem
    versionamento nesta primeira versão) quando já existe item APROVADO,
    para nunca apagar histórico de aprovação."""
    if sow_import.parsed_items.filter(review_status="APPROVED").exists():
        raise ReprocessBlockedError(
            "Esta importação já tem item(ns) aprovado(s) — reprocessamento completo bloqueado nesta versão "
            "(evita apagar histórico de aprovação/ScopeItems já criados)."
        )
    sow_import.parsed_items.all().delete()
    return _run_parsing(sow_import)


def reprocess_sow_parsed_item(item):
    """Reprocessa só este item (não o import inteiro) — preserva id/
    sequence, atualiza os campos sugeridos in-place e guarda o estado
    anterior em normalization_metadata['reprocess_history']."""
    if item.approved_scope_item_id:
        raise ApprovalBlockedError("Este item já foi aprovado — não pode ser reprocessado.")

    previous_snapshot = {
        "cable_family_code": item.suggested_cable_family.code if item.suggested_cable_family_id else None,
        "cable_spec_code": item.suggested_cable_spec.code if item.suggested_cable_spec_id else None,
        "quantity": item.quantity,
        "length_m": str(item.length_m) if item.length_m is not None else None,
        "confidence_score": str(item.confidence_score) if item.confidence_score is not None else None,
        "warnings": item.warnings,
    }

    det_draft = parse_line(item.raw_text)
    ai_item = None
    ai_error_code = None
    ai_parser = get_ai_sow_parser()
    if ai_parser is not None:
        try:
            master_data_context = build_master_data_context()
            ai_items, _ai_meta = ai_parser.parse(item.raw_text, [det_draft], master_data_context)
            if ai_items:
                ai_item = ai_items[0]
        except AiSowParserError as exc:
            ai_error_code = getattr(exc, "code", None) or "OPENROUTER_UPSTREAM_ERROR"
            logger.warning("Reprocessamento do SowParsedItem %s: IA indisponível (%s)", item.pk, exc)

    merged, ai_raw_payload = _merge_draft(det_draft, ai_item)
    normalized = normalize_parsed_item(merged)
    if ai_error_code:
        normalized["warnings"].append(
            build_warning(
                "AI_UNAVAILABLE",
                "ai",
                f"IA configurada mas indisponível ({ai_error_code}) — item processado em modo determinístico.",
                critical=False,
            )
        )

    history = list((item.normalization_metadata or {}).get("reprocess_history") or [])
    history.append({"reprocessed_at": timezone.now().isoformat(), "previous": previous_snapshot})
    normalized["normalization_metadata"]["reprocess_history"] = history

    item.item_type = normalized["item_type"]
    item.suggested_cable_family = normalized["cable_family"]
    item.suggested_cable_spec = normalized["cable_spec"]
    item.suggested_network = normalized["network"]
    item.suggested_workstream = normalized["workstream"]
    item.quantity = normalized["quantity"]
    item.unit = normalized["unit"]
    item.length_type = normalized["length_type"]
    item.length_m = normalized["length_m"]
    item.medium = normalized["medium"]
    item.preterminated = normalized["preterminated"]
    item.color = normalized["color"]
    item.fiber_count = normalized["fiber_count"]
    item.confidence_score = normalized["confidence_score"]
    item.requires_review = normalized["requires_review"]
    item.warnings = normalized["warnings"]
    item.ai_raw_payload = ai_raw_payload or {}
    item.normalization_metadata = normalized["normalization_metadata"]
    item.review_status = "PENDING"
    item.save()
    item.suggested_paths.set(normalized["paths"])
    return item


def _refresh_sow_import_counters(sow_import):
    items = sow_import.parsed_items.filter(active=True)
    approved = items.filter(review_status="APPROVED").count()
    rejected = items.filter(review_status="REJECTED").count()
    total_warnings = sum(len(i.warnings or []) for i in items)

    sow_import.total_items_approved = approved
    sow_import.total_items_rejected = rejected
    sow_import.total_warnings = total_warnings
    update_fields = ["total_items_approved", "total_items_rejected", "total_warnings", "updated_at"]
    if sow_import.status == "READY_FOR_REVIEW" and (approved or rejected):
        sow_import.status = "PARTIALLY_REVIEWED"
        update_fields.append("status")
    sow_import.save(update_fields=update_fields)


def approve_sow_parsed_item(item, user):
    """Cria o ScopeItem definitivo a partir deste SowParsedItem —
    idempotente (chamar de novo devolve o mesmo ScopeItem, nunca cria um
    segundo, ver approved_scope_item)."""
    if item.approved_scope_item_id:
        return item.approved_scope_item

    if item.item_type == "CABLE":
        if not item.quantity or item.quantity <= 0:
            raise ApprovalBlockedError("Quantidade inválida — não é possível aprovar este item.")
        if item.suggested_cable_family_id is None:
            raise ApprovalBlockedError("Família de cabo não resolvida — não é possível aprovar este item.")

    from master_data.models import ScopeItem, ScopeItemPath
    from master_data.services.scope_item_normalizer import normalize_scope_item

    # Preserva o(s) path(s) detectados pelo parser — nunca descartados na
    # conversão (ver pedido original): 1 path só -> ScopeItem.path (campo
    # singular de compatibilidade, é o que a grade de Itens de Escopo
    # mostra como "Rota"); 2+ paths -> expansion_mode=PATH, para que
    # master_data.services.task_generator expanda os steps repetíveis um
    # por Path quando as tarefas forem geradas (mesmo mecanismo já
    # validado manualmente para FIB-8F-LCLC com PATH-A/PATH-B).
    paths = list(item.suggested_paths.all())

    scope_item = ScopeItem(
        raw_text=item.raw_text,
        item_type=item.item_type or "CABLE",
        cable_family=item.suggested_cable_family,
        cable_spec=item.suggested_cable_spec,
        network=item.suggested_network,
        workstream=item.suggested_workstream,
        path=paths[0] if len(paths) == 1 else None,
        expansion_mode="PATH" if len(paths) >= 2 else "NONE",
        quantity=item.quantity or 1,
        unit=item.unit,
        length_type=item.length_type,
        length_m=item.length_m,
        medium=item.medium,
        preterminated=item.preterminated,
        color=item.color,
        fiber_count=item.fiber_count,
        source_type="SOW",
        source_reference=item.sow_import.code,
        confidence_score=item.confidence_score,
        requires_review=False,
        normalization_metadata={"sow_parsed_item_id": item.pk, **(item.normalization_metadata or {})},
        created_by=user,
        updated_by=user,
    )
    normalize_scope_item(scope_item)
    scope_item.save()

    for index, path in enumerate(paths):
        ScopeItemPath.objects.create(scope_item=scope_item, path=path, sequence=index, created_by=user, updated_by=user)

    item.approved_scope_item = scope_item
    item.review_status = "APPROVED"
    item.reviewed_by = user
    item.reviewed_at = timezone.now()
    item.save(update_fields=("approved_scope_item", "review_status", "reviewed_by", "reviewed_at", "updated_at"))

    _refresh_sow_import_counters(item.sow_import)
    return scope_item


def reject_sow_parsed_item(item, user):
    if item.approved_scope_item_id:
        raise ApprovalBlockedError("Este item já foi aprovado — não pode ser rejeitado.")
    item.review_status = "REJECTED"
    item.reviewed_by = user
    item.reviewed_at = timezone.now()
    item.save(update_fields=("review_status", "reviewed_by", "reviewed_at", "updated_at"))
    _refresh_sow_import_counters(item.sow_import)
    return item


def approve_selected(sow_import, item_ids, user):
    results = {"approved": [], "errors": []}
    for item in sow_import.parsed_items.filter(pk__in=item_ids, active=True):
        try:
            scope_item = approve_sow_parsed_item(item, user)
            results["approved"].append({"item_id": item.pk, "scope_item_code": scope_item.code})
        except ApprovalBlockedError as exc:
            results["errors"].append({"item_id": item.pk, "detail": str(exc)})
    return results


def reject_selected(sow_import, item_ids, user):
    results = {"rejected": [], "errors": []}
    for item in sow_import.parsed_items.filter(pk__in=item_ids, active=True):
        try:
            reject_sow_parsed_item(item, user)
            results["rejected"].append(item.pk)
        except ApprovalBlockedError as exc:
            results["errors"].append({"item_id": item.pk, "detail": str(exc)})
    return results


def finalize_sow_import(sow_import, user):
    """Marca SowImport.status=APPROVED — só permitido quando NENHUM item
    ativo está PENDING/NEEDS_REVIEW (todos precisam estar APPROVED ou
    REJECTED antes)."""
    pending = sow_import.parsed_items.filter(active=True, review_status__in=("PENDING", "NEEDS_REVIEW"))
    pending_count = pending.count()
    if pending_count:
        raise FinalizeBlockedError(
            f"Ainda há {pending_count} item(ns) pendente(s) de revisão — aprove ou rejeite todos antes de finalizar."
        )
    _refresh_sow_import_counters(sow_import)
    sow_import.status = "APPROVED"
    sow_import.updated_by = user
    sow_import.save(update_fields=("status", "updated_by", "updated_at"))
    return sow_import

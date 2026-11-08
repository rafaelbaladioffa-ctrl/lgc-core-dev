"""Executa o pipeline REAL do parser de SOW (determinístico + IA) contra
um SOW de exemplo — direto do backend/container, sem criar nenhum
ScopeItem e sem depender da UI/login externo (ver pedido original, bloco
10). Usa exatamente o mesmo código do fluxo normal
(deterministic_parser -> OpenRouter -> merge -> normalizer); a única
diferença é que o resultado é só impresso, nunca persistido como
SowParsedItem.

Uso:
    python manage.py test_sow_ai

Nunca imprime AI_API_KEY."""

import os

from django.core.management.base import BaseCommand

from master_data.services.sow_parser.ai_parser import AiSowParserError, get_ai_sow_parser
from master_data.services.sow_parser.deterministic_parser import parse_line, split_sow_text_into_lines
from master_data.services.sow_parser.normalizer import normalize_parsed_item
from master_data.services.sow_parser.service import _merge_draft, build_master_data_context

SAMPLE_SOW = (
    "2x 72F OS2 Yellow MPO/MPO, MPO-B, 0072X6P64 with 50m\n"
    "4x 2F robust fibers up to 60m\n"
    "10x CAT6 UTP up to 60m"
)


class Command(BaseCommand):
    help = "Roda o pipeline real do parser de SOW (determinístico + IA) contra um SOW de exemplo, sem criar ScopeItems."

    def handle(self, *args, **options):
        configured_model = os.getenv("AI_MODEL", "").strip()
        self.stdout.write(f"configured_model: {configured_model or '(vazio)'}")

        lines = split_sow_text_into_lines(SAMPLE_SOW)
        deterministic_drafts = [parse_line(line) for line in lines]

        ai_items = None
        ai_meta = None
        ai_error = None
        ai_parser = get_ai_sow_parser()
        if ai_parser is not None:
            try:
                master_data_context = build_master_data_context()
                ai_items, ai_meta = ai_parser.parse(SAMPLE_SOW, deterministic_drafts, master_data_context)
            except AiSowParserError as exc:
                ai_error = exc
                ai_items = None
            else:
                if len(ai_items) != len(deterministic_drafts):
                    self.stdout.write(
                        self.style.WARNING(
                            f"IA devolveu {len(ai_items)} item(ns), esperado {len(deterministic_drafts)} — "
                            "descartando resposta da IA."
                        )
                    )
                    ai_items = None
                    ai_meta = None

        parser_mode = "HYBRID_AI" if ai_items is not None else "DETERMINISTIC_ONLY"

        if ai_meta:
            self.stdout.write(f"resolved_model: {ai_meta['resolved_model']}")
            self.stdout.write(f"AI latency: {ai_meta['latency_ms']}ms (retries={ai_meta['retries']})")

        self.stdout.write("")
        for index, det_draft in enumerate(deterministic_drafts, start=1):
            ai_item = ai_items[index - 1] if ai_items is not None else None
            merged, _raw_payload = _merge_draft(det_draft, ai_item)
            normalized = normalize_parsed_item(merged)

            self.stdout.write(f"ITEM {index}")
            self.stdout.write(f"  raw_text: {det_draft['raw_text']}")
            self.stdout.write(f"  family: {normalized['cable_family'].code if normalized['cable_family'] else None}")
            self.stdout.write(f"  spec: {normalized['cable_spec'].code if normalized['cable_spec'] else None}")
            self.stdout.write(f"  quantity: {normalized['quantity']}")
            self.stdout.write(f"  length_type: {normalized['length_type']}")
            self.stdout.write(f"  length_m: {normalized['length_m']}")
            self.stdout.write(f"  medium: {normalized['medium']}")
            self.stdout.write(f"  confidence: {normalized['confidence_score']}")
            self.stdout.write(f"  warnings: {[w['code'] for w in normalized['warnings']]}")
            self.stdout.write("")

        self.stdout.write("---")
        if ai_parser is None:
            self.stdout.write("Provider test: N/A (IA não configurada)")
        elif ai_error is not None:
            self.stdout.write(self.style.ERROR(f"Provider test: FAILED ({ai_error.code})"))
            self.stdout.write(self.style.SUCCESS("Parser fallback: SUCCESS"))
        else:
            self.stdout.write(self.style.SUCCESS("Provider test: OK"))

        if parser_mode == "HYBRID_AI":
            self.stdout.write(self.style.SUCCESS("Parser mode: HYBRID_AI"))
        else:
            self.stdout.write(self.style.WARNING("Parser mode: DETERMINISTIC_ONLY"))

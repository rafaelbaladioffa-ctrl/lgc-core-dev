"""Testa a integração REAL com o provider de IA do parser de SOW
(OpenRouter) — 1 chamada mínima ("Return only valid JSON: {"ok": true}"),
direto do backend/container, sem depender da UI nem do login externo (ver
pedido original, bloco 9 — importante enquanto o problema de login via
porta publicada/túnel externo estiver em aberto, que é um assunto
totalmente separado deste comando).

Uso:
    python manage.py test_ai_provider

Nunca imprime AI_API_KEY."""

from django.core.management.base import BaseCommand

from master_data.services.sow_parser.ai_parser import AiSowParserError, get_ai_config_status, get_ai_sow_parser


class Command(BaseCommand):
    help = "Testa a integração real com o provider de IA configurado (OpenRouter) — nunca imprime a API key."

    def handle(self, *args, **options):
        status = get_ai_config_status()

        self.stdout.write(f"Provider: {status['provider']}")
        self.stdout.write(f"Configured model: {status['configured_model'] or '(vazio)'}")
        self.stdout.write(f"Base URL: {status['base_url']}")

        if not status["configured"]:
            self.stdout.write(
                self.style.WARNING("Status: NOT_CONFIGURED (AI_API_KEY e/ou AI_MODEL ausentes — nada a testar)")
            )
            return

        ai_parser = get_ai_sow_parser()
        try:
            result = ai_parser.test_connection()
        except AiSowParserError as exc:
            self.stdout.write(self.style.ERROR(f"Status: FAILED ({exc.code})"))
            self.stdout.write(f"Detail: {exc}")
            raise SystemExit(1)

        self.stdout.write(f"Resolved model: {result['resolved_model']}")
        self.stdout.write(self.style.SUCCESS("Status: OK"))
        self.stdout.write(f"Latency: {result['latency_ms']}ms")
        self.stdout.write(f"Retries: {result['retries']}")
        self.stdout.write(f"HTTP status: {result['http_status']}")
        self.stdout.write(f"Structured JSON: {'OK' if result['structured_json_ok'] else 'FALLBACK (sem response_format)'}")
        if result.get("usage"):
            self.stdout.write(f"Token usage: {result['usage']}")

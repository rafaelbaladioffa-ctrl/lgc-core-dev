"""Abstração do provider de IA usado pelo parser de SOW — nenhuma regra de
negócio deste módulo (nem o resto do sistema) fica acoplada a um
fornecedor específico. `get_ai_sow_parser()` é a factory usada pelo
service: retorna None quando a IA não está configurada (AI_API_KEY vazia)
ou o provider é desconhecido, e o service segue em modo
DETERMINISTIC_ONLY sem quebrar (ver
master_data/services/sow_parser/service.py) — nunca lança exceção por
"IA não configurada", isso é um estado normal e esperado.

Configuração só por variável de ambiente (nunca hardcoded, nunca gravada
no banco, nunca logada):
    AI_PROVIDER              — nome do provider ("openrouter", único hoje)
    AI_API_KEY                — chave da API
    AI_MODEL                  — slug do modelo (ex: "openrouter/free")
    AI_BASE_URL                — default "https://openrouter.ai/api/v1"
    AI_TIMEOUT_SECONDS         — default 60
    AI_MAX_RETRIES             — default 2 (tentativas ALÉM da inicial)
    OPENROUTER_HTTP_REFERER    — enviado como header HTTP-Referer, opcional
    OPENROUTER_APP_NAME        — enviado como header X-Title, default
                                  "Projetos Consultimer"
"""

import json
import logging
import os
import time

import requests

from master_data.ai.prompts.sow_parser_v1 import PROMPT_VERSION, build_sow_parser_prompt

from .schemas import validate_ai_output

logger = logging.getLogger("master_data.sow_import.ai")

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_TIMEOUT_SECONDS = 60
DEFAULT_MAX_RETRIES = 2
DEFAULT_APP_NAME = "Projetos Consultimer"

# Backoff simples (não agressivo — plano gratuito): 1s antes da 1ª retentativa,
# 3s antes da 2ª. Índices além do fim do tuple reusam o último valor.
RETRY_BACKOFF_SECONDS = (1, 3)

# Só estes são retentados (erros transitórios do upstream); 4xx "de
# entrada" (400/401/403/404/422) nunca são retentados — ver módulo pai.
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

# Códigos padronizados (ver pedido original, bloco 12) — nunca incluem a
# API key na mensagem.
_ERROR_CODE_BY_STATUS = {
    401: "OPENROUTER_AUTH_ERROR",
    403: "OPENROUTER_PERMISSION_ERROR",
    429: "OPENROUTER_RATE_LIMIT",
}


class AiSowParserError(Exception):
    """A chamada à IA falhou (rede, timeout, resposta não-JSON, schema
    inválido, erro HTTP do provider) — sempre tratado pelo service como
    "seguir em modo DETERMINISTIC_ONLY para este import/item", nunca
    propagado até quebrar o módulo inteiro. `code` é um dos
    OPENROUTER_* padronizados (ver módulo pai); nunca contém a API key."""

    def __init__(self, message, code="OPENROUTER_UPSTREAM_ERROR"):
        super().__init__(message)
        self.code = code


class AiSowParser:
    """Interface que qualquer provider de IA deve implementar. `parse`
    retorna (items, meta) — `items` é a lista já validada pelo schema
    local, `meta` é um dict JSON-serializável com configured_model/
    resolved_model/latency_ms/retries/usage (nunca a API key)."""

    def parse(self, raw_text, deterministic_drafts, master_data_context):
        raise NotImplementedError

    def test_connection(self):
        raise NotImplementedError


class OpenRouterAiSowParser(AiSowParser):
    """Implementação concreta única desta primeira versão — usa a API de
    chat completions do OpenRouter. Tenta `response_format=json_object`
    primeiro (estruturado); se o modelo/provider não suportar esse
    parâmetro (HTTP 400 mencionando "response_format"), refaz a MESMA
    chamada sem ele, com o prompt já pedindo explicitamente "somente
    JSON" (ver master_data/ai/prompts/sow_parser_v1.py) — esse fallback
    de capacidade não conta como retry de erro transitório. A resposta,
    estruturada ou não, sempre passa pelo schema local antes de ser
    aceita (nunca grava o JSON bruto da IA diretamente)."""

    def __init__(self, api_key, model, base_url=None, timeout=None, max_retries=None, http_referer=None, app_name=None):
        self.api_key = api_key
        self.model = model
        self.base_url = (base_url if base_url is not None else os.getenv("AI_BASE_URL", DEFAULT_BASE_URL)).strip().rstrip(
            "/"
        ) or DEFAULT_BASE_URL
        self.timeout = (
            timeout if timeout is not None else int(os.getenv("AI_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
        )
        self.max_retries = (
            max_retries if max_retries is not None else int(os.getenv("AI_MAX_RETRIES", str(DEFAULT_MAX_RETRIES)))
        )
        self.http_referer = (http_referer if http_referer is not None else os.getenv("OPENROUTER_HTTP_REFERER", "")).strip()
        self.app_name = (
            app_name if app_name is not None else os.getenv("OPENROUTER_APP_NAME", DEFAULT_APP_NAME)
        ).strip() or DEFAULT_APP_NAME

    @property
    def chat_completions_url(self):
        return f"{self.base_url}/chat/completions"

    def _headers(self):
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        if self.http_referer:
            headers["HTTP-Referer"] = self.http_referer
        if self.app_name:
            headers["X-Title"] = self.app_name
        return headers

    def _build_body(self, messages, structured):
        body = {"model": self.model, "messages": messages}
        if structured:
            body["response_format"] = {"type": "json_object"}
        return body

    def _post_once(self, body):
        """Uma única tentativa HTTP, sem retry — sempre mapeia falhas de
        rede/timeout para AiSowParserError com o código padronizado."""
        try:
            return requests.post(self.chat_completions_url, headers=self._headers(), json=body, timeout=self.timeout)
        except requests.Timeout as exc:
            raise AiSowParserError(
                f"Timeout ao consultar OpenRouter (> {self.timeout}s).", code="OPENROUTER_TIMEOUT"
            ) from exc
        except requests.RequestException as exc:
            raise AiSowParserError(f"Falha de conexão com OpenRouter: {exc}", code="OPENROUTER_CONNECTION_ERROR") from exc

    def _error_for_response(self, response):
        status = response.status_code
        detail = ""
        try:
            payload = response.json()
            error_obj = payload.get("error")
            if isinstance(error_obj, dict):
                detail = error_obj.get("message", "") or ""
            elif error_obj:
                detail = str(error_obj)
        except ValueError:
            detail = (response.text or "")[:300]
        code = _ERROR_CODE_BY_STATUS.get(status)
        if code is None:
            code = "OPENROUTER_UPSTREAM_ERROR" if status >= 500 else "OPENROUTER_REQUEST_ERROR"
        message = f"OpenRouter retornou HTTP {status}" + (f": {detail}" if detail else ".")
        return AiSowParserError(message, code=code)

    def _call_with_retry(self, body):
        """Executa a chamada com retry só para erros TRANSITÓRIOS (429/5xx/
        timeout/conexão) — nunca para 400/401/403/404/422. No máximo
        `self.max_retries` tentativas ALÉM da inicial, com backoff simples
        (1s, 3s). Retorna (response, retries_usados)."""
        attempts = self.max_retries + 1
        last_error = None
        for attempt in range(attempts):
            is_last = attempt == attempts - 1
            try:
                response = self._post_once(body)
            except AiSowParserError as exc:
                if exc.code in ("OPENROUTER_TIMEOUT", "OPENROUTER_CONNECTION_ERROR") and not is_last:
                    last_error = exc
                    time.sleep(RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)])
                    continue
                raise
            if response.status_code in RETRYABLE_STATUS_CODES and not is_last:
                last_error = self._error_for_response(response)
                time.sleep(RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)])
                continue
            if not response.ok:
                raise self._error_for_response(response)
            return response, attempt
        raise last_error or AiSowParserError("Falha desconhecida ao consultar OpenRouter.")

    def _chat(self, messages):
        """Executa a conversa completa: tenta structured output, cai para
        prompt-only-JSON se o provider rejeitar o parâmetro, e sempre
        aplica o retry de erros transitórios em cada tentativa. Retorna
        (response, retries, latency_ms)."""
        start = time.monotonic()
        try:
            response, retries = self._call_with_retry(self._build_body(messages, structured=True))
        except AiSowParserError as exc:
            if exc.code == "OPENROUTER_REQUEST_ERROR" and "response_format" in str(exc).lower():
                logger.info("OpenRouter: response_format não suportado pelo modelo — tentando sem structured output.")
                response, retries = self._call_with_retry(self._build_body(messages, structured=False))
            else:
                raise
        latency_ms = int((time.monotonic() - start) * 1000)
        return response, retries, latency_ms

    def _parse_response(self, response):
        try:
            payload = response.json()
        except ValueError as exc:
            raise AiSowParserError(f"Resposta do OpenRouter não é JSON válido: {exc}", code="OPENROUTER_INVALID_JSON") from exc
        resolved_model = payload.get("model") or self.model
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AiSowParserError(
                f"Resposta do OpenRouter em formato inesperado: {exc}", code="OPENROUTER_INVALID_JSON"
            ) from exc
        try:
            data = json.loads(content)
        except (json.JSONDecodeError, TypeError) as exc:
            raise AiSowParserError(f"Conteúdo retornado pela IA não é JSON válido: {exc}", code="OPENROUTER_INVALID_JSON") from exc
        usage = payload.get("usage") or {}
        return data, resolved_model, usage

    def _log(self, event, meta, error_code=None):
        # Nunca loga Authorization/API key nem o texto do SOW inteiro —
        # só metadados da chamada (ver pedido original, bloco 13).
        logger.info(
            "OpenRouter %s provider=openrouter configured_model=%s resolved_model=%s latency_ms=%s retries=%s "
            "usage=%s error_code=%s",
            event,
            self.model,
            meta.get("resolved_model") if meta else None,
            meta.get("latency_ms") if meta else None,
            meta.get("retries") if meta else None,
            meta.get("usage") if meta else None,
            error_code,
        )

    def parse(self, raw_text, deterministic_drafts, master_data_context):
        if not self.model:
            raise AiSowParserError("AI_MODEL não configurado.", code="OPENROUTER_NOT_CONFIGURED")
        prompt = build_sow_parser_prompt(raw_text, deterministic_drafts, master_data_context)
        try:
            response, retries, latency_ms = self._chat([{"role": "user", "content": prompt}])
            data, resolved_model, usage = self._parse_response(response)
            items = validate_ai_output(data)
        except AiSowParserError as exc:
            self._log("call_failed", None, error_code=exc.code)
            raise
        meta = {
            "configured_model": self.model,
            "resolved_model": resolved_model,
            "latency_ms": latency_ms,
            "retries": retries,
            "usage": usage,
        }
        self._log("call_ok", meta)
        return items, meta

    def test_connection(self):
        """Chamada mínima real (usada por GET/POST /api/planning/ai/test/
        e pelo management command test_ai_provider) — não passa pelo
        pipeline de SOW, só valida que o provider responde e devolve JSON
        parseável."""
        if not self.model:
            raise AiSowParserError("AI_MODEL não configurado.", code="OPENROUTER_NOT_CONFIGURED")
        prompt = 'Return only valid JSON, no markdown, no explanation:\n{"ok": true}'
        try:
            response, retries, latency_ms = self._chat([{"role": "user", "content": prompt}])
            data, resolved_model, usage = self._parse_response(response)
        except AiSowParserError as exc:
            self._log("test_failed", None, error_code=exc.code)
            raise
        meta = {
            "success": True,
            "provider": "openrouter",
            "configured_model": self.model,
            "resolved_model": resolved_model,
            "latency_ms": latency_ms,
            "retries": retries,
            "http_status": response.status_code,
            "usage": usage,
            "structured_json_ok": isinstance(data, dict),
        }
        self._log("test_ok", meta)
        return meta


def get_ai_sow_parser():
    """Factory configurada por environment variables — retorna None (não
    uma exceção) quando AI_API_KEY não está definida, AI_MODEL está vazio,
    ou o provider não é reconhecido, sinalizando ao service que deve
    seguir em modo DETERMINISTIC_ONLY. Nunca loga nem persiste a API key."""

    api_key = os.getenv("AI_API_KEY", "").strip()
    if not api_key:
        return None
    provider = os.getenv("AI_PROVIDER", "openrouter").strip().lower()
    model = os.getenv("AI_MODEL", "").strip()
    if provider != "openrouter" or not model:
        return None
    return OpenRouterAiSowParser(api_key=api_key, model=model)


def get_ai_config_status():
    """Estado de configuração (sem chamar o provider) — usado por
    GET /api/planning/ai/status/. Nunca inclui a API key."""

    api_key = os.getenv("AI_API_KEY", "").strip()
    provider = os.getenv("AI_PROVIDER", "openrouter").strip().lower()
    model = os.getenv("AI_MODEL", "").strip()
    base_url = (os.getenv("AI_BASE_URL", DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL).rstrip("/")
    return {
        "provider": provider,
        "configured": bool(api_key and model and provider == "openrouter"),
        "configured_model": model or None,
        "base_url": base_url,
    }


def get_ai_provider_label():
    """Nome do provider configurado (ou "") — só para registrar em
    SowImport.ai_provider, nunca a chave em si."""
    return os.getenv("AI_PROVIDER", "openrouter").strip().lower() if os.getenv("AI_API_KEY", "").strip() else ""


__all__ = [
    "AiSowParser",
    "AiSowParserError",
    "OpenRouterAiSowParser",
    "get_ai_sow_parser",
    "get_ai_config_status",
    "get_ai_provider_label",
    "PROMPT_VERSION",
]

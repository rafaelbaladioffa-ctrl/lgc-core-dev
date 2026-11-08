"""Cliente da API de consulta do Core (`GET /api/v1/integration/...`), autenticada por API key do satélite."""

import logging
import re

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# Recursos de lista da API de consulta e o tipo de cadastro a que correspondem.
RESOURCES = {
    "clients": "client",
    "collaborators": "collaborator",
    "users": "user",
    "projects": "project",
    "cost-centers": "cost_center",
    "sites": "site",
    "job-titles": "job_title",
    "holidays": "holiday",
}


# Campo com o id do Core, por tipo de cadastro (igual ao dos eventos).
ID_KEYS = {
    "client": "client_id",
    "collaborator": "collaborator_id",
    "user": "user_id",
    "project": "project_id",
    "cost_center": "cost_center_id",
    "site": "site_id",
    "job_title": "job_title_id",
    "holiday": "holiday_id",
}
# Dados pessoais de contato do cliente não são necessários para o casamento e não ficam no cache.
DROP_KEYS = {"client": {"contacts", "address"}}


def _snake(key: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()


def normalize_core_row(kind: str, row: dict) -> dict:
    """Linha da API de consulta (camelCase do Prisma) -> mesmo formato dos eventos (snake_case)."""
    drop = DROP_KEYS.get(kind, set())
    data = {_snake(k): v for k, v in row.items() if k not in drop}
    if "id" in data:
        data[ID_KEYS[kind]] = data.pop("id")
    if kind == "collaborator" and isinstance(data.get("job_title"), dict):
        # `collaborators` devolve o cargo aninhado; o evento usa `job_title_name`/`job_title_is_technician`.
        job_title = data.pop("job_title")
        data.setdefault("job_title_name", job_title.get("name"))
        data.setdefault("job_title_is_technician", job_title.get("isTechnician", job_title.get("is_technician")))
        if job_title.get("id"):
            data.setdefault("job_title_id", job_title["id"])
    if kind == "user" and "roles" in data and isinstance(data["roles"], list):
        data["roles"] = [r if isinstance(r, str) else (r or {}).get("name", "") for r in data["roles"]]
    if kind == "holiday" and isinstance(data.get("date"), str):
        data["date"] = data["date"][:10]  # o Prisma devolve `@db.Date` como ISO com hora
    return data


class AxisApiError(Exception):
    pass


class AxisApiNotFound(AxisApiError):
    """Recurso inexistente no Core (ex.: `sites` antes do PT-01 estar no ar)."""


def is_configured() -> bool:
    return bool(settings.AXIS_API_URL and settings.AXIS_API_KEY)


class AxisApiClient:
    def __init__(self, base_url=None, api_key=None, timeout=None, session=None):
        self.base_url = (base_url or settings.AXIS_API_URL).rstrip("/")
        self.api_key = api_key or settings.AXIS_API_KEY
        self.timeout = timeout or settings.AXIS_API_TIMEOUT
        self.session = session or requests.Session()
        if not self.base_url or not self.api_key:
            raise AxisApiError("AXIS_API_URL e AXIS_API_KEY precisam estar configuradas.")

    def _get(self, path, params=None):
        url = f"{self.base_url}/integration/{path.lstrip('/')}"
        try:
            response = self.session.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise AxisApiError(f"Falha ao consultar o Core: {exc.__class__.__name__}") from exc
        if response.status_code == 404:
            raise AxisApiNotFound(f"{path}: não encontrado no Core.")
        if response.status_code in (401, 403):
            raise AxisApiError("O Core recusou a API key (confira AXIS_API_KEY e as assinaturas do satélite).")
        if response.status_code >= 400:
            raise AxisApiError(f"O Core respondeu {response.status_code} em {path}.")
        try:
            return response.json()
        except ValueError as exc:
            raise AxisApiError(f"Resposta inválida do Core em {path}.") from exc

    def get_one(self, resource: str, axis_id: str) -> dict:
        return self._get(f"{resource}/{axis_id}")

    def iter_all(self, resource: str, per_page: int = 200):
        """Percorre as páginas de `{data, meta}`. Recurso sem paginação devolve uma lista direta."""
        page = 1
        while True:
            body = self._get(resource, {"page": page, "per_page": per_page})
            rows = body if isinstance(body, list) else body.get("data", [])
            yield from rows
            if isinstance(body, list):
                return
            total = (body.get("meta") or {}).get("total", 0)
            if not rows or page * per_page >= total:
                return
            page += 1


class AxisDocumentTooLarge(AxisApiError):
    pass


def download_project_document(project_axis_id, document_id, *, timeout=None, max_bytes=None, client=None):
    """Baixa o conteúdo de um documento do projeto no Core (a SOW em PDF).

    `GET {AXIS_API_URL}/integration/projects/:id/documents/:documentId/content` com a API key do satélite.
    Devolve `(bytes, nome_do_arquivo, tipo_mime)`. Levanta `AxisApiError` (inclusive `AxisApiNotFound` e
    `AxisDocumentTooLarge`) com mensagem em pt-BR, sem nunca incluir a chave."""
    from email.message import Message
    from urllib.parse import unquote

    client = client or AxisApiClient(timeout=timeout or settings.AXIS_SOW_DOWNLOAD_TIMEOUT)
    limit = max_bytes or settings.AXIS_SOW_MAX_MB * 1024 * 1024
    path = f"projects/{project_axis_id}/documents/{document_id}/content"
    url = f"{client.base_url}/integration/{path}"
    try:
        response = client.session.get(
            url,
            headers={"Authorization": f"Bearer {client.api_key}", "Accept": "*/*"},
            timeout=client.timeout,
            stream=True,
        )
    except requests.RequestException as exc:
        raise AxisApiError(f"Falha ao baixar a SOW do Core: {exc.__class__.__name__}") from exc
    try:
        if response.status_code == 404:
            raise AxisApiNotFound("A SOW não foi encontrada no Core (documento removido ou de outro projeto).")
        if response.status_code in (401, 403):
            raise AxisApiError("O Core recusou a API key ao baixar a SOW (confira AXIS_API_KEY).")
        if response.status_code >= 400:
            raise AxisApiError(f"O Core respondeu {response.status_code} ao baixar a SOW.")
        declared = response.headers.get("Content-Length")
        if declared and declared.isdigit() and int(declared) > limit:
            raise AxisDocumentTooLarge(f"A SOW tem {int(declared) // (1024 * 1024)} MB; o limite é {limit // (1024 * 1024)} MB.")
        chunks, size = [], 0
        try:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                size += len(chunk)
                if size > limit:
                    raise AxisDocumentTooLarge(f"A SOW passa do limite de {limit // (1024 * 1024)} MB.")
                chunks.append(chunk)
        except requests.RequestException as exc:
            raise AxisApiError(f"Falha ao baixar a SOW do Core: {exc.__class__.__name__}") from exc
        content = b"".join(chunks)
        if not content:
            raise AxisApiError("O Core devolveu a SOW vazia.")
        message = Message()
        message["content-disposition"] = response.headers.get("Content-Disposition", "")
        filename = unquote(message.get_filename() or "") or f"sow-{document_id}.pdf"
        return content, filename, response.headers.get("Content-Type", "")
    finally:
        response.close()

from copy import deepcopy

from .models import BotMessageTemplate


FIELD_DEFINITIONS = {
    "daily_tasks": [
        ("project_code", "Código do projeto"),
        ("project_name", "Nome do projeto"),
        ("site", "Site"),
        ("collaborators", "Técnicos alocados"),
        ("pending_tasks", "Tarefas pendentes"),
    ],
    "project_updates": [
        ("project_name", "Nome do projeto"),
        ("po", "PO"),
        ("responsible_client", "Responsável Cliente"),
        ("responsible_cstr", "Responsável CSTR"),
        ("collaborators", "Colaboradores"),
        ("date", "Data"),
        ("work_hours", "Horário de trabalho"),
        ("completion_percent", "Percentual de conclusão"),
        ("activities_text", "Atividades executadas"),
        ("certification_done", "Certificação"),
        ("project_finished", "Projeto finalizado"),
        ("summary", "Observações"),
    ],
    "daily_project_report": [
        ("project_name", "Nome do projeto"),
        ("po", "PO"),
        ("site", "Site"),
        ("responsible_cstr", "Responsável CSTR"),
        ("responsible_client", "Responsável Cliente"),
        ("completion_percent", "Avanço atual"),
        ("daily_delta", "Avanço no dia"),
        ("status", "Status"),
        ("planned_end", "Previsão de término"),
        ("certification", "Certificação"),
        ("project_finished", "Projeto finalizado"),
        ("occurrences", "Riscos / bloqueios"),
    ],
    "operations_print": [
        ("caption_datetime", "Data e hora na legenda"),
    ],
    "allocation": [
        ("project_code", "Código do projeto"),
        ("site", "Site"),
    ],
    "interactive_menu": [
        ("alocacao", "1 · Alocação (projeto e site de hoje)"),
        ("atualizacao_projetos", "2 · Atualização de projetos"),
        ("minhas_tarefas", "3 · Minhas tarefas"),
        ("status_tecnicos", "4 · Status dos técnicos"),
    ],
}

DEFAULT_TEMPLATES = {
    "daily_tasks": {
        "title": "Tarefas alocadas para hoje",
        "intro_text": "",
        "footer_text": "",
    },
    "project_updates": {
        "title": "Atualização Diária de Projeto",
        "intro_text": "",
        "footer_text": "",
    },
    "operations_print": {
        "title": "Operação do Dia",
        "intro_text": "",
        "footer_text": "",
    },
    "daily_project_report": {
        "title": "ATUALIZAÇÃO DIÁRIA DE PROJETO",
        "intro_text": "",
        "footer_text": "",
    },
    "allocation": {
        "title": "",
        "intro_text": "Olá, {nome}! Aqui está sua alocação para {data}:",
        "footer_text": "",
    },
    "interactive_menu": {
        "title": "",
        "intro_text": "Olá! Eu sou o bot do ERP Consultimer. O que você deseja?",
        "footer_text": "Digite o número da opção.",
    },
}


def default_enabled_fields(message_type):
    return {key: True for key, _label in FIELD_DEFINITIONS.get(message_type, [])}


def get_effective_template(message_type):
    base = deepcopy(DEFAULT_TEMPLATES.get(message_type, {"title": "", "intro_text": "", "footer_text": ""}))
    base.update(
        {
            "message_type": message_type,
            "enabled_fields": default_enabled_fields(message_type),
            "is_active": True,
            "field_definitions": [
                {"key": key, "label": label} for key, label in FIELD_DEFINITIONS.get(message_type, [])
            ],
        }
    )
    template = BotMessageTemplate.objects.filter(message_type=message_type).first()
    if template:
        base.update(
            {
                "id": template.pk,
                "title": template.title,
                "intro_text": template.intro_text,
                "footer_text": template.footer_text,
                "enabled_fields": {**base["enabled_fields"], **(template.enabled_fields or {})},
                "is_active": template.is_active,
                "updated_at": template.updated_at,
            }
        )
    return base


def preview_for_template(data):
    message_type = data["message_type"]
    fields = {**default_enabled_fields(message_type), **(data.get("enabled_fields") or {})}
    title = data.get("title") or DEFAULT_TEMPLATES.get(message_type, {}).get("title") or ""
    intro = data.get("intro_text") or ""
    footer = data.get("footer_text") or ""

    samples = {
        "daily_tasks": [
            ("project_code", "CSTR-2026-001"),
            ("project_name", "Projeto Alpha"),
            ("site", "Site SP01"),
            ("collaborators", "Ana Souza, Carlos Lima"),
            ("pending_tasks", "Instalação de rack (Pendente)\n• Certificação de fibra (Em andamento)"),
        ],
        "project_updates": [
            ("project_name", "Projeto Alpha"),
            ("po", "4500123456"),
            ("responsible_client", "Marina Cliente"),
            ("responsible_cstr", "João CSTR"),
            ("collaborators", "Ana Souza, Carlos Lima"),
            ("date", "03/10/2026"),
            ("work_hours", "08:00 às 17:00"),
            ("completion_percent", "72%"),
            ("activities_text", "Passagem de cabos e identificação dos pontos."),
            ("certification_done", "Não"),
            ("project_finished", "Não"),
            ("summary", "Aguardando liberação de acesso ao rack B."),
        ],
        "daily_project_report": [
            ("project_name", "Projeto Alpha"),
            ("po", "4500123456"),
            ("site", "SP01"),
            ("responsible_cstr", "João CSTR"),
            ("responsible_client", "Marina Cliente"),
            ("completion_percent", "72%"),
            ("daily_delta", "+8%"),
            ("status", "Em andamento"),
            ("planned_end", "10/10/2026"),
            ("certification", "Pendente"),
            ("project_finished", "Não"),
            ("occurrences", "Acesso ao rack B pendente"),
        ],
        "operations_print": [("caption_datetime", "03/10/2026 14:00")],
        "allocation": [("project_code", "CSTR-2026-001"), ("site", "Site SP01")],
        "interactive_menu": [
            ("alocacao", "Alocação (projeto e site de hoje)"),
            ("atualizacao_projetos", "Atualização de projetos"),
            ("minhas_tarefas", "Minhas tarefas"),
            ("status_tecnicos", "Status dos técnicos"),
        ],
    }
    lines = [f"*{title}*"] if title else []
    if intro:
        lines.extend(["", intro])
    lines.append("")
    for key, value in samples.get(message_type, []):
        if fields.get(key):
            label = dict(FIELD_DEFINITIONS.get(message_type, [])).get(key, key)
            lines.append(f"{label}: {value}")
    if footer:
        lines.extend(["", footer])
    return "\n".join(lines).strip()

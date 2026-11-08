# Integração Core ↔ Field

Plano de integração entre o Axis Core e o satélite **Axis Field** (`lgc-dev-field/`, antigo ERP
CSTR), escrito em 2026-11-08 quando o código entrou no repositório. **Nada desta integração está
implementado ainda**: hoje o Field roda sozinho, com login e cadastros próprios.

Decisões do dono do produto em 2026-11-08:

| # | Decisão |
|---|---|
| FD-01 | O Field entra como satélite em `lgc-dev-field/`, **mantendo Django**, banco próprio (decisão A10 em [arquitetura.md](arquitetura.md#8-decisões-de-arquitetura)). |
| FD-02 | **O Core é a fonte da verdade** para usuários (login), colaboradores, clientes e projetos. O Field recebe esses dados pelos webhooks do Core e casa os registros que já existem. |
| FD-03 | Nome e identidade visual: **Axis Field**, com a marca do Axis (`scripts/sync-design.mjs`). |
| FD-04 | Só o código foi trazido do `erp-cstr` (commit `c27ef24`), sem o histórico do Git. |

## Resumo dos canais (alvo)

| Canal | Direção | Estado |
|---|---|---|
| Login no Core pelo navegador (CORS) e access token do Core na API do Field | Core → Field | **A fazer** (F1) |
| Webhook de dados mestres (`collaborator.*`, `client.*`, `project.*`, `cost_center.*`) | Core → Field | **A fazer** (F2) |
| Carga inicial e casamento dos cadastros já existentes no Field | Core → Field | **A fazer** (F3) |
| Projeto ganho no Core vira obra no Field | Core → Field | **A decidir** (F4, §4) |
| Avanço, HH e status da obra | Field → Core | **A fazer**; depende do receptor `POST /integration/inbound` no Core, que ainda não existe (F5) |

## 1. Sobreposição de cadastros

| Field (`lgc-dev-field/backend`) | Core | Regra proposta |
|---|---|---|
| `users.User` (e-mail único, grupos Django) | `User` | Login só no Core; o Field casa por e-mail e guarda `axis_user_id`. Permissões do Field continuam nos grupos Django (como a Logística e o Financeiro resolvem os próprios papéis). |
| `core.Person` + `core.Collaborator` (cargo, `manager`) | `Collaborator` | Core manda; Field guarda `axis_collaborator_id`. A hierarquia (`manager`), usada no escopo de Supervisor, passa a vir do Core. |
| `core.Client` | `Client` | Core manda; casar por CNPJ, senão por nome normalizado. |
| `core.Site`, `core.Region`, `master_data.Site` | — | **Ficam no Field** (o Core não tem site). |
| `core.Company` (multiempresa) | — (A3: unidade única) | **A decidir** (§7). |
| `core.JobTitle` | `JobTitle` | Core manda (vem junto no colaborador). |
| `projects.Project` (`CSTR-PROJ-…`) | `Project` (`PROP-…`) | Vínculo `axis_project_id`; ver §4. |
| Catálogo técnico (`master_data`), tarefas, despacho, presença, HH | — | **Ficam no Field.** |

Todas as mudanças de modelo no Field são **aditivas** (campos `axis_*_id` nulos primeiro), seguindo
a regra do próprio ERP CSTR.

## 2. F1 — Identidade

Mesmo modelo do Financeiro ([integracao-core-financeiro.md §1](integracao-core-financeiro.md#1-identidade)):

- `JWT_SECRET` do Field = `JWT_ACCESS_SECRET` do Core, `HS256` fixo; recusar tokens com `iss` (os de
  sessão própria da Logística).
- Nova classe de autenticação DRF que valida o token do Core e resolve o `User` local pelo
  `axis_user_id` (ou e-mail na primeira vez). Usuário sem vínculo → 403 com mensagem em pt-BR.
- O frontend do Field faz login/refresh no Core (`VITE_AXIS_URL`); o Core lista `http://localhost:5176`
  e o domínio de produção do Field em `CORS_ALLOWED_ORIGINS`.
- Durante a transição, o login local (`/api/token/`) continua só para superusuário, até a
  produção migrar.
- O bot do WhatsApp continua com `X-Bot-Secret` (não usa login).

## 3. F2/F3 — Webhooks e carga inicial

- Receptor `POST /api/v1/webhooks/axis` no Django: confere `X-Axis-Signature` (HMAC-SHA256 com
  `hmac.compare_digest`), deduplica por `event_id` numa tabela própria e grava o cache na mesma
  transação.
- Assina no Core: `collaborator.created|updated|offboarded`, `client.created|updated`,
  `project.created|updated|status_changed|deleted`, `cost_center.created|updated`.
- Carga inicial por comando `manage.py axis_sync` usando a API de consulta do Core
  (`GET /api/v1/integration/{collaborators,users,clients,projects}` com API key). Gera relatório
  dos registros do Field **sem par** no Core para tratamento manual. Nada é apagado.

## 4. Projeto do Core × obra do Field

No Core, `Project` nasce como proposta comercial (`PROP-{cliente}.{seq}-{MMAA}`, cotação com o
Financeiro). No Field, `Project` é a obra em execução (tarefas, despacho, HH). Proposta: quando o
projeto do Core passa para execução (`project.status_changed`), o Field cria ou vincula a obra com
`axis_project_id`; o código `CSTR-PROJ-…` continua como código da obra. **Pendente de decisão:** em
que status do Core a obra nasce, se uma proposta pode gerar várias obras (uma por site) e quem
cadastra a obra se não houver proposta no Core.

## 5. F5 — Field → Core

O Core não tem receptor de eventos de satélite (mesmo bloqueio da Logística e do Financeiro). Quando
existir, candidatos: `field.project.progress` (% de avanço, HH real × orçado) e
`field.project.completed`. O Financeiro (módulo Projetos, resultado por projeto) é o principal
interessado no HH real.

## 6. Migração da produção

A produção do ERP CSTR (VPS própria, domínio próprio) continua rodando do repositório `erp-cstr`.
Para migrar: backup do banco, F1–F3 concluídas e ensaiadas numa cópia do banco, restauração no
servidor do Axis como `field-postgres`, troca de DNS e congelamento do repositório antigo. **Não
faça deploy deste diretório na produção antiga.**

## 7. Pendências de decisão

1. **Marca nas comunicações a clientes:** remetente de e-mail (`DEFAULT_FROM_EMAIL`), timbrado dos
   PDFs (`backend/core/static/core/img/letterhead-consultimer.png`), "Tipo de Projeto Consultimer" e
   `responsible_cstr` continuam com o nome Consultimer. Trocar exige migração e afeta o que o cliente
   recebe.
2. **Multiempresa:** o Field tem `Company`; o Core é unidade única (A3).
3. **Status de nascimento da obra** e relação proposta → obras (§4).
4. **Identidade visual completa:** adotar `axis-tokens.css`/`axis-shell.css` no frontend do Field
   (hoje só nome, logotipo e ícones são do Axis).

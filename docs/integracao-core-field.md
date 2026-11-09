# Integração Core ↔ Field

Plano de integração entre o Axis Core e o satélite **Axis Field** (`lgc-dev-field/`, antigo ERP
CSTR), escrito em 2026-11-08 quando o código entrou no repositório. **Estado:** os cadastros do Core chegam
ao Field (webhook, carga inicial e casamento: F2/F3, PT-03 do
plano `docs/plano-projeto-aprovado-ponta-a-ponta.md`) e, desde a onda V3 ([mapa-interoperabilidade.md](mapa-interoperabilidade.md)
§4, decisões MI-01 e MI-02), o Field **cria e atualiza** clientes, sites, cargos, técnicos/gestores e feriados do Core e
bloqueia os campos do Core no registro casado (§3.1); a obra nasce de `project.approved` com a SOW processada sozinha
(F4, PT-08, §4) e o Field avisa o Core de criação, início, avanço e conclusão (F5, PT-08, §5); o login pelo Core (F1)
segue pendente.

Decisões do dono do produto em 2026-11-08:

| # | Decisão |
|---|---|
| FD-01 | O Field entra como satélite em `lgc-dev-field/`, **mantendo Django**, banco próprio (decisão A10 em [arquitetura.md](arquitetura.md#8-decisões-de-arquitetura)). |
| FD-02 | **O Core é a fonte da verdade** para usuários (login), colaboradores, clientes e projetos. O Field recebe esses dados pelos webhooks do Core e casa os registros que já existem. **Revisada em 2026-11-08 pela PA-05** (abaixo): o site também passa a ser cadastro do Core. **Revisada de novo pela MI-01 e MI-02** ([mapa-interoperabilidade.md §5](mapa-interoperabilidade.md#5-decisões-do-dono-do-produto)): o Field também **cria** o que o Core cadastrar (cliente, site, cargo, colaborador técnico ou gestor, feriado) e os campos do Core ficam **bloqueados** no registro casado (§3.1). |
| FD-03 | Nome e identidade visual: **Axis Field**, com a marca do Axis (`scripts/sync-design.mjs`). |
| FD-04 | Só o código foi trazido do `erp-cstr` (commit `c27ef24`), sem o histórico do Git. |
| PA-05 | **Site vira cadastro do Core** (ligado ao cliente: código como `GRU53`, nome, endereço, latitude/longitude; eventos `site.created/updated`). O Field casa os sites dele por `axis_site_id` e continua dono das localizações internas (sala, rack). **Revisa a FD-02**, que deixava o site só no Field. Decisão do plano do projeto aprovado (`docs/plano-projeto-aprovado-ponta-a-ponta.md` §3). |

## Resumo dos canais (alvo)

| Canal | Direção | Estado |
|---|---|---|
| Login no Core pelo navegador (CORS) e access token do Core na API do Field | Core → Field | **A fazer** (F1) |
| Webhook de dados mestres (`collaborator.*`, `client.*`, `project.*`, `cost_center.*`, `site.*`, `user.*`, `job_title.*`, `holiday.*`) | Core → Field | **Feito** (F2, §3; V3 em §3.1). `project.*` só guarda cache e vínculo; não cria obra |
| Carga inicial e casamento dos cadastros já existentes no Field | Core → Field | **Feito** (F3, `manage.py axis_sync`, §3) |
| Projeto aprovado no Core vira obra no Field (`project.approved`), com a SOW baixada do Core e o plano de tarefas | Core → Field | **Feito** (F4, PT-08, §4); o Core passa a emitir `project.approved` com o PT-06 |
| Criação, início, avanço e conclusão da obra (`field.project.*`) | Field → Core | **Feito no Field** (F5, PT-08, §5), pelo outbox do Field e `POST /integration/inbound` (receptor do PT-02); o Core passa a tratar os eventos com o PT-09 |
| Horas reais por técnico, projeto e dia (mão de obra realizada) | Field → Financeiro | **Feito** (PT-10, §5.4): `GET /api/integration/labor-hours`, puxado pelo Financeiro |

## 1. Sobreposição de cadastros

| Field (`lgc-dev-field/backend`) | Core | Regra proposta |
|---|---|---|
| `users.User` (e-mail único, grupos Django) | `User` | Login só no Core; o Field casa por e-mail, guarda `axis_user_id` e **espelha ativo/inativo** (`user.*`, V3). Não cria usuário (depende do F1). Permissões do Field continuam nos grupos Django (como a Logística e o Financeiro resolvem os próprios papéis). |
| `core.Person` + `core.Collaborator` (cargo, `manager`) | `Collaborator` | Core manda (V3): nome, e-mail, telefone, matrícula, Yellow Badge, cargo, gestor (`supervisor_id`) e ativo. Técnico ou gestor novo no Core é criado no Field. Sites atendidos e empresa são do Field. |
| `core.Client` | `Client` | Core manda (V3); casa por CNPJ, senão por nome normalizado; sem par, é criado. Observações, empresa e tipo de pessoa são do Field. |
| `core.Site` (site do cliente, o da obra: `Project.site`) | `Site` (PA-05) | Casa por cliente + código; sem par, é criado. Core manda em nome, código, cliente, endereço, coordenadas e ativo (V3). Regional e localizações internas são do Field. |
| `core.Region`, `master_data.Site` (catálogo técnico/topologia, único por código, sem cliente) | — | **Ficam no Field.** `master_data.Site` não recebe `axis_site_id`: o site da obra é o `core.Site`. |
| `core.Company` (multiempresa) | — (A3: unidade única) | **A decidir** (§7). |
| `core.JobTitle` | `JobTitle` | Core manda (V3): `axis_job_title_id` (único por empresa), nome e ativo; casa pelo nome na empresa padrão, senão cria. Descrição e empresa são do Field. |
| `core.Holiday` (novo na V3) | `Holiday` | Cópia do calendário do Core (`axis_holiday_id`), usada nos dias úteis do Painel de Sites. |
| `projects.Project` (`CSTR-PROJ-…`) | `Project` (`PROP-…`) | Vínculo `axis_project_id`; ver §4. |
| Catálogo técnico (`master_data`), tarefas, despacho, presença, HH | — | **Ficam no Field.** |

Todas as mudanças de modelo no Field são **aditivas** (campos `axis_*_id` nulos primeiro), seguindo
a regra do próprio ERP CSTR. Campos criados no PT-03 (todos `UUID`, nulos, não editáveis no admin, sem FK):

| Modelo | Campos |
|---|---|
| `users.User` | `axis_user_id` (único; criado aqui porque o F1 ainda não o tinha no código) |
| `core.Client` | `axis_client_id` (único) |
| `core.Collaborator` | `axis_collaborator_id` (único), `axis_cost_center_id` (cache do CC vigente no Core) |
| `core.Site` | `axis_site_id` (único) |
| `projects.Project` | `axis_project_id` (único), `axis_cost_center_id` (cache) |

Na onda V3 (migração `core.0038`, aditiva): `core.JobTitle.axis_job_title_id` (único por empresa),
`core.Collaborator.axis_status` (situação no Core, só informativa) e o modelo novo `core.Holiday`
(`date`, `name`, `is_active`, `axis_holiday_id` único). `axis_integration.0003` só acrescenta os tipos `job_title` e
`holiday` ao cache.

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

**Implementado** no app Django `axis_integration` (PT-03; onda V3 em §3.1). Nada é apagado. Desde a V3 o Core
**manda** nos cadastros dele: além dos vínculos `axis_*_id`, do centro de custo e do cache, o Field cria o que não tem
par e grava os campos do Core no registro casado (§3.1).

### Receptor `POST /api/v1/webhooks/axis`

- **Assinatura:** `X-Axis-Signature: sha256=<hex>` = HMAC-SHA256 do corpo bruto com `AXIS_WEBHOOK_SECRET`,
  conferida com `hmac.compare_digest`. Sem segredo configurado → `503`; assinatura ausente ou errada → `401`.
- **Anti-replay:** `occurred_at` mais velho que `AXIS_WEBHOOK_MAX_AGE_HOURS` (72 h, o Core reentrega com
  backoff) ou mais de 5 min no futuro → `400`. Envelope inválido, JSON inválido ou id do cadastro que não é
  UUID → `400` (não adianta reentregar).
- **Idempotência:** tabela `axis_integration_axisinboxevent`, `event_id` único. O registro do evento e a
  atualização do cache acontecem **na mesma transação**. Repetido → `200 {"status": "duplicate"}` sem
  reprocessar. Falha ao aplicar → `500`, a transação é desfeita, o evento fica `failed` e é reprocessado na
  reentrega. Tipo de evento que o Field não consome (`purchase.*`, `request.*`…) → `200 ignored`.
- **Ordem:** o cache guarda a ocorrência do último evento aplicado; evento mais velho não sobrescreve
  (`note = out_of_order`). Eventos parciais (`client.updated` só com `changed_fields`) são mesclados.

| Evento | Efeito no Field |
|---|---|
| `collaborator.created/updated/offboarded` | Cache + casamento (e-mail, senão matrícula); sem par, cria `Person` + `Collaborator` se o cargo é técnico (`job_title_is_technician`) ou `management_level` ≠ `colaborador`. Aplica os campos do Core (§3.1); `status = desligado` (ou `offboarded`) deixa o colaborador **inativo**. |
| `collaborator.cost_center_changed` | `Collaborator.axis_cost_center_id` (ou o cache, se o colaborador ainda não casou; é aplicado quando casar). |
| `client.created/updated/deleted` | Cache + casamento por CNPJ, senão nome normalizado; sem par, cria na empresa padrão. `deleted` (ou `active: false`) inativa, não apaga. |
| `job_title.created/updated/deleted` | Cria ou casa o `core.JobTitle` (nome na empresa padrão) e mantém nome e ativo. |
| `holiday.created/updated/deleted` | Cria ou atualiza o `core.Holiday`; `deleted` inativa. |
| `user.created/updated/disabled` | Casa por `axis_user_id`/e-mail e espelha `is_active` (`disabled` = inativo). **Não cria usuário.** |
| `project.created/updated/status_changed/deleted` | **Só cache e vínculo**: se uma obra já tiver `axis_project_id` igual, recebe `axis_cost_center_id`. **Não cria obra.** Não há casamento automático de projeto: `PROP-…` e `CSTR-PROJ-…` não têm chave comum. |
| `project.approved` | Cache **e cria (ou reaproveita) a obra** (§4). |
| `cost_center.created/updated` | Cache (`code`, `short_code`, `name`, `active`…). |
| `site.created/updated` | Cache + casamento por cliente já vinculado + código; sem par, é criado no cliente vinculado. Site cujo cliente ainda não casou espera e casa (ou é criado) quando o cliente casar. |

**Eventos magros.** O contrato V1 do Core ([mapa-interoperabilidade.md §6](mapa-interoperabilidade.md#6-contrato-v1-eventos-e-consultas-novos-do-core))
manda o estado completo. Para eventos antigos (`client.created` só com `client_id` e `code`, `collaborator.*` sem
e-mail, matrícula ou sem `management_level`/`job_title_is_technician`), se `AXIS_API_URL`/`AXIS_API_KEY` estiverem
configuradas, o receptor completa o cadastro com `GET /integration/clients|collaborators/:id` (fora da transação,
timeout de 5 s). Falha na consulta **não** derruba o evento: o registro entra sem vínculo e o `axis_sync` resolve
depois. Os contatos do cliente (legado `contacts`) e o JSON legado `address` não ficam no cache; o endereço vem das
colunas `address_*`.

### Casamento

| Cadastro | Chave | Observações |
|---|---|---|
| Cliente | CNPJ (só dígitos); senão nome normalizado (sem acento, pontuação nem `Ltda/S.A.`) contra razão social e fantasia | Mais de um candidato → sem vínculo (ambíguo). Cliente do Field já vinculado a outro id não é reaproveitado. |
| Colaborador | e-mail corporativo × e-mail da `Person`; senão matrícula | O Core ainda não expõe a matrícula na API de consulta. |
| Site | cliente vinculado + código (sem diferenciar maiúsculas) | Sites do mesmo código em outro cliente não casam. |
| Cargo | nome (sem diferenciar maiúsculas) na empresa padrão | |
| Feriado | mesma data, feriado do Field ainda sem vínculo | |
| Usuário | e-mail | Pelo `user.*` e pelo `axis_sync` (`GET /integration/users`). |
| Projeto | `axis_project_id` já gravado | Quem grava é o `project.approved` (§4). |

Sem par: o registro é **criado** (MI-01; regras na §3.1). **Ambíguo** (mais de um candidato) ou em conflito com um
registro já vinculado a outro id do Core (mesmo CNPJ na empresa, mesmo código de site no cliente, mesmo nome de cargo)
**fica sem vínculo e aparece no relatório**, com o motivo; nada é apagado.

### 3.1 O Core manda (onda V3: MI-01 e MI-02)

Código: `axis_integration/apply.py` (criação e aplicação) e `core/axis_lock.py` (lista dos campos bloqueados).

**Criação (MI-01).** Só quando não há par e o registro está **ativo** no Core.

| Cadastro | Regra de criação | Empresa |
|---|---|---|
| Cliente | sempre (precisa de nome) | empresa padrão |
| Site | só no cliente já vinculado; precisa de código | a do cliente |
| Cargo | `job_title.*` ou o `job_title_id`/`job_title_name` do colaborador (a ordem dos eventos não importa) | empresa padrão |
| Colaborador | `job_title_is_technician = true` **ou** `management_level` ≠ `colaborador`; cria a `Person` (reaproveita uma `Person` com o mesmo e-mail que ainda não é técnico) | empresa padrão |
| Feriado | sempre (precisa de data) | — |
| Usuário | **não cria** (o login pelo Core, F1, está pendente; decisão 4 da V5) | — |

Empresa padrão: `AXIS_DEFAULT_COMPANY_ID` (id de `core.Company`), senão a primeira empresa ativa.

**Campos aplicados (e bloqueados, MI-02).** Só entra o campo que o Core mandou (evento parcial não apaga o resto).

| Field | Campos do Core (bloqueados no registro casado) | Do Field (continuam editáveis) |
|---|---|---|
| Cliente | razão social (`legal_name`/`name`), fantasia, CNPJ (formatado), e-mail, telefone, endereço (`address_street`, número, complemento, bairro e CEP numa linha), cidade, UF, ativo | empresa, tipo de pessoa, observações, responsáveis do cliente |
| Site | cliente, nome, código, endereço, cidade, UF, latitude/longitude (marcam `manual_coordinates`), ativo | regional, localizações internas |
| Técnico | nome, e-mail, telefone (na `Person`), matrícula (`matricula`), Yellow Badge, cargo, gestor (`supervisor_id`), ativo (`status != desligado`) | sites atendidos, empresa, usuário vinculado |
| Cargo | nome, ativo | descrição, empresa |

- **Gestor:** `supervisor_id` aponta para o colaborador do Field com esse `axis_collaborator_id`. Supervisor que ainda não
  está no Field deixa o gestor vazio; quando ele chega, os subordinados que o Core aponta passam a tê-lo como gestor.
- **Coordenadas:** o site é gravado com `update()`/`bulk_create()`, sem passar pelo `save()` que geocodifica pela
  internet. Coordenada do Core vira `manual_coordinates`, então a geocodificação do Field não a sobrescreve; site do
  Core sem coordenada fica sem, até um `save()` pelo Field (ou "Reprocessar geocodificação") geocodificar o endereço.
- **Férias e afastamento:** o Core manda só a situação (`status`), sem datas. O Field guarda em
  `Collaborator.axis_status` (mostrado na tela do técnico) e **não cria `TechnicianAbsence`**: a ausência continua
  sendo lançada na Operação do Dia. Quando o Core mandar o período, isso vira ausência (D7, parcial).
- **Usuário:** `disabled` no Core = `is_active = False` no Field (e volta a `True` quando o Core reativar).
- **Feriados:** `projects/sites_panel.py` conta dia útil como segunda a sexta **menos** os `core.Holiday` ativos
  ("projeto parado há N dias úteis" e "último dia útil" das atualizações ao cliente).

**Bloqueio (MI-02).** Registro com `axis_*_id`:

- **Cadastros Gerais** (`EntityCrudPanel`): a API devolve `axis_*_id` e `axis_locked_fields`; o formulário mostra
  "Mantido no Axis Core", desabilita esses campos e mostra a situação no Core do técnico. A lista troca excluir/inativar
  pelo ícone do Core.
- **API** (`/api/registry/clients|sites|collaborators|job-titles/`): valor diferente num campo bloqueado → `400`
  "Mantido no Axis Core: altere este dado no Core." (valor igual passa, porque o formulário manda o registro inteiro);
  excluir registro casado → `400`.
- **CSV:** a importação só cria registros novos (sem vínculo); não completa nome, e-mail nem telefone da `Person` de um
  técnico casado.
- **Django admin:** os campos do Core ficam somente leitura, com aviso na tela (Cliente, Site, Técnico, Cargo);
  feriado vindo do Core também.

Registro **sem vínculo** continua todo editável até casar. Catálogos só do Field (`master_data.*`, `Region`, `Company`,
`CollaboratorPair`) não mudam (D6 e D8 ficam para a V5).

### Carga inicial: `manage.py axis_sync`

```bash
docker compose run --rm field-backend python manage.py axis_sync
docker compose run --rm field-backend python manage.py axis_sync --resources clients sites
docker compose run --rm field-backend python manage.py axis_sync --report-only --json
```

Lê `GET /integration/{job-titles,clients,collaborators,users,projects,cost-centers,sites,holidays}` (paginado,
`Authorization: Bearer <AXIS_API_KEY>`; `job-titles`, `users` e `holidays` são do contrato V1), grava no cache, casa,
**cria o que falta e aplica os campos do Core** (§3.1) e imprime o relatório: quantos foram lidos, vinculados e
criados por recurso; registros do Core sem par (com o motivo: ambíguo, inativo, "nem técnico nem gestor", usuário sem
par…) e registros **ativos** do Field sem par. Recurso que o Core ainda não tem (`404`) vira "indisponível" e não
interrompe os outros; erro de API key termina com código de saída ≠ 0 depois de processar o resto. `--report-only`
não consulta o Core, mas reaplica casamento, criação e campos a partir do cache. Pode ser rodado de novo sem duplicar
nada. Evento mais novo que a consulta prevalece sobre ela.

### Variáveis (`lgc-dev-field/.env.example`)

`AXIS_WEBHOOK_SECRET`, `AXIS_WEBHOOK_MAX_AGE_HOURS`, `AXIS_API_URL` (termina em `/api/v1`), `AXIS_API_KEY`,
`AXIS_API_TIMEOUT`, `AXIS_DEFAULT_COMPANY_ID` (empresa que recebe o que vem do Core; vazia = primeira ativa), `FIELD_INTEGRATION_API_KEY` (chave que o Financeiro envia em `X-Api-Key`, §5.4); PT-08: `AXIS_OUTBOUND_SECRET`, `AXIS_OUTBOUND_TIMEOUT`, `AXIS_OUTBOUND_MAX_ATTEMPTS`,
`AXIS_OUTBOUND_IMMEDIATE`, `AXIS_BACKGROUND_TASKS`, `AXIS_SOW_DOWNLOAD_TIMEOUT`, `AXIS_SOW_MAX_MB`. No Core, o satélite Field
precisa ter o segredo HMAC igual a `AXIS_OUTBOUND_SECRET` e assinar `project.approved` (apontando o webhook para o Field). No Core, o satélite precisa assinar os eventos da tabela acima e apontar o webhook para
`<url do Field>/api/v1/webhooks/axis`; depois, o botão **Integrações → Reenviar cadastros** reenvia
os cadastros (com o contrato V1 também clientes, projetos, usuários, cargos e feriados); o `axis_sync` faz o mesmo pela
API de consulta.

## 4. F4 — Projeto aprovado vira obra (PT-08)

**Implementado** (`axis_integration/obra.py` e `sow_plan.py`; decisões PA-06 e PA-17 do plano). Gatilho:
`project.approved`, que o Core emite quando o comercial muda o projeto de `proposta` para `aprovado` (PA-01). **Um
projeto do Core = um site = uma obra** (PA-06): proposta com vários sites vira vários projetos no Core.

### 4.1 Criar ou vincular a obra

Roda na transação do webhook (o evento só é dado como processado se a obra foi gravada). Se já existe obra com o
`axis_project_id`, ela é reaproveitada (só atualiza o cache do centro de custo): evento repetido ou reaprovação não
duplica, e há restrição de unicidade no banco contra corrida.

| Campo da obra (`projects.Project`) | Origem no evento |
|---|---|
| `axis_project_id` | `project_id` |
| `name` | `name` |
| `status` | sempre `planning` (PA-17) |
| `client` | cliente do Field com `axis_client_id` = `client_id` |
| `site` | site do Field com `axis_site_id` = `site.site_id` (se for de outro cliente, não é usado) |
| `responsible_cstr` | `Responsible` (tipo CSTR) da pessoa do colaborador com `axis_collaborator_id` = `responsible_collaborator_id` |
| `planned_start`, `planned_end` | `accepted_quote.planned_start_date/end_date` (senão, as datas do projeto) |
| `po` | `client_po_number` |
| `planned_team` (JSON, campo novo) | `accepted_quote.team[]` como veio: `{role_key, role_name, field_role, people, days, hours}` |
| `axis_cost_center_id` | `cost_center_id` |
| `axis_sow_document_id` | `accepted_quote.sow_document_id` |
| `company` | a do cliente; senão a da pessoa responsável; senão a primeira empresa ativa |

O código da obra continua sendo o do Field (`CSTR-PROJ-…`); o código do Core (`PROP-…`) vai na descrição.

**Sem par, a obra é criada mesmo assim** (o evento nunca se perde): cliente, site ou responsável que o Field não
casa viram **pendências** em `Project.axis_pending_issues` (lista de textos), mostradas na tela do projeto, na API
(`GET /api/projects/:id/`, somente leitura) e no admin, e cada administrador (superusuário ativo) recebe a
notificação in-app "Obra criada com pendências". Depois de casar os cadastros (`axis_sync`), ajuste cliente, site e
responsável no cadastro do projeto; o texto da pendência fica como histórico.

### 4.2 Plano automático da SOW (PA-17)

Roda **depois do commit** do webhook, em thread (`AXIS_BACKGROUND_TASKS`), sem travar a resposta ao Core. É
idempotente: a obra passa de `sow_plan_status = pending` para `processing` por `UPDATE` condicional, então duas
execuções não processam a mesma obra. Se a thread não rodar (processo reiniciado), `manage.py axis_sow_plan` retoma o
que ficou `pending` ou `processing` há mais de 15 min.

1. **Baixa o PDF** com `GET {AXIS_API_URL}/integration/projects/:id/documents/:documentId/content` e a API key do
   satélite (limites `AXIS_SOW_MAX_MB` e `AXIS_SOW_DOWNLOAD_TIMEOUT`); extrai o texto com `pypdf`.
2. Cria o **`SowImport` ligado à obra** (`Project.sow_import`) e roda o parser **determinístico**. A IA fica
   desligada no modo automático (`process_sow_import(..., use_ai=False)`), mesmo que `AI_API_KEY` esteja configurada.
3. **Todos os itens sem aviso** (`warnings` vazio, sem `requires_review`, cabo com família e quantidade): aprova os
   itens, finaliza a importação, resolve os templates, gera as tarefas e as envia ao projeto, sozinho →
   `sow_plan_status = generated`.
4. **Qualquer item com aviso, ou item de escopo sem template**: para na etapa pendente do Fluxo Guiado (a nota diz
   qual: Revisar Itens, Resolver Templates ou Gerar Tarefas, e qual importação) → `pending_review`, e o **responsável
   da obra** (ou, sem responsável com usuário, os administradores) recebe a notificação in-app "Plano da SOW pendente
   de revisão". Quem revisa continua em Cadastros Mestres > Fluxo Guiado (SOW), com a importação já criada.
5. **Falha** de download, leitura do PDF (escaneado, corrompido), parse ou erro inesperado → `failed`, com o motivo
   em `sow_plan_note` e notificação ("Plano da SOW falhou"). A obra continua criada.

`sow_plan_status` na obra: `pending`, `processing`, `generated`, `pending_review`, `failed`, `no_sow` (o Axis não
informou `sow_document_id`). Só os quatro últimos vão ao Core. Decisão de implementação: "sem aviso" é estrito
(também `MISSING_LENGTH` e os demais avisos não críticos mandam a SOW para revisão); afrouxar é mudar `_item_is_clean`
em `sow_plan.py`.

## 5. F5 — Field → Core (PT-08)

**Implementado no Field e no Core.** O Core recebe em `POST /api/v1/integration/inbound` (PT-02) e trata os quatro eventos
com o `FieldProjectHandler` (PT-09, [cadastros.md §10.4](dominio/cadastros.md#104-obra-no-field-pt-09)).

### 5.1 Outbox e entrega

Os eventos entram em `axis_integration_axisoutboxevent` **na mesma transação** da escrita de negócio (regra 6 do
AGENTS.md). O despacho tenta **logo depois do commit** (thread, `AXIS_OUTBOUND_IMMEDIATE`) e
`manage.py axis_outbox_dispatch` reenvia os pendentes com **backoff exponencial** (30 s, 1 min, 2 min… até 1 h);
após `AXIS_OUTBOUND_MAX_ATTEMPTS` (12) falhas o evento vira `dead` (visível no admin; `--retry-dead` reabre).

- **Envelope:** `{event_id, event_type, occurred_at, source: "field", payload}`.
- **Cabeçalhos:** `Idempotency-Key` (= `event_id`), `X-Field-Signature: sha256=<hex>` (HMAC-SHA256 do corpo bruto
  enviado, com `AXIS_OUTBOUND_SECRET`, o segredo HMAC do satélite Field cadastrado no Core) e
  `Authorization: Bearer <AXIS_API_KEY>`. Com a API key o guard do Core (`SatelliteInboundGuard`) identifica o
  satélite e confere a assinatura contra o segredo **dele**; sem ela, o guard testaria todos os segredos ativos.
- Reenviar o mesmo evento é seguro: o Core deduplica por `(satélite, event_id)`. Sem `AXIS_OUTBOUND_SECRET` ou
  `AXIS_API_URL`, os eventos ficam na fila sem gastar tentativas.

### 5.2 Eventos (contrato fixo; o Core consome desde o PT-09)

Todos levam `axis_project_id` (UUID do projeto no Core) e `field_project_id` (id da obra no Field, inteiro).

| Evento | Quando | Campos além dos dois ids |
|---|---|---|
| `field.project.created` | Obra criada e plano da SOW concluído (ou `no_sow`). Sai **depois** do plano, para já levar a situação final | `field_project_code` (`CSTR-PROJ-…`), `url` (`{FRONTEND_URL}/projetos/:id`; relativa se `FRONTEND_URL` vazia), `status` (`planning`), `sow_plan_status` (`generated`, `pending_review`, `failed` ou `no_sow`), `tasks_count`, `created_at` |
| `field.project.started` | Primeira tarefa iniciada (uma vez por obra) | `started_at` (início real da tarefa) |
| `field.project.progress` | Diário (`manage.py axis_progress_snapshot`) e quando a SOW gera as tarefas | `date` (`AAAA-MM-DD`, São Paulo), `percent_complete` (0–100), `tasks_total`, `tasks_done`, `real_man_hours`, `planned_man_hours` |
| `field.project.completed` | Todas as tarefas não canceladas concluídas (uma vez por obra) | `completed_at` |

- `tasks_total`, `tasks_done` e `percent_complete` **ignoram tarefas canceladas** (mesma conta do Painel de Sites).
- `real_man_hours`: **regra 1 do CLAUDE.md §8**, soma das horas reais de cada técnico (`ProjectTask.real_man_hours`,
  descontadas as pausas), nunca duração × técnicos; horas de tarefa cancelada contam porque foram trabalhadas.
- `planned_man_hours`: soma de `hours` das funções de campo de `planned_team` (`field_role` falso fica de fora;
  ausente conta como campo).
- `started` e `completed` são marcados em `Project.axis_started_at/axis_completed_at` por
  `UPDATE ... WHERE <marca> IS NULL` na mesma transação do evento: repetir não duplica. Os sinais cobrem o `save()`
  da tarefa; `.update()` em massa não dispara sinal, e o comando diário refaz a checagem.
- O comando diário gera um `progress` por obra e dia; rodar de novo no mesmo dia só gera outro se algum número mudou.
  Ignora obra cancelada, concluída e sem tarefas.

O Core mostra o que recebe na etapa "Obra no Field" da jornada do projeto (link, plano da SOW, tarefas, % e HH real × previsto; [cadastros.md §10.5](dominio/cadastros.md#105-jornada-do-projeto-pt-11)). O link usa o `url` do `field.project.created`; se ele vier relativo (`FRONTEND_URL` vazia no Field), o Core o junta ao `frontend_url` do satélite Field e, sem essa base, não mostra link.

### 5.3 Agendar (VPS)

```bash
docker compose exec -T field-backend python manage.py axis_outbox_dispatch   # a cada minuto
```

```bash
docker compose exec -T field-backend python manage.py axis_sow_plan          # a cada 10 min (retoma SOW pendente)
```

```bash
docker compose exec -T field-backend python manage.py axis_progress_snapshot # 1x por dia, no fim do expediente
```

### 5.4 Horas reais para o Financeiro (PT-10)

Não passa pelo Core: o Financeiro consulta o Field direto (mesmo padrão do consumo da Logística).

`GET /api/integration/labor-hours?from=AAAA-MM-DD&to=AAAA-MM-DD` com o cabeçalho `X-Api-Key`
(`FIELD_INTEGRATION_API_KEY`; sem a variável a rota responde `503`, chave errada `401`, período inválido ou
acima de 62 dias `400`). Resposta: lista de
`{ axis_project_id, axis_collaborator_id, date, hours, adjusted }`.

- **Fonte:** a mesma do HH do projeto (regra 1): o `actual_hours` de cada despacho (`ProjectTaskAssignment`),
  que já desconta as pausas. Tarefa com apontamento completo mas sem horas por técnico (dado histórico)
  segue o mesmo fallback do `real_man_hours`: cada técnico vinculado recebe as horas de relógio da tarefa.
- **Dia:** São Paulo. Despacho que atravessa a meia-noite reparte as horas pelos dias na proporção do tempo
  de execução de cada um, com arredondamento a 2 casas que preserva o total do despacho.
- **Fora:** tarefa sem técnico vinculado (regra 8), horas da planilha do supervisor (`ProjectHourEntry`,
  regra 9) e despacho ainda aberto (sem término).
- **`adjusted`:** `true` quando algum despacho do dia (técnico × projeto) teve ajuste de timeline.
- **`hours`:** string decimal com 2 casas; uma linha por (projeto, técnico, dia).
- **Vínculo:** só entram projetos com `axis_project_id` e colaboradores com `axis_collaborator_id`. O que
  ficou de fora por falta de vínculo é somado por motivo (`projeto_sem_vinculo`, `colaborador_sem_vinculo`)
  no log do Field (`WARNING`) e no cabeçalho de resposta `X-Unlinked-Hours`, não na lista.

Contrato e tratamento no Financeiro: [integracao-centros-de-custo.md](integracao-centros-de-custo.md).
Sem migração nova.

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
3. ~~Status de nascimento da obra e relação proposta → obras~~ — decididos pelo plano do projeto aprovado: `planning` (PA-17) e um projeto = um site = uma obra (PA-06). Falta decidir quem cadastra a obra quando **não** há proposta no Core (hoje continua a criação manual no Field, sem `axis_project_id`).
4. **Identidade visual completa:** adotar `axis-tokens.css`/`axis-shell.css` no frontend do Field
   (hoje só nome, logotipo e ícones são do Axis).
5. ~~**Efeito dos eventos sobre dados do Field**~~ — decidido em 2026-11-08 pela MI-01 e MI-02
   ([mapa-interoperabilidade.md §5](mapa-interoperabilidade.md#5-decisões-do-dono-do-produto)) e implementado na onda
   V3 (§3.1): o Core cria e atualiza cliente, site, cargo, técnico/gestor (com a hierarquia) e feriado; desligado vira
   inativo; usuário desativado no Core vira inativo no Field; os campos do Core ficam bloqueados no registro casado.
   Pendente: criar usuário no Field (depende do F1) e transformar férias/afastamento em ausência (o Core não manda as
   datas).

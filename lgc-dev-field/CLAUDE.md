# ERP CSTR — Guia completo para o Claude Code

> **Atenção (2026-11-08): este sistema agora é o satélite Axis Field dentro do repositório do Axis.**
> Valem primeiro as regras do [AGENTS.md](../AGENTS.md) da raiz (um commit e um PR por escopo, nada de
> push direto na `main`, documentação junto com o código). Neste guia continuam valendo as regras de
> negócio (§7, §8) e as convenções de código. **Não siga** as §9 (deploy), §10 (testes no servidor) e
> §11 (git/auto-commit): elas descrevem o repositório antigo `erp-cstr` e a produção atual, que não sai
> deste repositório até a migração. Serviços, portas e integração com o Core: [README.md](README.md) e
> [../docs/integracao-core-field.md](../docs/integracao-core-field.md).

Sistema ERP interno da **Consultimer Group** para gestão de obras de **cabeamento estruturado e redes ópticas em data centers hyperscale**. Este arquivo é a fonte única de contexto: leia inteiro antes de mexer em qualquer coisa.

> **O repositório do GitHub é PÚBLICO.** Nada neste arquivo (nem em qualquer arquivo commitado) pode conter IP de servidor, usuário/senha, chave, token, `.env` ou dado pessoal. Detalhes de infraestrutura e acesso à VPS ficam em **`CLAUDE.local.md`** (raiz do projeto, ignorado pelo Git, carregado automaticamente). Se ele não existir na sua máquina, peça ao Rafael.

## 0. Mapa dos arquivos de contexto

| Arquivo | O que tem |
|---|---|
| `CLAUDE.md` (este) | Visão geral, features, regras de negócio, deploy, testes, git, segurança |
| `CLAUDE.local.md` | **Não versionado.** Acesso à VPS, aliases SSH, OpenClaw, Telegram, credenciais (só nomes/locais, nunca valores) |
| `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `bot/CLAUDE.md` | Detalhes por módulo (herdam este) |
| `.claude/skills/deploy/SKILL.md` | Skill `deploy` (procedimento de deploy na VPS) |
| `memory/` | "Segundo cérebro" de negócio versionado: `glossario.md`, `clientes/`, `sites/`, `pessoas/` |
| `docs/` | Documentação detalhada (índice na seção 15) |

Ao aprender algo novo de negócio (cliente, site, sigla, pessoa), registre em `memory/` em vez de deixar só na conversa. Consulte `memory/glossario.md` antes de responder sobre termo desconhecido.

## 1. Quem é o usuário e como trabalhar com ele

- **Rafael Baladioffa** — supervisor de implantação de redes ópticas/cabeamento em DCs hyperscale. Fala em termos de **operação de obra e campo**, não de software. Responda em **português do Brasil**.
- Prefere entregas objetivas e executivas; acompanha % de avanço, evolução diária, marcos, HOLDs, riscos e desvios.
- Instrução específica do Rafael deve ser seguida; decisões já tomadas não se rediscutem. Para ações que alteram produção, enviam mensagens a terceiros ou são difíceis de reverter, **confirme antes** (autorização dada uma vez não vale para a próxima).
- Não presuma pronomes de ninguém; use construção neutra quando não estiverem informados.

## 2. Stack e versões

| Camada | Tecnologia |
|---|---|
| Backend | **Django 5.2.5** + DRF 3.15.2, simplejwt 5.3.1 (blacklist), django-axes 8.3.1, django-unfold 0.94 (admin), gunicorn 23, whitenoise, reportlab (PDF), pywebpush, pypdf, requests |
| Frontend | React 18.3 + TypeScript 5.5 + Vite 5.4 + React Router 6.26 + Leaflet (mapa). **Sem** Redux, Tailwind, CSS Modules nem lib de gráficos |
| Bot | Node 22 + Baileys 6.7 (WhatsApp Web) + Puppeteer Core/Chromium |
| Banco | **PostgreSQL 17** (alpine). Driver psycopg 3 |
| Infra | Docker Compose (monorepo), **produção em uma VPS Linux (Ubuntu)**; site publicado por túnel **Cloudflare** |
| IA | OpenRouter (opcional, só na importação de SOW, sempre com revisão humana) |

Idioma: textos de UI em **pt-BR** (com en-US e es-ES via `usePageText`); identificadores de código em inglês. Fuso do Django: `America/Sao_Paulo` com `USE_TZ=True` (banco em UTC). **O bot usa UTC−3 fixo**, sem `tzdata`: nunca instale pacote de timezone no bot, use `formatBrazilDateTime()`.

## 3. Arquitetura de produção

```
Internet ─► Cloudflare ─► container cloudflared (túnel)
                              ├─ projetosconsultimer.com      ─► frontend  (nginx, SPA)   :5173
                              └─ api.projetosconsultimer.com  ─► backend   (gunicorn)     :8000
backend  ─► db (postgres:17, sem porta publicada, volume postgres_data)
whatsapp-bot (Node, :3001 só em 127.0.0.1) ─HTTP interno─► backend /api/bot/*
```

- Serviços Compose (`compose.yaml` + overlay `compose.prod.yaml`): **`db`, `backend`, `frontend`, `whatsapp-bot`**. O `cloudflared` roda como container à parte (fora do compose do projeto).
- `compose.prod.yaml`: backend roda `gunicorn config.wsgi:application --workers 3 --threads 4 --worker-class gthread --timeout 60`; frontend usa `Dockerfile.prod` (nginx servindo o build).
- **A URL da API do navegador é fixada NO BUILD** (`VITE_API_URL` ← `FRONTEND_API_URL`). Mudou o domínio da API? É preciso **rebuild do frontend**, não basta recriar.
- O `entrypoint.sh` do backend, a cada início do container, executa: `migrate --noinput`, mescla traduções, `compilemessages` (o aviso de **permissão ao gravar `django.mo` é esperado e inofensivo**), `collectstatic`, `ensure_superuser`. Ou seja: **migrações são aplicadas sozinhas no deploy**.
- Volumes: `postgres_data` (**nunca destruir**), `media_data` (uploads), `static_data`, `whatsapp_auth` (sessão do WhatsApp).
- Sem Celery/Redis/scheduler interno: tarefas agendadas rodam no bot (setInterval) ou em cron do servidor (backup).
- Observado em out/2026: o Cloudflare devolveu **403 para um cliente `Python-urllib`** na URL pública. Scripts rodando no servidor devem falar direto com o backend em `127.0.0.1:8000`, não pela URL pública.
- Detalhes de acesso, usuários, caminhos e rotinas do servidor: ver `CLAUDE.local.md`.

## 4. Estrutura do repositório

```
backend/    Django (apps por domínio)         frontend/  React + Vite + TS
bot/        Node: bot WhatsApp (index.js)      docker/    Dockerfiles, entrypoint, backup, mailserver
docs/       documentação                       memory/    segundo cérebro de negócio
compose.yaml / compose.prod.yaml / compose.monitoring.yaml / compose.zabbix.yaml
```

## 5. Backend (Django)

### 5.1 Apps e modelos

| App | Modelos / conteúdo | Responsabilidade |
|---|---|---|
| `core` | Company, Client, Site, Person, Collaborator, Responsible, JobTitle, Category, ProjectType, Task (catálogo), Notification, PushSubscription | Cadastros base, escopo de acesso (`access_scope.py`, `collaborator_scope.py`), CSV, geocodificação, e-mail |
| `users` | User (AbstractUser: `email` único, `company`, `client`, `client_sites`, `client_categories`, `manager_sites`, `must_change_password`) | Autenticação e perfis |
| `projects` | Project, ProjectTask, ProjectTaskAssignment, RackPosition, ProjectOccurrence, ProjectAttachment, ProjectProgressSnapshot | Projetos e tarefas; `services.py`, `analytics.py`, `sites_panel.py`, `signals.py` |
| `dispatch` | TechnicianDailyPresence, TechnicianStatusEvent, TimelineAdjustment, CollaboratorPair, TechnicianAbsence, WorkBlock | Presença, status, apontamento por bloco (`blocks.py`) e ajustes de timeline (`adjustments.py`) |
| `technical` | MyTask (proxy de ProjectTask) | Permissão e visão do técnico |
| `updates` | DailyUpdate (+Allocation), ProjectDailyUpdate | Alocação diária; atualização de projeto ao cliente (e-mail/PDF) |
| `bot` | BotSubscriber (+templates/regras de broadcast) | Endpoints `/api/bot/*`, prints Puppeteer |
| `audit` | AuditLog | Diff automático por signal (`AUDITED_APPS`: core, projects, updates, users, master_data; `dispatch` NÃO) |
| `master_data` | Catálogo técnico + importação de SOW + **fluxo guiado de cabos** | Ver 7.8 |
| `api` | views, serializers, permissions, urls, `operations.py`, `dashboard.py`, `reports.py`, `block_times.py`, `management_report.py`, `indicators.py`, `adjustments.py`, `work_blocks.py`, `sites_panel.py` | **Todos os endpoints REST** |

Modelos herdam `TimestampedModel` (`created_at`/`updated_at`); no catálogo mestre, `MasterDataModel` (+`created_by`/`updated_by`).

### 5.2 Camadas e convenções

`urls.py → permissions.py → views.py → serializers.py → services.py → models.py`. Views finas; **lógica de negócio em services** (ex.: `projects/services.py`, `master_data/services/*`). Pagination `PageNumberPagination` (`page_size` padrão 25, máx. 500). `.update()` em massa **pula** `save()`/signals — cuidado.

**Migrações sempre aditivas**: nunca remover coluna/tabela sem período de deprecação (ex.: as tabelas do antigo `CableImport` foram mantidas de propósito). Padrão: adicionar `null=True`, migrar dados, tornar obrigatório depois.

### 5.3 Autenticação, permissões e escopo de dados

- JWT: `POST /api/token/` (access 8 h, refresh 7 d, rotação + blacklist), `/api/token/refresh/`, `/api/token/logout/`. Throttle `5/min` no login + **django-axes** (5 falhas → bloqueio 30 min por usuário+IP; **bloqueio devolve 403**).
- `must_change_password` (ligado em usuário novo) força a tela de troca antes de liberar o sistema.
- Sessão do Django/admin: 10 min de inatividade. Tokens do SPA ficam em `sessionStorage`.
- Autorização: `ViewAwareModelPermissions` (DjangoModelPermissions + exige `view_<model>` em GET). Mixins `RequireChangePermissionForActions` / `RequireViewPermissionForActions` para actions custom. **Usuário sem grupo/permissão consegue logar mas vê telas vazias** — causa clássica de "não vejo nada".
- Perfis de escopo: superusuário e `is_staff` veem tudo; **Supervisor** (cargo contém "Supervisor") vê só a própria equipe (ele + subordinados diretos/indiretos via `Collaborator.manager`); **usuário-cliente** (`User.client`) vê só projetos do cliente, filtrável por `client_sites`/`client_categories`; **gestor de site** (`User.manager_sites`) vê só esses sites. Técnico usa `technical.change_mytask`.
- Endpoints do bot: `X-Bot-Secret` (`BotSharedSecretPermission`, `hmac.compare_digest`), independente do JWT.
- **Ajustes administrativos de timeline: somente superusuário** (`IsSuperUser`).

### 5.4 API REST (base `/api/`)

| Área | Endpoints principais |
|---|---|
| Auth/usuário | `token/`, `token/refresh/`, `token/logout/`, `me/`, `me/change-password/`, `password-reset/request\|confirm/`, `user-options/` |
| Projetos | `projects/` (filtros `status`, `search`), actions `tasks`, `hours-by-collaborator`, `rack-positions`, `import-tasks`, `tasks/bulk`; `project-tasks/`; `project-occurrences/`, `project-attachments/`, `rack-positions/` |
| Despacho | `project-tasks/{id}/dispatch/`, `undispatch/`, `return-to-pool/`, `project-tasks/dispatch-bulk/` |
| Operação | `operations/board/` (`site`, `date`), `operations/timeline/`, `operations/reports/`, `operations/reports/block-times/`, `operations/reports/management/`, `operations/adjustments/*` (superuser), `technician-presence/`, `technician-absences/`, `my-tasks/`, `my-tasks/block/` |
| Indicadores | `indicators/trends/`, `.../breakdown/`, `.../production/`, `dashboard/projects/`, `dashboard/technical/`, `dashboard/sites/` |
| Comunicação | `daily-updates/` (+`send-email`, `pdf`, `pdf-consolidado`), `project-updates/` (+`send-weekly`), `notifications/`, `push-subscriptions/` |
| Cadastros | `registry/*` (companies, categories, project-types, job-titles, sites, clients, responsibles, collaborators, tasks — CSV import/export) e leituras `clients/`, `sites/`, `collaborators/`, `regions/` |
| Catálogo mestre | `master-data/*` (cable-families, cable-aliases, cable-specs, activities, networks, workstreams, paths, sites, locations, device-types, task-templates, task-template-steps, task-template-rules, scope-items, generated-tasks, generated-task-dependencies) |
| Cabos guiado | `master-data/cable-wizard/options/` (GET), `.../preview/` (POST, não grava), `master-data/cable-wizard/` (POST, cadastra) — e o legado `master-data/cable-imports/`, `cable-import-items/` |
| Planejamento | `planning/sow-imports/`, `planning/sow-parsed-items/`, `planning/project-plan/`, `planning/ai/status\|test/` |
| Outros | `search/`, `audit-logs/` (superuser), `bot/*` |

## 6. Frontend (React SPA)

- Estado local (`useState`/`useEffect`) + `AuthContext`. HTTP **somente** via `src/api/resources.ts` (helper `crud<T>()`), tipos em `src/api/types.ts`; nunca `fetch` direto.
- **Textos em 3 idiomas** com `usePageText({ "pt-BR": {...}, "en-US": {...}, "es-ES": {...} })` — todo texto novo precisa dos três. Menu em `src/i18n/pt-BR.ts`.
- **CSS puro em `src/index.css`**. Variáveis de cor **reais**: `--orange` (primária), `--blue`, `--green`, `--red` (+ `-soft`), `--border`, `--text-muted`, `--bg`. **NÃO existem** `--primary`, `--success`, `--danger`, `--warning` (usar produz transparente). Temas: `light` e `dark` (`[data-theme="dark"]`); o antigo tema "Dark2" foi removido.
- Ícones: `<Icon name="..." />` (Material Symbols). Drag-and-drop nativo HTML5. Popups de barra renderizados na raiz do componente (fora de `overflow:hidden`).
- Permissões: `src/utils/permissions.ts` (`PERMS`, `modelPerms()`, `hasPerm`), `RequirePermission` por rota em `App.tsx`.

### Rotas / telas

| Rota | Tela | Para que serve |
|---|---|---|
| `/operacao-do-dia` | OperationsBoard | **Central de despacho**: pool, técnicos, despacho, ausências |
| `/timeline-operacional` | TimelineOperacional | Gantt por técnico no dia (+ ajustes de superusuário) |
| `/relatorios-indicadores` | OperationsReports | Relatórios v2: Hoje + Período, HH, utilização, tempo por atividade/unidade |
| `/relatorios-indicadores/gerencial` | ManagementReport | Relatório gerencial em slides 16:9 (PDF pelo navegador) |
| `/indicadores/tendencias` | IndicatorsTrends | Tendências: Operação, Produção, Comparativos, Qualidade (14 gráficos) |
| `/gestao-sites` | SitesPanel | Painel de carteira por site/regional/cliente/responsável |
| `/sites/mapa` | SitesMap | Mapa Leaflet dos sites |
| `/dashboard` | Dashboard | Performance de projetos e técnicos + atalhos |
| `/projetos`, `/projetos/:id` | ProjectsList / ProjectDetail | Kanban/lista; detalhe com tarefas em pacotes, racks, ocorrências, anexos, horas |
| `/atualizacoes-diarias` | DailyUpdates | Alocação diária (texto "ATUALIZAÇÃO DIÁRIA", PDF, e-mail) |
| `/atualizacoes-projeto` | ProjectUpdates | Atualização do projeto ao cliente + resumo semanal |
| `/minhas-tarefas` | MyTasks | Visão do técnico: execução em tempo real |
| `/cadastros` | CadastrosPage | CRUD genérico por `EntityConfig` |
| `/cadastros-mestres` | MasterDataPage | Catálogo técnico + **Fluxo Guiado (SOW)** + **Cadastro Guiado de Cabos** |
| `/bot-whatsapp` | BotWhatsApp | Assinantes, modelos de mensagem, regras de envio |
| `/auditoria` | AuditLog | Log de alterações (superusuário) |
| `/login`, `/redefinir-senha/...` | Login / ResetPassword | Acesso; `ForcePasswordChange` quando exigido |

## 7. Features — como funcionam

### 7.1 Projetos e tarefas
`Project` (código `CSTR-PROJ-{ANO}{seq4}` imutável; `status`: planning, not_started, in_progress ("Ativo"), paused, completed, canceled; `responsible_cstr` da Consultimer; `po`; site deve pertencer ao cliente). `ProjectTask` = unidade de trabalho (origem `MANUAL` ou `SOW_TEMPLATE`), com `ProjectTaskAssignment` por técnico (cronometragem individual: `assignment_start/end`, pausas, `actual_hours`, `queue_order`, `dispatched_at`). Tarefas do projeto aparecem **agrupadas em pacotes** (atividade + grupo de material / cabo), recolhíveis, com seleção do pacote inteiro.

### 7.2 Operação do Dia (alocação/despacho de técnicos)
Filtro por **site** e **data**. Mostra indicadores (planejadas, ativas, concluídas, pendentes, técnicos em campo, ausentes), o **pool** (atividades sem técnico, agrupável em pacotes por atividade/cabo, com etapa anterior pendente destacada) e a lista de **técnicos**. Despachar = escolher tarefas do pool + técnicos (`dispatch-bulk`). **Remover despacho** devolve a tarefa ao pool; **devolver ao pool para um técnico zera o tempo que ele já apontou** (confirmar antes!). Técnico em ausência (`TechnicianAbsence`) não recebe despacho.

### 7.3 Presença, status e timeline
`TechnicianDailyPresence` (1 por técnico/dia) com status: `not_started, available, in_progress, lunch, personal, meal, meeting, traveling, support, site_blocked, awaiting_release, off_duty`. Toda troca grava `TechnicianStatusEvent` (base da timeline). `site_blocked`/`awaiting_release` pausam as tarefas em andamento. O primeiro status do dia é o check-in. Timeline: barras por técnico a partir de tarefas + eventos (`frontend/src/utils/timeline.ts`).

### 7.4 Apontamento por bloco (WorkBlock)
No DC o técnico não usa celular durante o trabalho: aponta **nos intervalos** (entrada, café, almoço, saída), informa o período e as tarefas feitas; o sistema reparte o tempo entre elas, em sequência e sem sobrepor. As horas são **alocação (estimativa dentro do bloco)** — o despacho fica `time_allocated`. Um bloco = uma atividade + um **grupo de trabalho** da família de cabo (`CableFamily.work_group`: COPPER_CAT6, FIBER_2F, TRUNK_LC_SMALL/LARGE, TRUNK_MPO, BREAKOUT, AOC). Endpoints `my-tasks/block/` e `my-tasks/block/suggestion/`.

### 7.5 Ajustes de timeline (superusuário)
Em `dispatch/adjustments.py`: o admin grava exatamente o que o técnico gravaria (intervalos de execução, trocas de status). **Todo ajuste exige motivo**, é marcado `is_adjusted` e registrado em `TimelineAdjustment` com antes/depois; as horas valem para todos os indicadores.

### 7.6 Relatórios e Indicadores (regras aprovadas — ver seção 8)
- **Relatórios v2** (`api/reports.py`): bloco Hoje antes do Período; HH, duração, equipe média; utilização; improdutivo; base de estimativa por atividade.
- **Tempo por unidade** (`api/block_times.py`): fonte confiável = blocos; sem bloco, o pacote é **inferido do despacho** (tarefas do mesmo técnico iniciadas/concluídas juntas, mesma atividade) e rotulado estimado; mostra também o **workflow por cabo** (soma dos minutos por cabo das etapas do template).
- **Tendências** (`api/indicators.py`) e **Relatório gerencial** (`api/management_report.py`) usam as mesmas definições, então os totais batem entre telas (há teste cobrindo).
- **Gestão de Sites** (`projects/sites_panel.py`): Visão geral (cards com semáforo), Análise (tabela, CSV), Regionais e exceções (mapa + fila). Limiares em `SITES_PANEL_THRESHOLDS`; cargos excluídos em `SITES_PANEL_EXCLUDED_JOB_TITLE_KEYWORDS`. Tarefas canceladas saem do painel. Capacidade × demanda está **fora do escopo**.

### 7.7 Atualizações diárias e comunicação
- `DailyUpdate` + `DailyUpdateAllocation`: **alocação diária** de técnicos por projeto (data padrão = amanhã). `build_description()` gera o texto oficial:
  ```
  ATUALIZAÇÃO DIÁRIA
  Data da alocação: DD/MM/AAAA
  PROJETOS:
  • {nome} ({código})
    PO: ...   Site: ...   Colaboradores: ...
  Enviado por: ...
  ```
  O `description` só é gerado ao **salvar** (serializer chama `refresh_description()`). Há PDF, PDF consolidado e envio por e-mail (`send-email`).
- `ProjectDailyUpdate`: atualização do projeto ao cliente (% , atividades, certificação, resumo), e-mail + PDF; resumo semanal em lote (`send-weekly` — **envia e-mail a clientes: confirmar antes**).
- Notificações in-app e Web Push (VAPID).

### 7.8 Cadastros Mestres (catálogo técnico)
Ordem: **Engenharia** (CableFamily, CableAlias, CableSpec, CertificationType, Activity), **Operação** (Network, Workstream, Path, TaskTemplate/Step/Rule + Simulador de Regras), **Infraestrutura** (Site mestre, Location, DeviceType), **Planejamento** (ScopeItem, GeneratedTask, dependências, Importar SOW, **Fluxo Guiado**, Plano do Projeto). Doc: `docs/cadastros-mestres.md`.

- **Fluxo Guiado da SOW** (5 etapas): Importar SOW → Revisar Itens → Resolver Templates → Gerar Tarefas → Enviar ao Projeto. `SowImport` (texto/arquivo; parser determinístico + IA opcional) → `SowParsedItem` → aprovação humana → `ScopeItem` → regra → `GeneratedTask` → `ProjectTask`. **A IA nunca grava sem revisão humana.**
- **Cadastro Guiado de Cabos** (`master_data/services/cable_wizard.py`, `components/master-data/CableWizardPanel.tsx`): passo a passo (meio → tipo → características → família → aliases → especificação → revisão). **Código e nome NUNCA são digitados — o servidor gera** pelo padrão do catálogo:

  | Item | Código | Nome |
  |---|---|---|
  | Fibra trunk/patch | `FIB-{n}F-{A}{B}` (conectores iguais de ≤2 letras unem: `LCLC`; senão hífen: `MPO-LC`, `MPO-MPO`) | `{n}F {A}-{B}` |
  | Robust | `FIB-{n}F-ROBUST` | `{n}F Robust` |
  | Breakout | `BRK-{A}-{pernas}{B}` | `{A} to {pernas}x{B} Breakout` |
  | AOC | `FIB-{vel}-AOC-{comp}` | `{vel}-AOC-{comp}` |
  | Cobre | `COP-{CAT}[-{blindagem}]` | `{CAT} {blindagem}` |
  | Especificação | `SPEC-{família sem prefixo}-{part number sem sufixo -XXXM}` | `{n}F {tipo fibra} {cor} {A}/{B} {A}-{polaridade}` |

  Regras: reaproveita **família equivalente** (cobre/AOC/breakout comparam pelo código gerado) em vez de duplicar; colisão de código com outra categoria → sufixo da categoria; sugere aliases nos formatos existentes (`8F LC-LC`, `8F LC/LC`, `8F LC<>LC`) e cadastra o part number como alias `PART_NUMBER`; sugere o `work_group` (usuário pode escolher "sem grupo" = `NONE`); tudo em **uma transação** (tudo ou nada); conflitos de alias/part number bloqueiam. Permissões herdadas de CableFamily/Alias/Spec. O fluxo antigo por texto (`cable-imports`) segue no backend sem uso na tela (candidato a remoção futura, respeitando a deprecação).

### 7.9 Bot WhatsApp
Baileys (sem API oficial), sessão persistida em `whatsapp_auth`. Menu interativo (1 Alocação, 2 Atualização de projetos, 3 Minhas tarefas, 4 Status dos técnicos). **Broadcasts agendados** (`setInterval` 60 s, 1×/dia por horário, UTC): 08h Print da Operação · 10h Tarefas do dia · 12h/14h/16h Prints · 15h Relatório de Projetos (texto) e 15h01 (imagem) · 17h Atualizações · 18h Alocação do dia seguinte. Prints via Puppeteer (`/operations-print`, relatório diário). Assinantes (`BotSubscriber`: telefone ou JID de grupo, flags por tipo de envio). Servidor HTTP :3001 só local, token `BOT_API_SECRET`. Detalhes: `bot/CLAUDE.md`.

### 7.10 Auditoria
`AuditLog` com diff campo a campo (usuário, origem, IP). Tela restrita a superusuário. `dispatch` não é auditado.

## 8. Regras de negócio aprovadas (não violar)

1. **HH (homem-hora) = soma das horas reais de cada técnico** (`ProjectTask.real_man_hours`, desconta pausas), nunca duração × nº de técnicos. É a base de faturamento, custo e estimativa.
2. Tempo por atividade mostra **três medidas separadas**: HH médio, duração média, equipe média.
3. **Estimativa por tipo de atividade** (HH por unidade), chave = Activity × família/spec de cabo; não agrupar por nome livre. Amostra mínima 5 execuções, **mediana**.
4. Conexões no ranking por técnico: **crédito proporcional às horas**.
5. **Utilização individual em horas de relógio**. Faixas: <50% vermelho, 50–69 âmbar, 70–100 verde, >100% "dado suspeito" (nunca "sobrecarga").
6. Dia sem Fim de Expediente: corta em check-in + 9 h e marca incompleto (exceto se o último status for `in_progress`).
7. Ocioso interno (Disponível): limite 30 min/técnico/dia. Bloqueio externo (site/cliente) sem limite.
8. Tarefa com apontamento mas **sem técnico vinculado não gera HH** (não assumir equipe de 1).
9. **Horas de planilha ("APONTAMENTO HORAS - SUPERVISOR") só entram no total do projeto**, nunca em métricas de técnico/atividade.
10. Horas reais exigem apontamento completo; duração planejada nunca vira hora real.
11. Em prod (out/2026) quase ninguém usava check-in/assignment, então Relatórios v2 aparece quase vazio até o processo de campo mudar.
Spec completa: `docs/features/relatorios-v2.md`; cálculo: `docs/calculo-de-horas.md`, `docs/ajuste-calculo-horas-reais.md`.

## 9. Deploy (produção = VPS)

**Aliases SSH** (definidos em `~/.ssh/config` do Rafael; IP/chave só no `CLAUDE.local.md`): `vps-deploy` (usuário com **docker** + sudo interativo) é o que se usa para deploy. `vps-openclaw` e `vps-claude` **não têm docker nem sudo**.

Repositório no servidor: `~/erp/erp-cstr` (usuário `deploy`), `origin` = GitHub via HTTPS.

**Procedimento (siga na ordem; build leva minutos → rode em segundo plano):**

```bash
# 0) Local: testes passando, commit e push na main (ver seção 11)

# 1) Backup do banco ANTES (ver "Backup" abaixo) — sempre que houver migração ou mudança relevante
ssh vps-deploy 'cd ~/erp/erp-cstr && docker compose exec -T db sh -c "pg_dump -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\"" > ~/erp/db_backups/pre-<feature>-$(date +%Y%m%d-%H%M).sql'

# 2) Atualizar código (ff-only; falha se houver divergência)
ssh vps-deploy 'cd ~/erp/erp-cstr && git pull --ff-only origin main && git log --oneline -1'

# 3) Build em segundo plano (backend e/ou frontend e/ou bot) com log
ssh vps-deploy 'cd ~/erp/erp-cstr && nohup sh -c "docker compose -f compose.yaml -f compose.prod.yaml build backend frontend > ~/erp/logs/build-<x>.log 2>&1; echo BUILD_EXIT=\$? >> ~/erp/logs/build-<x>.log" >/dev/null 2>&1 &'
#    acompanhar: ssh vps-deploy 'tail -3 ~/erp/logs/build-<x>.log'   (esperar BUILD_EXIT=0)

# 4) Recriar os serviços (migrate roda sozinho no entrypoint)
ssh vps-deploy 'cd ~/erp/erp-cstr && docker compose -f compose.yaml -f compose.prod.yaml up -d --force-recreate backend frontend && sleep 25 && docker compose ps'

# 5) Verificar
ssh vps-deploy 'cd ~/erp/erp-cstr && docker compose exec -T backend python manage.py showmigrations <app> | tail -3; docker compose exec -T backend python manage.py makemigrations --check --dry-run'
```

Verificação funcional sem escrever dados: use a API pelo próprio servidor (`127.0.0.1:8000`), endpoints de leitura/prévia, e confira `curl` 200 em `127.0.0.1:5173` e no site público.

**Regras e armadilhas:**
- **NUNCA** `docker compose down -v` (apaga o banco). `restart` **não relê o `.env`** — após mudar env use `up -d --force-recreate`.
- Mudou só `backend/bot/`? Rebuilde **`backend`**. Mudou o código Node em `bot/`? Rebuilde o serviço **`whatsapp-bot`** (o nome do serviço no Compose é `whatsapp-bot`; o `bot/CLAUDE.md` antigo chama de `bot`).
- `compose.yaml` na VPS tem **uma alteração local não commitada** (porta do frontend presa em `127.0.0.1:5173`). Não use `git reset --hard`/`checkout` nesse arquivo; ideal é commitar essa mudança.
- Se um deploy "não mudou nada", o build pode ter falhado em silêncio e o container subiu com a **imagem antiga** — confira `BUILD_EXIT` e a imagem.
- Frontend: lembre que `VITE_API_URL` é embutido no build.
- **Backup**: cron diário 03:00 BRT (`~/erp/bin/backup-db.sh`): `pg_dump` custom, valida com `pg_restore -l`, mantém 14 dias e copia para o Google Drive via rclone. Atenção: o `client_id` compartilhado do rclone/Drive será **aposentado em 2026** — criar o próprio antes de quebrar.
- Rollback: `git revert` + novo deploy; para dados, restaurar o backup (nunca recriar o volume).
- A skill `deploy` (`.claude/skills/deploy`) contém este procedimento.

## 10. Testes

**Produção/servidor (suíte completa):**
```bash
ssh vps-deploy 'cd ~/erp/erp-cstr && docker compose exec -T backend python manage.py test'
```
(~700 testes; rodar antes de deploy relevante. Atenção: alguns testes tocam geocodificação e geram ruído/429 do Nominatim se rodados sem rede controlada.)

**Local no Windows (Postgres não disponível):** use venv fora do repositório + settings de teste com SQLite:
```bash
python -m venv <tmp>/venv && <tmp>/venv/Scripts/python -m pip install -r <requirements sem psycopg>   # psycopg-binary pinado não tem wheel p/ Python 3.14
# <tmp>/test_settings_sqlite.py:  from config.settings import *;  DATABASES={"default":{"ENGINE":"django.db.backends.sqlite3","NAME":":memory:"}}
cd backend && DJANGO_DEBUG=1 DJANGO_SECRET_KEY=local-test-only PYTHONPATH="<tmp>;." DJANGO_SETTINGS_MODULE=test_settings_sqlite \
  <tmp>/venv/Scripts/python manage.py test api master_data --noinput
```
Foi assim que a suíte inteira (700 testes) passou localmente em out/2026. SQLite ≠ Postgres: valide também em produção/CI quando tocar SQL específico.
- **Seed de migração**: as migrações criam cabos reais (ex.: `FIB-8F-LCLC`) também no banco de teste → nos testes use códigos/conectores fictícios (`TST-…`, `ZZ`) para evitar colisão.
- Frontend: `cd frontend && npx tsc --noEmit -p . && npx vite build` (o `tsconfig` tem `strict` e `include: ["src"]`).
- Ao adicionar feature: teste do fluxo feliz, campos opcionais e regressão dos endpoints existentes.

## 11. Git e auto-commit

Repositório: `rafaelbaladioffa-ctrl/erp-cstr` (**público**). Branch `main`; commit e **push ao concluir cada tarefa** (instrução permanente do Rafael):
```bash
git add <arquivos da tarefa>      # nomeie os arquivos
git commit -m "mensagem descritiva em português"
git push origin main
```
- **Nunca `git add -A`/`git add .`** sem revisar: o working tree do Windows tem lixo solto (`docs/*.md` não rastreados, `docker/mailserver/`, `output/`, `tmp/`, `tools/`, um arquivo estranho `", s.region.code)..."`) e **os `compose*.yaml` aparecem como DELETADOS (`D`) só no working tree local — NÃO commite essas exclusões**; se precisar deles localmente: `git checkout -- compose.yaml compose.prod.yaml ...`.
- Nunca commitar: `.env*`, `auth_info_baileys/`, `media/`, `staticfiles/`, `CLAUDE.local.md`, chaves, dumps.
- Avisos "CRLF will be replaced by LF" no Windows são normais.
- Mensagem de commit termina com a linha de coautoria definida na sessão.

## 12. Segurança — regras que NUNCA se violam

1. **Nunca exibir/printar** valores de `WHATSAPP_BOT_SECRET`, `OPENROUTER_API_KEY`/`AI_API_KEY`, `DJANGO_SECRET_KEY`, senhas, `VAPID_PRIVATE_KEY` ou qualquer `*_SECRET`/`*_KEY`/`*_PASSWORD` do `.env`. Ao inspecionar `.env`, liste só os **nomes** das variáveis.
2. **Nunca `docker compose down -v`.** Migrações **aditivas**.
3. **Repo público**: nada de IP/usuário/segredo/dado pessoal (CPF, RG) em arquivo commitado, mensagem de commit ou comentário.
4. Nenhuma `_KEY`/`_SECRET` em serializer, log ou resposta de API.
5. Não contornar permissões (sudo/docker negados a um usuário é limite deliberado); peça ao Rafael.
6. Ações em massa que atingem pessoas ou enviam mensagens (despacho em lote, bot, e-mail semanal, regeocodificação em lote) exigem confirmação explícita.
7. Variáveis de ambiente (nomes): `DJANGO_SECRET_KEY, DJANGO_DEBUG, DJANGO_ALLOWED_HOSTS, DJANGO_CSRF_TRUSTED_ORIGINS, CORS_ALLOWED_ORIGINS, TRUSTED_PROXY_IPS, FRONTEND_API_URL, FRONTEND_URL, POSTGRES_*, WHATSAPP_BOT_SECRET, BOT_API_URL, AI_PROVIDER/AI_MODEL/AI_API_KEY, EMAIL_*, AUTH_EMAIL_*, VAPID_*, DJANGO_SUPERUSER_*`. Sem `DJANGO_SECRET_KEY`/`WHATSAPP_BOT_SECRET` em produção o backend aborta no startup.

## 13. Orquestração de agentes e skills

Para tarefas de negócio/operação, delegue ao subagente especializado (quando o harness permitir spawn de agentes):

| Agente | Quando |
|---|---|
| `produto-negocios` | **Antes** de feature/relatório/KPI: define regras e critérios de aceite |
| `layout-wfm` | Layout/UX de telas novas |
| `frontend-erp` | Implementação React a partir da spec + layout |
| `agente-negocios` | Visão de produto/estratégia |
| `ops-diretor-operacoes`, `ops-planejador`, `ops-supervisor-campo`, `ops-qualidade`, `ops-sst`, `ops-suprimentos` | Visões de operação (carteira, planejamento/MOP, RDO/produção, testes/as-built, EHS, materiais) |

Skills do projeto em `.claude/skills/` (hoje: `deploy`). Se um processo se repetir 3× do mesmo jeito, vire skill.

## 14. Estado atual e pendências conhecidas

- **Previsão de término de projetos**: especificada em `docs/previsao-de-termino-de-projetos.md`, **não implementada**.
- **Capacidade × demanda** no Painel de Sites: fora do escopo até definir se `ProjectTask.estimated_hours` é homem-hora ou duração.
- Cadastro Guiado de Cabos: **a tela nunca foi usada de ponta a ponta no navegador** (só API/testes/prévia em produção). Conferir códigos de cobre/AOC/breakout no primeiro uso real.
- Remover o fluxo legado `cable-imports` (tabelas `CableImport/CableImportItem`) só via deprecação.
- Commitar a alteração local de `compose.yaml` da VPS; criar `client_id` próprio do rclone/Drive; corrigir permissão de `locale` (aviso do `compilemessages`).
- Documentos `docs/arquitetura-do-sistema.md` e `docs/arquitetura-tecnica.md` estão **defasados em infraestrutura** (falam de notebook/WSL; a produção é a VPS) — este arquivo prevalece.
- O Painel de Sites e Relatórios aparecem vazios/zerados quando falta processo de campo (check-in, assignment): não é bug.

## 15. Índice da documentação (`docs/`)

| Arquivo | Conteúdo |
|---|---|
| `arquitetura-tecnica.md` | Modelo de dados e API verificados no código (set/2026) |
| `arquitetura-do-sistema.md` | Visão de arquitetura e segurança (infra defasada) |
| `cadastros-mestres.md` | Catálogo mestre, regras de template, fluxo SOW |
| `calculo-de-horas.md`, `ajuste-calculo-horas-reais.md` | Cálculo de horas e decisão das horas reais |
| `features/relatorios-v2.md`, `relatorios-v2-layout.md` | Spec de Relatórios v2 |
| `painel-gestao-sites.md` | Painel de Gestão de Sites (implementado) |
| `previsao-de-termino-de-projetos.md` | Spec de previsão (não implementada) |
| `onboarding/` | Inventário e PDFs de onboarding (backend/frontend/segurança) |
| `email/servidor-email-containerizado.md`, `docker/mailserver/` | Servidor de e-mail em container (estudo/infra) |
| `apresentacao-*.md`, `layout-industrial-denso.md` | Apresentações executivas e estudo de layout |

## 16. Protocolo de trabalho (como agir neste projeto)

Regras de conduta para qualquer sessão do Claude Code aqui. Valem tanto para o Claude no terminal quanto no Claude Desktop/Orca. Foram escritas a partir de problemas reais (out/2026).

### 16.1 Ao começar
1. Leia `CLAUDE.md` e `CLAUDE.local.md` (infra/acessos). Não pergunte ao Rafael o que já está nesses arquivos.
2. Rode `git status` e `git log -5`. **Várias sessões trabalham na mesma pasta**: pode haver mudança não commitada de outra sessão. Descubra o que é antes de editar o mesmo arquivo.
3. Se o pedido envolver negócio (regra, KPI, relatório), confira a seção 8 e o `memory/glossario.md` antes de implementar.

### 16.2 Ciclo de trabalho
`entender → passo pequeno → validar → commit (arquivos nomeados) → push → deploy só com autorização → verificar em produção → relatar`.
- **Validação mínima:** frontend `cd frontend && npx tsc --noEmit -p . && npx vite build`; backend `manage.py test` (ver §10); model alterado → `makemigrations --check` e migração **aditiva**; texto novo de UI → pt-BR + en-US + es-ES.
- **Commit:** `git add <arquivos da tarefa>`, nunca `-A`. Não commite trabalho de outra sessão sem ler o diff. Se ao commitar o `git status` já estiver limpo, outra sessão commitou: confira com `git log` e **não refaça**.
- **Deploy** só com autorização do Rafael **para aquela mudança** (autorização anterior não vale para a próxima). Siga §9: backup, `pull --ff-only`, build com log, recriar, verificar.

### 16.3 Relatar com honestidade
- Nunca diga "testado", "entregue" ou "deploy feito" sem evidência (comando + resultado). Separe sempre: **o que foi feito**, **o que foi verificado**, **o que NÃO foi verificado**.
- Interface nunca usada no navegador = **não testada**, mesmo com `tsc`/build/testes passando. Diga isso.
- Se errar ou corrigir uma afirmação anterior, diga claramente (ex.: uma mensagem "entregue" que na verdade ficou retida).
- Ao reportar resultado de comando, não invente: se não rodou, diga que não rodou.

### 16.4 Quando um comando é bloqueado
1. **Classifique** pela mensagem exata: (a) *"X is temporarily unavailable (timed out), so auto mode cannot determine the safety of Bash"* = o avaliador de segurança do **modo automático** deu timeout (problema passageiro, não é do código); (b) *permission denied/denied by user* = limite deliberado de permissão; (c) erro do próprio comando (tsc, vite, docker, ssh) = problema real a diagnosticar.
2. Em (a): tente de novo **uma vez**; se persistir, pare de insistir, continue o que não depende do comando (leitura, busca e edição de arquivos não passam pelo avaliador) e peça ao Rafael uma saída: esperar, sair do modo automático (`Shift+Tab`), aprovar o comando manualmente, ou liberar uma regra exata em `.claude/settings.local.json` (decisão **dele**).
3. **Nunca** altere permissões sozinho, nem contorne o bloqueio por outro caminho, nem peça a **outra sessão** para executar a ação que foi bloqueada (isso burla a decisão do usuário).
4. Não rotule como "erro do código" algo que não saiu do código; mostre a causa real.

### 16.5 Coordenação entre sessões
- Mensagens entre sessões só passam direto quando as duas estão no **mesmo modo de permissão**; entre terminal e Claude Desktop elas costumam ficar **retidas e expirar**. Não conte com elas: o Rafael é o canal. Se algo precisa chegar à outra sessão, entregue ao Rafael um texto pronto para colar.
- Uma sessão por assunto quando possível. Registre decisões duráveis em `CLAUDE.md`/`memory/` (negócio) e `CLAUDE.local.md` (infra), não só na conversa.
- Em conflito de arquivo ou de intenção entre sessões, **pergunte ao Rafael**; não sobrescreva.

### 16.6 Produção, segurança e comunicação
- Produção, mensagens a terceiros e ações em massa: confirmar antes (§12). Nunca exibir segredos; repositório **público** (nada de IP, usuário, chave, dado pessoal em arquivo commitado).
- Respostas em **português do Brasil**, objetivas e executivas: resultado primeiro, depois detalhes e pendências. Evite jargão de software com o Rafael; fale em operação de obra/campo quando fizer sentido.
- Se não conseguir terminar uma parte, termine o resto e diga **no começo** da resposta o que ficou travado e por quê.

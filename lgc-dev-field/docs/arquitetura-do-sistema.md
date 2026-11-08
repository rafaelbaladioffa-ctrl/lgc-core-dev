# Arquitetura do Sistema — ERP CSTR

> Sistema ERP interno para gestão de obras de cabeamento estruturado em data centers hyperscale.
> Versão do documento: setembro/2026.

---

## 1. Visão Geral

O ERP CSTR é uma aplicação web monolítica modular composta por quatro serviços principais que rodam em contêineres Docker sobre uma rede bridge privada. Toda a comunicação entre serviços ocorre dentro dessa rede interna; apenas as portas de acesso ao usuário final são expostas para o host.

```
┌─────────────────────────────────────────────────────────────────┐
│  HOST  (Windows Server + WSL2 Ubuntu)                           │
│                                                                 │
│  ┌──────────┐   :5173   ┌───────────────────────────────────┐  │
│  │ Navegador│ ────────► │  frontend  (nginx + React SPA)    │  │
│  └──────────┘           └───────────────────────────────────┘  │
│                                    │ /api/* proxy implícito     │
│  ┌──────────┐   :8000   ┌──────────▼──────────────────────┐    │
│  │ Admin /  │ ────────► │  backend  (Django + Gunicorn)   │    │
│  │ API REST │           └──────────┬──────────────────────┘    │
│  └──────────┘                      │                           │
│                          ┌─────────▼──────────┐               │
│                          │  db  (PostgreSQL 17)│               │
│                          └────────────────────┘               │
│                                                                 │
│  ┌─────────────┐  :3001  ┌──────────────────────────────────┐  │
│  │  WhatsApp   │ ──────► │  whatsapp-bot  (Node.js)         │  │
│  │  (Baileys)  │         │  chama backend via rede interna  │  │
│  └─────────────┘         └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Stack de Tecnologias

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Backend — framework | Django | 5.2 |
| Backend — API REST | Django REST Framework | 3.15 |
| Backend — autenticação | djangorestframework-simplejwt | 5.3 |
| Backend — proteção brute force | django-axes | 8.3 |
| Backend — admin | django-unfold | 0.94 |
| Backend — servidor WSGI | Gunicorn | 23.0 |
| Backend — arquivos estáticos | WhiteNoise | 6.9 |
| Backend — push notifications | pywebpush | 2.0 |
| Backend — geração de PDF | ReportLab | 4.4 |
| Frontend — framework | React | 18.3 |
| Frontend — linguagem | TypeScript | 5.5 |
| Frontend — bundler | Vite | 5.4 |
| Frontend — roteamento | React Router DOM | 6.26 |
| Frontend — mapa | Leaflet | 1.9 |
| Frontend — servidor (prod) | nginx (Alpine) | latest |
| Bot — runtime | Node.js | 22 |
| Bot — WhatsApp Web | @whiskeysockets/baileys | 6.7 |
| Bot — automação browser | Puppeteer Core + Chromium | 23.6 |
| Banco de dados | PostgreSQL | 17 |
| Infraestrutura | Docker Compose | v2 |
| Host | Windows Server + WSL2 Ubuntu | — |
| IA (planejamento) | OpenRouter (modelo configurável) | — |

---

## 3. Infraestrutura e Deploy

### 3.1 Contêineres

O sistema usa **Docker Compose com overlay de produção** — dois arquivos aplicados em camadas:

| Arquivo | Função |
|---------|--------|
| `compose.yaml` | Definição base de todos os serviços, volumes e rede |
| `compose.prod.yaml` | Sobrescreve comando do backend (Gunicorn) e build do frontend (nginx) |

Em desenvolvimento o frontend roda com Vite dev server com HMR. Em produção, o build é compilado (`npm run build`) e servido pelo nginx.

```
Desenvolvimento:  frontend → Vite dev server (porta 5173)
Produção:         frontend → nginx servindo /dist estático (porta 5173)
Backend:          dev/prod  → Gunicorn (2 workers em prod)
```

### 3.2 Volumes Docker

| Volume | Conteúdo |
|--------|----------|
| `postgres_data` | Dados do banco PostgreSQL (nunca destruir com `-v`) |
| `static_data` | Arquivos estáticos Django (`collectstatic`) |
| `media_data` | Uploads de usuário (anexos de projeto) |
| `frontend_node_modules` | `node_modules` do frontend (evita rebuild a cada start) |
| `whatsapp_auth` | Sessão persistente do WhatsApp (QR code já escaneado) |

### 3.3 Rede

Todos os serviços comunicam-se pela rede bridge interna do Docker (`com.docker.network.driver.mtu: 1400`). O bot acessa o backend via `http://backend:8000/api` — nome DNS interno, sem passar pela internet.

### 3.4 Servidor de Produção

```
Máquina física: notebook (Windows Server)
Virtualização:  WSL2 (Ubuntu)
Acesso:         SSH via alias notebook-servidor
Gestão:         Docker Desktop for Windows, operado via wsl.exe
```

**Fluxo de deploy padrão:**
```bash
ssh notebook-servidor "wsl.exe -d Ubuntu bash -c \"
  cd /home/server-cstr/erp-cstr &&
  git pull origin main &&
  docker compose -f compose.yaml -f compose.prod.yaml build <serviço> &&
  docker compose -f compose.yaml -f compose.prod.yaml up -d --force-recreate <serviço>
\""
```

---

## 4. Backend — Django

### 4.1 Apps e responsabilidades

| App | Modelos principais | Responsabilidade |
|-----|--------------------|-----------------|
| `core` | `Site`, `Category`, `ActivityType`, `ProjectType`, `GenerationRule` | Catálogos base do sistema |
| `projects` | `Project`, `ProjectTask`, `WorkBlock`, `ProjectItem`, `TaskDependency`, `TaskExecutionEvent` | Projetos, tarefas e execução de obra |
| `users` | `Collaborator`, `CustomUser` | Usuários, perfis, permissões |
| `api` | — | Todos os endpoints REST (`views.py`, `operations.py`, `dashboard.py`) |
| `dispatch` | `TechnicianDailyPresence`, `TechnicianAbsence`, `CollaboratorPair` | Presença, jornada e despacho de técnicos |
| `technical` | `MyTask` (proxy de `ProjectTask`) | Visão simplificada para o técnico no campo |
| `bot` | `BotSubscriber`, `ProjectProgressSnapshot` | Integração WhatsApp — subscribers e snapshots |
| `audit` | `AuditLog` | Diff automático de campos via Django signal |
| `updates` | `ProjectUpdate` | Atualizações ao cliente por e-mail |
| `master_data` | — | Catálogo mestre com assistência de IA (SOW import) |
| `scope_import` | `ScopeImport` | Importação de escopo de projeto via IA (OpenRouter) |

### 4.2 Camadas da API REST

```
Request HTTP
    │
    ▼
urls.py          — roteamento: router DRF + urlpatterns manuais
    │
    ▼
permissions.py   — IsAuthenticated / ViewAwareModelPermissions /
                   BotSharedSecretPermission
    │
    ▼
views.py         — ViewSets (CRUD) + APIViews (operações customizadas)
operations.py    — agregações da Central de Operações
dashboard.py     — analytics e métricas do Dashboard
    │
    ▼
serializers.py   — validação, serialização e desserialização
    │
    ▼
services.py      — lógica de negócio desacoplada (create_task,
                   generate_tasks_from_rule, record_task_transition…)
    │
    ▼
models.py        — ORM Django + propriedades calculadas
    │
    ▼
PostgreSQL 17
```

### 4.3 Configuração Django

| Parâmetro | Valor |
|-----------|-------|
| `DEBUG` | `0` em produção (env var) |
| `LANGUAGE_CODE` | `pt-br` |
| Timezone | UTC (formatação em UTC−3 feita no bot em Node.js) |
| `SESSION_EXPIRE_AT_BROWSER_CLOSE` | `True` |
| `SESSION_COOKIE_AGE` | 10 minutos (inatividade) |
| `SESSION_SAVE_EVERY_REQUEST` | `True` (renova a cada request) |
| `CONN_MAX_AGE` | 60s (pool de conexões ao banco) |

---

## 5. Frontend — React SPA

### 5.1 Estrutura de diretórios

```
frontend/src/
  api/
    client.ts       — axios + interceptors JWT + refresh automático
    resources.ts    — clientes HTTP por entidade (crud<T> helper)
    types.ts        — interfaces TypeScript de todos os modelos
  components/
    ui/             — Button, Icon, Modal, DynamicForm, PageHeader…
    projects/       — componentes de projetos e planejamento
    cadastros/      — CRUD genérico via EntityConfig
    master-data/    — componentes do cadastro mestre
    scope-import/   — revisão de importação de escopo por IA
  pages/
    Dashboard.tsx
    ProjectsList.tsx / ProjectDetail.tsx
    OperationsBoard.tsx      — Central de Operações (pool + drag-and-drop)
    TimelineOperacional.tsx  — Gantt por técnico
    OperationsReports.tsx    — Relatórios e Indicadores
    MyTasks.tsx              — visão do técnico (proxy)
    SitesMap.tsx             — mapa de obras com Leaflet
    AuditLog.tsx
    Login.tsx
    cadastros/CadastrosPage.tsx
  utils/
    timeline.ts     — helpers de Gantt
    permissions.ts  — PERMS, modelPerms, hasPermission
  App.tsx           — rotas e RequirePermission
  index.css         — variáveis CSS, temas, componentes base
```

### 5.2 Padrões de arquitetura frontend

- **Sem Redux / Zustand** — estado local via `useState`/`useEffect`; `AuthContext` para sessão global
- **Sem biblioteca de gráficos** — barras, anéis e Gantt são `<div>` com `width: %` em CSS puro
- **Sem CSS Modules / Tailwind** — um único `index.css` com variáveis CSS (`:root`) e seletor de tema `[data-theme="dark"]`
- **Roteamento** — React Router DOM v6 com `RequirePermission` por rota
- **Drag-and-drop** — API nativa HTML5 (`draggable`, `onDragStart`, `onDrop`), sem biblioteca
- **Ícones** — Material Symbols via Google Fonts, consumidos pelo componente `<Icon name="..." />`

### 5.3 Gerenciamento de sessão no cliente

```
Login bem-sucedido
    │
    ▼
Access token  ──► sessionStorage  (nunca localStorage)
Refresh token ──► sessionStorage
    │
    │  Expiração do access (8h) ou 401
    ▼
interceptor axios → POST /api/token/refresh/
    │  → novo access + novo refresh (ROTATE_REFRESH_TOKENS=True)
    │  → salva ambos no sessionStorage
    ▼
Request original refeito automaticamente

Logout / fechar aba
    │
    ▼
POST /api/token/logout/ (blacklist do refresh no servidor)
sessionStorage.clear()
```

---

## 6. Bot WhatsApp — Node.js

### 6.1 Funcionamento

O bot conecta ao WhatsApp Web via **Baileys** (biblioteca Node.js que emula o cliente web oficial, sem API oficial do Meta). A sessão autenticada é persistida no volume `whatsapp_auth` — depois do primeiro scan de QR code, o bot reconecta automaticamente sem nova autenticação.

**Puppeteer Core + Chromium** está disponível no contêiner para automações de scraping/screenshot quando necessário.

### 6.2 Comunicação com o backend

O bot não tem banco de dados próprio — toda lógica de negócio é delegada ao backend via chamadas HTTP:

```
Mensagem WhatsApp recebida
    │
    ▼
Bot (Node.js :3001)
    │  POST /api/bot/...
    │  Header: X-Bot-Secret: <WHATSAPP_BOT_SECRET>
    ▼
Backend (Django :8000)
    │  BotSharedSecretPermission → hmac.compare_digest()
    ▼
Resposta JSON → Bot formata e envia de volta ao WhatsApp
```

A autenticação usa **HMAC timing-safe** (`hmac.compare_digest`) para evitar timing attacks na validação do segredo compartilhado.

---

## 7. Banco de Dados — PostgreSQL 17

### 7.1 Convenções de migração

Todas as migrações são **estritamente aditivas**:

1. Adicionar coluna com `null=True, blank=True`
2. Migrar dados se necessário (migration separada)
3. Tornar obrigatório numa terceira migration (quando for o caso)

Nunca `DROP COLUMN` ou `DROP TABLE` direto — campos obsoletos são marcados como deprecated antes de qualquer remoção.

### 7.2 Backup

Script `docker/backup-db.sh` disponível para backup do volume `postgres_data`.  
**Nunca usar `docker compose down -v`** — apaga o volume em produção.

---

## 8. Segurança

### 8.1 Autenticação e tokens

| Mecanismo | Configuração |
|-----------|-------------|
| Tipo | JWT (Bearer token) |
| Access token lifetime | 8 horas |
| Refresh token lifetime | 7 dias |
| Rotação de refresh | `ROTATE_REFRESH_TOKENS = True` — cada renovação invalida o anterior |
| Blacklist de refresh | `rest_framework_simplejwt.token_blacklist` — invalidação no logout |
| Armazenamento cliente | `sessionStorage` — nunca sobrevive a fechar o navegador |
| Timeout de inatividade | 10 minutos (frontend e Django Admin) |

### 8.2 Proteção contra força bruta

| Camada | Mecanismo | Configuração |
|--------|-----------|-------------|
| Rate limiting | `ScopedRateThrottle` | 5 req/min no endpoint `/api/token/` |
| Lockout | `django-axes` | 5 falhas → bloqueio de 30 min por IP + usuário |
| Cobertura | Ambas as camadas | Django Admin + endpoint JWT (chamam `authenticate()`) |

### 8.3 Headers HTTP de segurança (nginx)

Aplicados em todos os blocos `location` (nginx não herda `add_header` de blocos pai):

| Header | Valor |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'`; scripts, fontes e imagens com origens explícitas |
| `X-Frame-Options` | `DENY` — impede clickjacking |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Câmera, microfone, geolocalização e pagamento bloqueados |

### 8.4 Segurança do Django

| Configuração | Valor |
|-------------|-------|
| `SESSION_COOKIE_SECURE` | `True` em produção |
| `CSRF_COOKIE_SECURE` | `True` em produção |
| `SECURE_CONTENT_TYPE_NOSNIFF` | `True` |
| `X_FRAME_OPTIONS` | `DENY` |
| `SECURE_HSTS_SECONDS` | 31.536.000 (1 ano) em produção |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS` | `True` |

### 8.5 Audit Log

O app `audit` grava automaticamente um diff campo a campo de qualquer alteração em modelos listados em `AUDITED_APPS`, via Django signal. Cada registro contém: usuário, timestamp, modelo, pk, campos anteriores e campos novos.

---

## 9. Integração de IA

O módulo `scope_import` permite importar o escopo de um projeto (texto livre) com assistência de IA:

```
Usuário cola escopo (texto, planilha, e-mail)
    │
    ▼
POST /api/scope-imports/  →  ScopeImport (status: processing)
    │
    ▼
OpenRouterProvider.interpret_scope()
    │  POST https://openrouter.ai/api/v1/chat/completions
    │  Modelo: configurável via env var AI_MODEL
    │  Timeout: configurável via AI_TIMEOUT_SECONDS
    ▼
Resposta JSON validada → status: ready
    │
    ▼
Usuário revisa e edita a prévia (nada é gravado automaticamente)
    │
    ▼
POST /api/scope-imports/{id}/confirm/
    │  confirm_scope_import() em transaction.atomic()
    ▼
WorkBlock + ProjectItem + ProjectTask criados no banco
```

**A IA nunca grava dados automaticamente** — a confirmação é sempre uma ação explícita do usuário após revisão.

---

## 10. Notificações Push (Web Push)

O backend suporta **Web Push Notifications** (padrão W3C / VAPID):

- Chaves VAPID configuradas via env vars `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
- Frontend registra service worker e envia subscription ao endpoint `/api/push-subscriptions/`
- Backend usa `pywebpush` para enviar notificações server-side
- Funciona em navegadores modernos mesmo com a aba fechada

---

## 11. Variáveis de Ambiente Críticas

| Variável | Obrigatória em prod | Descrição |
|----------|-------------------|-----------|
| `DJANGO_SECRET_KEY` | ✅ | Chave criptográfica Django (raise em prod se ausente) |
| `WHATSAPP_BOT_SECRET` | ✅ | Autenticação bot → backend (raise em prod se ausente) |
| `POSTGRES_DB/USER/PASSWORD` | ✅ | Credenciais do banco |
| `DJANGO_ALLOWED_HOSTS` | ✅ | Hosts permitidos (ex: `192.168.15.90,localhost`) |
| `CORS_ALLOWED_ORIGINS` | ✅ | Origins autorizadas para CORS |
| `FRONTEND_API_URL` | ✅ | URL da API vista pelo navegador |
| `AI_API_KEY` | — | Chave OpenRouter (sem ela, IA desabilitada — não quebra o sistema) |
| `AI_MODEL` | — | Slug do modelo (ex: `minimax/minimax-m3:free`) |
| `EMAIL_HOST_PASSWORD` | — | Senha SMTP para e-mails ao cliente |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | — | Push notifications |

> **Regra de segurança:** nenhuma `_KEY` ou `_SECRET` é exposta em endpoint, log ou serializer. O backend valida presença das obrigatórias no startup e lança `RuntimeError` antes de aceitar qualquer request.

---

## 12. Módulos Funcionais

### Gestão de Projetos
- Cadastro de projetos com cliente, site, tipo, categoria e responsável
- Tarefas com status (Não iniciada → Em andamento → Pausada → Concluída / Cancelada)
- Blocos de trabalho e itens técnicos (estrutura hierárquica de planejamento)
- Dependências entre tarefas
- Histórico de execução (`TaskExecutionEvent`)
- Anexos e ocorrências por projeto
- Atualizações ao cliente por e-mail

### Central de Operações
- Pool de tarefas do dia por site
- Despacho de tarefas para técnicos (drag-and-drop)
- Presença diária (check-in / check-out) e jornada
- Timeline Gantt por técnico
- Relatórios: ranking de utilização, desempenho por técnico, tempo por tipo de atividade

### Planejamento com IA
- Importação de escopo (SOW) via texto livre → estrutura de obra completa
- Motor de regras determinístico: tecnologia → atividades geradas automaticamente
- Catálogo mestre de cabos, atividades, redes, paths, localizações

### Bot WhatsApp
- Técnico atualiza status de tarefas pelo WhatsApp sem app instalado
- Relatórios de progresso enviados automaticamente aos subscribers

### Cadastros
- Empresas, clientes, sites, colaboradores, funções
- Tipos de atividade, tipos de item, tipos de projeto, categorias
- Regras de geração de tarefas por tecnologia

### Auditoria
- Log automático de toda alteração com diff campo a campo, usuário e timestamp

---

## 13. Repositório

```
Repositório:   git@github.com:rafaelbaladioffa-ctrl/erp-cstr.git
Branch main:   deploy direto (git pull → docker compose build/up)
Testes:        python manage.py test  (~137 testes unitários de backend)
```

```
erp-cstr/
  backend/          Django (Python)
  frontend/         React + Vite + TypeScript
  bot/              Node.js + Baileys + Puppeteer
  docker/           Dockerfiles por serviço + scripts de infraestrutura
  docs/             Documentação técnica
  compose.yaml      Definição base dos serviços
  compose.prod.yaml Overlay de produção
```

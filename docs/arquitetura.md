# Arquitetura do Axis

Visão técnica do Core e da relação com os satélites. Atualizado em 2026-11-07 a partir do código
(`backend/src/app.module.ts`, `backend/prisma/schema.prisma`, `frontend/src/App.tsx`,
`docker-compose.yml`). Substitui as seções 1–3 e 6–8 do antigo `PLANNING.md`
([arquivo/planning-v0.2.md](arquivo/planning-v0.2.md)).

## 1. Visão

O Axis é o **ponto único de verdade** da LGC para usuários, colaboradores, estrutura organizacional,
clientes, projetos e requisições internas. Satélites especializados (Logística em operação; Financeiro
em construção, só o esqueleto F0; Projetos/Field e Pessoas planejados) **nunca acessam o banco do Core**: integram por API REST versionada
(`/api/v1`) e por eventos (outbox + webhook). Cada satélite tem seu próprio banco.

| Premissa | Decisão |
|---|---|
| Tenancy | Unidade única, sem multi-tenancy. Expansão para filiais = deploy separado, não isolamento no mesmo banco. |
| Volume | 50–300 usuários ativos. VPS de referência: 4 vCPU, 8 GB RAM, 80 GB SSD + backup externo, com Core e satélites em Docker Compose. |
| Fila de eventos | Outbox transacional + webhook (sem RabbitMQ). Reavaliar só com volume ordens de grandeza maior. |
| Retenção pós-desligamento | Indefinida (soft-offboarding); precisa de política de retenção formal da empresa (LGPD). |

## 2. Componentes

```
                ┌──────────────── navegador ────────────────┐
                │  Web Core (React, :5173)   PWA Logística   │
                └──────┬───────────────┬──────────┬──────────┘
                 JWT   │   /logistica-api (nginx)  │ JWT do Core (login/refresh via CORS)
                       ▼               ▼          ▼
            ┌───────────────────┐   ┌──────────────────────┐
            │  API Core :3000   │   │  API Logística :3100 │
            │  NestJS + Prisma  │──▶│  NestJS + Prisma     │  webhook X-Axis-Signature
            └─────────┬─────────┘   └──────────┬───────────┘
                      ▼                        ▼
               Postgres "axis"          Postgres "axis_logistica"
```

- O **frontend do Core** fala com a Logística diretamente pelo navegador (catálogo de compra e
  disponibilidade), via proxy nginx `/logistica-api/` → `logistica-backend:3100/api/v1/`. O backend
  do Core **não** chama a Logística.
- Detalhes e lacunas dos contratos: [integracao-core-logistica.md](integracao-core-logistica.md).
- **Financeiro** (`lgc-dev-financeiro/`, API `:3200`, Postgres `axis_financeiro`, web `:5175`): o
  navegador faz login no Core e usa o access token do Core na API do Financeiro, que recebe o webhook
  do Core como a Logística. Contratos: [integracao-core-financeiro.md](integracao-core-financeiro.md).

## 3. Backend do Core

NestJS 12 em ESM (imports com sufixo `.js`), Prisma 5.22, PostgreSQL 16. Prefixo global `api/v1`;
`ValidationPipe` com `whitelist` + `forbidNonWhitelisted` + `transform`; helmet; CORS por
`CORS_ALLOWED_ORIGINS`; corpo JSON até 50 MB (anexos em base64). Interceptor global
`AuditLogInterceptor` grava `audit_logs` para rotas com `@AuditAction`.

| Módulo (`backend/src/…`) | Responsabilidade |
|---|---|
| `auth` | Login, refresh com rotação (hash SHA-256), troca de senha, logout, token de launch de satélite (90 s) |
| `rbac` | `@RequirePermissions` + `PermissionsGuard` (permissões lidas do JWT) |
| `users` | Usuários de login, papéis e permissões (`roles.controller.ts`) |
| `sectors`, `cost-centers` | Estrutura organizacional hierárquica com responsável e código gerado |
| `job-titles`, `work-schedules` | Cargos e jornadas |
| `collaborators` | RH: cadastro, dados sensíveis criptografados, organograma, desligamento, log de acesso sensível |
| `certifications` | Certificações NR-10/35/12/18 com vencimento |
| `clients`, `projects` | Comercial; código de projeto `PROP-{cliente}.{seq}-{MMAA}` |
| `request-categories` | Catálogo de requisições por setor, com versões (`formSchema`/`workflowSchema` JSON) |
| `requests` | Ciclo de vida das requisições, aprovações, compras, SLA, anexos, Minhas atividades, crons |
| `delegations`, `approval-authority-rules`, `holidays` | Delegação de aprovação, alçada por valor, calendário de SLA |
| `integration` | Outbox + dispatcher, admin de satélites, API de consulta por API key |
| `audit`, `common/crypto`, `prisma` | Auditoria, AES-256-GCM, cliente Prisma |

Domínio em detalhe: [dominio/cadastros.md](dominio/cadastros.md) e
[dominio/requisicoes-estado-atual.md](dominio/requisicoes-estado-atual.md).

### Modelo de dados

31 models e 21 enums em `backend/prisma/schema.prisma`; 29 migrações, aplicadas com
`npm run db:migrate` ([operacao.md §4](operacao.md#4-migrações--cuidados-obrigatórios)). Desde
2026-11-07 o histórico aplica do zero e o banco não tem objetos do BPM (`20261121000000_remove_bpm`).

- Resquícios ainda no schema (saem junto com o código que os usa): `RequestExecutionMode.bpm_v1`, `RequestStatus.aguardando_correcao` e
  `aguardando_informacao`, `Queue.revision`, `Request.currentCycle`.

## 4. Frontend do Core

React 19 + Vite 8 + React Router 7, sem biblioteca de estado ou de UI: contexto de auth/tema,
componentes próprios (`FormPage`, `DataTable`, `Button`, `KpiCard`, `SlideOver`, gráficos SVG) e
tokens do tema "Industrial Flow Graphite" em `frontend/src/styles/axis-tokens.css`.

- Cliente HTTP único (`src/api/client.ts`): axios com `Bearer` do `localStorage`, refresh automático
  em 401 com fila de requisições, redireciona para `/login` se o refresh falhar.
- `PrivateRoute` exige login, troca de senha pendente e permissão da rota; envolve a página em `ErrorBoundary`.
- 32 páginas em `src/pages/`. Mapa de rotas e estado de QA: [design/checklist-qa-rotas.md](design/checklist-qa-rotas.md).

## 5. Segurança e LGPD

| Tema | Como está |
|---|---|
| Autenticação | JWT HS256; access 15 min com `roles`, `permissions`, `collaboratorId`, `mustChangePassword`; refresh 7 d com rotação. Tokens em `localStorage` no navegador. |
| Autorização | Toda rota (exceto login/refresh e a API de satélites) usa `JwtAuthGuard` + `PermissionsGuard`. Não há escopo por setor genérico: regras pontuais no serviço de requisições, algumas por nome de papel. |
| Dados sensíveis | RG/CPF/CTPS/PIS criptografados com AES-256-GCM (`FIELD_ENCRYPTION_KEY`), `cpfHash` para busca. Leitura só via `GET /collaborators/:id/sensitive` (`collaborator:read_sensitive`) com registro em `sensitive_data_access_logs`. CNH, telefone e endereço ficam em texto puro. |
| Satélites | API key (hash bcrypt) + throttle 100 req/min por satélite; webhooks assinados HMAC-SHA256. |
| Auditoria | `audit_logs` via `@AuditAction` (escrita sem aguardar). Nem todos os controllers estão anotados. |
| Backups | `pg_dump` diário com retenção de 30 dias (serviço `backup`). |

Lacunas conhecidas (rate limit no login, escalada via edição de papéis, vazamento na fila de
requisições, SSO com a Logística): [avaliacao-2026-11-07.md §3](avaliacao-2026-11-07.md#3-segurança).

## 6. Integração com satélites

**Eventos (Core → satélite).** A escrita de negócio e a linha em `integration_outbox` são gravadas na
mesma transação. `OutboxDispatcherService` (cron a cada minuto) entrega `POST` aos webhooks dos
satélites assinantes com envelope `{event_id, event_type, occurred_at, payload}` e cabeçalho
`X-Axis-Signature: sha256=<hmac>`; retry 1 min / 5 min / 30 min / 2 h e falha permanente. O
satélite deduplica por `event_id`.

Eventos emitidos hoje: `client.created|updated`, `collaborator.created|updated|offboarded`,
`project.created|status_changed`, `request.submitted|status_changed|completed`,
`sla.warning|breached`. **Não** são emitidos: `user.*`, `material_request.*`, `purchase_order.*`.

**Consulta síncrona (satélite → Core).** `GET /api/v1/integration/{collaborators,users,clients,projects,sectors,cost-centers}`
com API key; só campos não sensíveis.

**Administração.** `POST /integration/satellites` devolve API key e segredo HMAC uma única vez;
`POST /integration/satellites/:id/test-webhook`; `POST /integration/satellites/:id/launch` gera URL
com `?axisToken=` (JWT de 90 s); `GET /integration/outbox` para acompanhamento.

**Entrada (satélite → Core).** Não existe endpoint de recebimento de eventos de satélite.

## 7. Implantação

Docker Compose em VPS única: `postgres`, `backend`, `frontend` (nginx) e `backup` do Core, mais a
stack da Logística na rede `lgc-dev-logistica_default`. O backend executa `prisma migrate deploy` e o
seed a cada partida. Procedimentos: [operacao.md](operacao.md).

## 8. Decisões de arquitetura

| # | Decisão | Origem |
|---|---|---|
| A1 | Outbox + webhook em vez de broker de mensagens | PLANNING v0.2 §3 |
| A2 | Satélites com banco próprio; nunca leem o banco do Core | PLANNING v0.2 §1 |
| A3 | Unidade única, sem multi-tenancy | PLANNING v0.2 §8 |
| A4 | Retenção indefinida de dados pós-desligamento | PLANNING v0.2 §7–8 |
| A5 | SSO com satélites pelo mesmo segredo HS256 do access token | Especificação da Logística §0.3 |
| A6 | Anexos em BYTEA no Postgres, sem antimalware (provisório) | Especificação de Requisições §27.1 |
| A7 | Motor BPM removido em 02/11/2026 para reescrita organizada (checkpoint `629044d`) | Commit `98dfce5` |
| A8 | Logística mantida como subpasta deste repositório (monorepo informal) | Estado atual; ver [avaliacao §5](avaliacao-2026-11-07.md#5-estrutura-do-repositório) |
| A9 | Financeiro como subpasta `lgc-dev-financeiro/`, banco próprio, primeira frente contas a pagar; aceita só o access token do Core (sem sessão própria) | Dono do produto, 2026-11-07; [especificação](../lgc-dev-financeiro/docs/especificacao.md) |

Decisões de negócio: [dominio/decisoes-negocio.md](dominio/decisoes-negocio.md).

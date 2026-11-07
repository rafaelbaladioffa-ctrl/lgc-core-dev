# Axis

ERP interno da **LGC Instalações e Projetos** (Sumaré-SP), usado pelas equipes de campo e de escritório.
O Axis é organizado em um **Core** (identidade, cadastros, requisições, integração) e **satélites**
especializados. Este repositório contém o Core e o satélite **Logística** (almoxarifado/WMS).

| Parte | Pasta | Stack | Porta (dev) |
|---|---|---|---|
| Core — API | [`backend/`](backend/) | NestJS 12 · Prisma 5 · PostgreSQL 16 · TypeScript (ESM) | 3000 (`/api/v1`) |
| Core — Web | [`frontend/`](frontend/) | React 19 · Vite 8 · React Router 7 · TypeScript | 5173 |
| Logística — API | [`lgc-dev-logistica/backend/`](lgc-dev-logistica/backend/) | NestJS 12 · Prisma 5 · PostgreSQL 16 (banco próprio) | 3100 (`/api/v1`) |
| Logística — PWA | [`lgc-dev-logistica/frontend/`](lgc-dev-logistica/frontend/) | React 19 · Vite 8 · PWA offline | 5174 |

> **Estado em 2026-11-07:** o motor BPM (P01–P04) foi removido em 02/11 para reescrita; o módulo
> Requisições segue no fluxo "legado" em evolução. Antes de qualquer deploy novo, leia
> [docs/avaliacao-2026-11-07.md](docs/avaliacao-2026-11-07.md) — há bloqueios conhecidos
> (migrações que não rodam em banco vazio, testes quebrados, vazamento de dados na fila de requisições).

## O que o Core faz hoje

- **Acesso:** login JWT (access 15 min + refresh 7 dias com rotação), troca obrigatória de senha, RBAC por permissões `recurso:ação`, papéis `admin`, `rh`, `gestor`, `tecnico`, `analista_suprimentos`, `colaborador`, `compliance`.
- **Cadastros:** colaboradores (dados sensíveis criptografados + log de acesso LGPD, organograma, desligamento), certificações NR, setores e centros de custo hierárquicos, cargos, jornadas, clientes, projetos, usuários e grupos.
- **Requisições:** catálogo por setor/categoria versionada, Minhas atividades, triagem, cadeia de aprovação hierárquica com alçada por valor e delegação, compra de material com itens da Logística, SLA com calendário de feriados, anexos, comentários, painel.
- **Integração:** outbox transacional + webhooks assinados (HMAC), API de consulta para satélites (API key), launcher de satélites com token de 90 s.

Detalhes em [docs/](docs/README.md).

## Começando (Docker)

Pré-requisitos: Docker com Compose v2.

```bash
cp backend/.env.example backend/.env
```

Edite `backend/.env`: gere `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` e `FIELD_ENCRYPTION_KEY`
(64 caracteres hex) e defina `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Sem senha definida, o seed
gera uma aleatória e a imprime no log do container `backend`.

O compose do Core depende da rede da Logística (`lgc-dev-logistica_default`, declarada como
`external`). Suba a Logística primeiro:

```bash
docker compose -f lgc-dev-logistica/docker-compose.yml up -d --build
```

```bash
docker compose up --build
```

- API: http://localhost:3000/api/v1
- Web: http://localhost:5173 (o nginx faz proxy de `/logistica-api/` para a Logística)
- Postgres: localhost:5432 (`axis`/`axis`, só para desenvolvimento)
- Backup diário automático no volume `axis_backups`

Variáveis, backup/restauração, desenvolvimento sem Docker e cuidados com migrações:
[docs/operacao.md](docs/operacao.md).

## Mapa do repositório

```
backend/                 API do Core (src/<módulo>, prisma/schema.prisma, prisma/migrations, prisma/seed*.ts)
frontend/                Web do Core (src/pages, src/components, src/api, src/styles/axis-tokens.css)
lgc-dev-logistica/       Satélite Logística (backend/, frontend/, docs/especificacao.md, DEPLOY.md)
branding/                Assets de marca (logos, ícones, social) — regras em docs/design/identidade-visual.md
docs/                    Documentação (índice em docs/README.md); docs/arquivo/ guarda material histórico
docker-compose.yml       Postgres + backend + frontend + backup do Core
AGENTS.md                Regras para agentes de IA e desenvolvedores
```

## Documentação

| Documento | Para quê |
|---|---|
| [docs/avaliacao-2026-11-07.md](docs/avaliacao-2026-11-07.md) | Diagnóstico atual do código, riscos e prioridades |
| [docs/arquitetura.md](docs/arquitetura.md) | Visão, módulos, segurança, integração, decisões |
| [docs/operacao.md](docs/operacao.md) | Variáveis, Docker, migrações, backup, troubleshooting |
| [docs/diretrizes-desenvolvimento.md](docs/diretrizes-desenvolvimento.md) | Padrões obrigatórios e Definition of Done |
| [docs/integracao-core-logistica.md](docs/integracao-core-logistica.md) | Contratos Core ↔ Logística e o que ainda não fecha |
| [docs/dominio/](docs/README.md#domínio) | Cadastros, Requisições (estado atual, especificação, regras do motor, roadmap), decisões de negócio |
| [lgc-dev-logistica/README.md](lgc-dev-logistica/README.md) | Satélite Logística |

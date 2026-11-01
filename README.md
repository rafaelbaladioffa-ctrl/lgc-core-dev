# Axis

Sistema core corporativo — ver [PLANNING.md](./PLANNING.md) para o documento de arquitetura completo.

Este repositório cobre as **Fases 1 a 6** do roadmap (Sprints 1–9):
auth/RBAC, Setores, Centros de Custo, audit log, CRUD de Colaboradores com criptografia de campos
sensíveis, hierarquia/organograma, certificações técnicas (NR-10/35/12/18), Clientes e Projetos com
códigos sequenciais atômicos, chamados com motor de SLA/escalonamento, integração com satélites
(outbox transacional, webhooks assinados, API de consulta síncrona), e hardening (revisão de
segurança, backup automatizado, documentação de deploy).

## Estrutura

- `backend/` — API NestJS + Prisma + PostgreSQL
- `frontend/` — SPA React (Vite) — login + tela de colaboradores/organograma
- `docker-compose.yml` — orquestra postgres + backend + frontend

## Rodando com Docker

```bash
docker compose up --build
```

Isso irá:
1. Subir o PostgreSQL 16.
2. Aplicar as migrations do Prisma (`prisma migrate deploy`).
3. Rodar o seed de roles/permissions/usuário admin padrão.
4. Iniciar a API em `http://localhost:3000/api/v1`.
5. Servir o frontend em `http://localhost:5173`.
6. Subir o serviço `backup`, que grava um dump do PostgreSQL ao iniciar e a cada 24h (ver
   [Backup e restauração](#backup-e-restauração)).

Usuário admin padrão (definido em `backend/.env`): `admin@axis.local` / `ChangeMe123!`
— **troque a senha e os segredos (`JWT_*_SECRET`, `FIELD_ENCRYPTION_KEY`) antes de qualquer uso real.**

## Variáveis de ambiente (`backend/.env`)

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | String de conexão do Postgres (sobrescrita pelo `docker-compose.yml` para apontar ao serviço `postgres`) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Segredos de assinatura dos tokens JWT — **gerar valores aleatórios únicos por ambiente**, nunca reaproveitar os de desenvolvimento |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | Tempo de vida dos tokens (ex.: `15m`, `7d`) |
| `FIELD_ENCRYPTION_KEY` | Chave AES-256 em hex, **exatamente 64 caracteres** (32 bytes) — usada para criptografar CPF/RG/CTPS/PIS e o `hmac_secret` dos satélites. Gerar com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Trocar essa chave sem migrar os dados já gravados torna os campos criptografados irrecuperáveis.** |
| `PORT` | Porta da API (padrão `3000`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Credenciais do usuário admin criado pelo seed |

Os segredos de cada satélite (API key e HMAC secret) são gerados pela própria API no momento do
registro (`POST /integration/satellites`) e devolvidos em texto puro **uma única vez** — não ficam
em variável de ambiente.

## Backup e restauração

O serviço `backup` (ver `docker-compose.yml` e `backend/scripts/backup-postgres.sh`) gera um dump
comprimido do PostgreSQL em `/backups` (volume `axis_backups`) ao iniciar e a cada 24h, mantendo os
últimos `RETENTION_DAYS` dias (padrão 30, conforme seção 7 do PLANNING.md) e removendo os mais antigos.

Backup manual, a qualquer momento:
```bash
docker compose exec backup sh /scripts/backup-postgres.sh
```

Listar backups disponíveis:
```bash
docker compose exec backup ls -la /backups
```

Restaurar um dump (sobrescreve os dados atuais do banco):
```bash
docker compose exec backup sh /scripts/restore-postgres.sh /backups/axis_<timestamp>.sql.gz
```

Para agendar em horário fixo em vez do laço de 24h do container, substitua o `command` do serviço
`backup` por um cron do host/CI chamando `docker compose exec backup sh /scripts/backup-postgres.sh`.

## Rodando sem Docker (desenvolvimento local)

Requer Node 20+ e um PostgreSQL 16 acessível.

```bash
cd backend
npm install
npx prisma migrate deploy   # ou: npx prisma migrate dev
npm run prisma:seed
npm run start:dev
```

```bash
cd frontend
npm install
npm run dev
```

## Verificando a criptografia dos campos sensíveis

Os campos CPF/RG/CTPS/PIS de `collaborators` são criptografados em repouso na camada de aplicação
(AES-256-GCM, chave em `FIELD_ENCRYPTION_KEY`). Para confirmar que ficam ilegíveis em consulta SQL direta:

```sql
SELECT full_name, rg_enc, cpf_enc, cpf_hash, ctps_enc, pis_enc FROM collaborators;
```

Os valores `*_enc` devem aparecer como base64 opaco (não o CPF/RG em texto puro). A descriptografia só
ocorre na aplicação, via `GET /collaborators/:id/sensitive`, que exige a permissão
`collaborator:read_sensitive` (papéis `admin`/`rh`) e grava uma linha em `sensitive_data_access_logs`
a cada acesso.

## Papéis seedados

`admin`, `rh`, `gestor`, `tecnico`, `colaborador` — ver `backend/prisma/seed.ts` para as permissões de cada um.

## Integração com satélites

Sistemas externos ("satélites") consomem a API Axis de duas formas, ambas autenticadas por API key
(não pelo JWT de usuário final) e com rate limit por satélite (100 req/min):
- **Eventos assíncronos**: mudanças de estado (criação de colaborador, projeto, chamado, etc.)
  geram um evento no outbox transacional e são entregues via webhook assinado
  (`X-Axis-Signature: sha256=<hmac>`), com retry exponencial (1min/5min/30min/2h) e falha
  permanente na 5ª tentativa.
- **Consulta síncrona**: `GET /integration/{collaborators,clients,projects,sectors,cost-centers}`
  (paginado, envelope `{data, meta}`), apenas campos não sensíveis.

Satélites são registrados via `POST /integration/satellites` (permissão `integration:manage`), que
devolve a API key e o HMAC secret em texto puro **uma única vez**.

## Revisão de segurança (Sprint 9)

- **RBAC**: todo endpoint que não seja `POST /auth/login`, `POST /auth/refresh` ou as rotas
  `/integration/*` autenticadas por API key exige `JwtAuthGuard` + `PermissionsGuard` com uma
  `@RequirePermissions` específica — verificado controlador por controlador.
- **Criptografia**: os campos `*_enc`/`*Hash` de `collaborators` só são decriptados dentro de
  `CollaboratorsService` (view "full", atrás de `collaborator:read_sensitive` + log de acesso em
  `sensitive_data_access_logs`); nenhuma resposta de API, log de auditoria ou payload de evento do
  outbox contém CPF/RG/CTPS/PIS em texto puro.
- **Rate limiting**: rotas de satélite usam `@nestjs/throttler` com tracker por `satellite.id`
  (não por IP, já que satélites podem compartilhar IP de saída).

## Nota sobre o ambiente de codificação

Este código foi escrito sem acesso a Docker/PostgreSQL no ambiente de desenvolvimento usado para
gerar os arquivos, em todas as fases (1 a 6). Build e type-check (`npm run build`/`tsc --noEmit` no
backend e no frontend) passam limpos, e cada schema do Prisma foi validado (`prisma validate`) com
as migrations geradas via `prisma migrate diff` contra snapshots do schema anterior. Cada fase foi
validada end-to-end por uma sessão de testes com Docker/WSL2 real antes de ser considerada concluída
— ver as notas de teste no histórico do projeto para o detalhe de cada rodada.

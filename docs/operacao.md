# Operação do Axis Core

Como subir, configurar, migrar e fazer backup do Core. Atualizado em 2026-11-07 a partir de
`docker-compose.yml`, `backend/.env.example`, `backend/package.json`, `backend/Dockerfile`,
`frontend/nginx.conf` e `backend/scripts/`. Para a Logística, veja
[../lgc-dev-logistica/DEPLOY.md](../lgc-dev-logistica/DEPLOY.md).

## 1. Docker Compose

Serviços (`docker-compose.yml`):

| Serviço | Imagem | Porta | Observação |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 | Usuário/senha/banco `axis` fixos — **só para desenvolvimento** |
| `backend` | `backend/Dockerfile` | 3000 | `prisma migrate deploy` → `tsx prisma/seed.ts` → `node dist/main.js` a cada partida |
| `frontend` | `frontend/Dockerfile` (nginx) | 5173 → 80 | SPA + proxy `/logistica-api/` → `logistica-backend:3100/api/v1/` |
| `backup` | postgres:16-alpine | — | Dump imediato e a cada 24 h em `axis_backups`, retenção `RETENTION_DAYS=30` |

Os serviços `backend` e `frontend` entram também na rede externa `lgc-dev-logistica_default`.
**Consequência:** sem a stack da Logística criada, `docker compose up` aborta com "network … could
not be found". Ordem de subida:

```bash
docker compose -f lgc-dev-logistica/docker-compose.yml up -d --build
```

```bash
docker compose up --build
```

## 2. Variáveis de ambiente

### Backend (`backend/.env`, nunca versionado)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | Conexão Postgres. O compose sobrescreve para o host `postgres`. |
| `JWT_ACCESS_SECRET` | sim | Segredo HS256 do access token. **É o mesmo `JWT_SECRET` da Logística.** Não é validado na partida. |
| `JWT_REFRESH_SECRET` | sim | Segredo do refresh token; diferente do anterior. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | não | Padrão `15m` / `7d`. |
| `FIELD_ENCRYPTION_KEY` | sim | 64 caracteres hex (32 bytes), AES-256-GCM para RG/CPF/CTPS/PIS e segredos de satélite. Validada na partida. **Trocar sem migrar os dados torna os campos irrecuperáveis.** Gerar: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT` | não | Padrão `3000`. |
| `CORS_ALLOWED_ORIGINS` | sim em produção | Lista separada por vírgula. Sem ela, só `localhost:5173` e `localhost:5174`. Precisa incluir o domínio do PWA da Logística. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | recomendado | Admin criado pelo seed. Sem senha, o seed gera uma aleatória e **imprime no log**. |
| `SEED_ADMIN_CPF` | não | CPF do colaborador vinculado ao admin. |
| `TEST_DATABASE_URL` | só testes e2e | PostgreSQL **local** dedicado com nome terminado em `_test` (a guarda em `backend/test/support/test-database.ts` recusa outros). |

`AXIS_LOGISTICA_URL`, definida no `docker-compose.yml`, não é lida pelo backend.

### Frontend (build do Vite)

| Variável | Padrão | Descrição |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000/api/v1` | API do Core. É embutida no build; o compose não passa build args, então vale o `.env` do host ou o padrão. |
| `VITE_LOGISTICA_API_BASE_URL` | `/logistica-api` | Base da API da Logística. No `npm run dev` não existe proxy para esse caminho: aponte para `http://localhost:3100/api/v1` no `.env.local`. |

## 3. Desenvolvimento sem Docker

Requer Node 20+ e PostgreSQL 16.

```bash
cd backend && npm install && cp .env.example .env
```

```bash
npx prisma migrate deploy && npm run prisma:seed && npm run start:dev
```

```bash
cd frontend && npm install && npm run dev
```

Seeds auxiliares (`backend/package.json`): `seed:org`, `seed:org-cc-restructure`,
`seed:requests-fase1`, `seed:requests-fase2-sectors`, `seed:requests-parallel-demo`,
`seed:approval-authority-matrix`.

## 4. Migrações — cuidados obrigatórios

1. **Aplique migrações com `npm run db:migrate`** (é o que o container faz). Ele roda antes
   `prisma/fix-migration-history.sql`, ajuste único e idempotente: em 2026-11-07 quatro migrações
   que tinham data anterior às tabelas que alteram foram renomeadas para logo depois de
   `20261111000000_requisicoes_fase1` (`request_bpm_p01`, `bpm_p04_materials`,
   `request_approval_source`, `request_bpm_p02`, agora `20261111000001`–`…004`). O script renomeia
   as linhas correspondentes em `_prisma_migrations` de bancos antigos; o conteúdo e o checksum não
   mudaram. Rodar só `prisma migrate deploy` num banco antigo, sem o ajuste, faria o Prisma tentar
   reaplicá-las.
2. **`20261121000000_remove_bpm`** apaga do banco o motor BPM removido do código (tabelas `bpm_*`,
   `request_queue_members`, `process_config_grants`, triggers e funções `bpm_*`, colunas BPM de
   `request_categories`/`category_versions`, tipos `Bpm*` e permissões `request_process:*` /
   `request_queue:manage`) e **desativa** as categorias do piloto. Requisições existentes, inclusive as
   do piloto (`execution_mode = 'bpm_v1'`), são mantidas. **Faça backup antes do primeiro deploy
   com esta migração** — os dados do piloto nas tabelas `bpm_*` não voltam.
3. Depois dessas duas correções o histórico aplica do zero num banco vazio e não há drift entre
   banco e `schema.prisma` (verificado com `prisma migrate diff`). Ainda assim, nunca rode
   `prisma migrate dev`, `migrate reset` ou `db push` contra banco com dados.
   A migração seguinte, `20261121000001_requisicoes_destravar_em_triagem`, devolve à fila de triagem
   (`enviada`) as requisições reabertas que tinham ficado presas em `em_triagem`, registrando cada uma
   em `audit_events`.
4. Nunca edite uma migração já aplicada; crie outra.
5. Antes de aplicar migração em produção: backup, ensaio numa cópia (`*_test`) e, só depois, deploy.
   O seed roda a cada partida do container e precisa continuar idempotente.

## 5. Backup e restauração

```bash
docker compose exec backup sh /scripts/backup-postgres.sh
```

```bash
docker compose exec backup ls -la /backups
```

```bash
docker compose exec backup sh /scripts/restore-postgres.sh /backups/axis_<timestamp>.sql.gz
```

A restauração sobrescreve o banco atual. Teste a restauração periodicamente numa cópia. Para horário
fixo, troque o laço do serviço por um cron do host chamando o script de backup.

## 6. Verificações úteis

Confirmar a criptografia em repouso (os campos `*_enc` devem aparecer como base64 opaco):

```sql
SELECT full_name, rg_enc, cpf_enc, cpf_hash, ctps_enc, pis_enc FROM collaborators;
```

Não há endpoint de health no Core. Para checar a API: `POST /api/v1/auth/login` com um usuário válido.

## 7. Problemas conhecidos

| Sintoma | Causa | Ação |
|---|---|---|
| `network lgc-dev-logistica_default … not found` | Rede externa da Logística não existe | Suba a Logística antes (seção 1) |
| Catálogo de compra vazio em `npm run dev` | Sem proxy `/logistica-api` no Vite | Definir `VITE_LOGISTICA_API_BASE_URL` |
| 403 no catálogo para `analista_suprimentos` ou `compliance` | Papel sem mapeamento na Logística | `PUT /rbac/axis-role-mapping/:axisRole` na Logística |
| Usuário com papel removido ainda acessa | Permissões vêm do JWT (até 15 min) e desativar não revoga refresh | Aguardar expiração; ver avaliação |

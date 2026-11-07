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
| `REQUEST_BPM_ENABLED` | — | **Obsoleta** (BPM removido); não é lida pelo código. |
| `BPM_TEST_DATABASE_URL` | só testes e2e | Banco `*_bpm_test` usado pelos testes e2e antigos. |

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
`seed:approval-authority-matrix`. **`seed:requests-suprimentos` não compila** (usa models do BPM removido).

## 4. Migrações — cuidados obrigatórios

1. **Não rode `npx prisma migrate dev` em banco com dados.** As tabelas do BPM removido continuam no
   banco sem model no schema; o Prisma vai propor uma migração que as apaga.
2. **Banco novo não sobe hoje:** as migrações `20261101000000_request_bpm_p01`,
   `20261103000001_request_approval_source` e `20261103000002_request_bpm_p02` alteram tabelas
   criadas depois, em `20261110000000_rebuild_requisicoes` e `20261111000000_requisicoes_fase1`.
   O banco atual só funciona porque essas migrações foram aplicadas em outra ordem. A correção está
   na lista de pré-requisitos de [dominio/requisicoes-roadmap.md](dominio/requisicoes-roadmap.md).
3. Nunca edite uma migração já aplicada; crie outra.
4. Antes de aplicar migração em produção: backup, ensaio numa cópia (`*_test`) e, só depois, deploy.
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
| `migrate deploy` falha em banco vazio | Ordem das migrações BPM | Ver seção 4 |
| Container do backend sobe sem `dist/main.js` | `tsconfig.build.tsbuildinfo` versionado fora de `outDir` + `incremental` + `deleteOutDir` (o tsc acha que está tudo compilado) | Apagar o `.tsbuildinfo` antes do build; correção definitiva na avaliação |
| Catálogo de compra vazio em `npm run dev` | Sem proxy `/logistica-api` no Vite | Definir `VITE_LOGISTICA_API_BASE_URL` |
| 403 no catálogo para `analista_suprimentos` ou `compliance` | Papel sem mapeamento na Logística | `PUT /rbac/axis-role-mapping/:axisRole` na Logística |
| Usuário com papel removido ainda acessa | Permissões vêm do JWT (até 15 min) e desativar não revoga refresh | Aguardar expiração; ver avaliação |

# Axis Logística — implantação (VPS compartilhada com o Axis)

> **Não foi possível executar o `docker compose` nesta máquina de desenvolvimento (sem Docker).** Os arquivos abaixo foram escritos
> seguindo o padrão do compose do Axis e a aplicação foi validada rodando direto no Node contra um PostgreSQL 16 real
> (migrations, seed, 358 testes e2e, 343 unitários, build do frontend). **A primeira subida na VPS deve ser acompanhada** — checklist na seção 6.

## 1. O que sobe

| Serviço | Imagem | Função | Porta |
|---|---|---|---|
| `logistica-postgres` | `postgres:16-alpine` | Banco **próprio** `axis_logistica` (nunca o banco do Axis) | 5432 interna (5433 só em dev) |
| `logistica-backend` | `backend/Dockerfile` | API NestJS + agendador | 3100 |
| `logistica-frontend` | `frontend/Dockerfile` (nginx) | PWA operacional; proxy de `/api/` para o backend | 80 (→ 5174) |
| `logistica-backup` | `postgres:16-alpine` | `pg_dump` diário, retenção de 30 dias | — |

Na VPS compartilhada, copie os quatro serviços e os dois volumes para o compose do Axis (ou use a stack irmã `docker compose -f docker-compose.yml up -d`
na mesma rede/host). Nomes de serviço têm prefixo `logistica-` para não colidir com `postgres`/`backend`/`frontend` do Axis.

## 2. Variáveis (`backend/.env`, nunca commitado)

| Variável | Obrigatória | Observação |
|---|---|---|
| `DATABASE_URL` | sim | O compose sobrescreve com o host `logistica-postgres` |
| `JWT_SECRET` | sim | **Idêntico** ao `JWT_ACCESS_SECRET` do Axis (SSO, HS256). Trocar no Axis exige trocar aqui |
| `AXIS_WEBHOOK_SECRET` | sim | Segredo HMAC do satélite cadastrado no Axis (`X-Axis-Signature`) |
| `WEBHOOK_MAX_AGE_HOURS` | não (72) | Janela anti-replay do webhook |
| `AXIS_EVENTS_URL` | sim em produção | Endpoint do Axis que recebe os eventos Logística → Axis. Vazio = nada é enviado (ficam `PENDING`) |
| `AXIS_OUTBOUND_SECRET` | recomendado | HMAC dos eventos de saída (`X-Logistica-Signature`) |
| `SCHEDULER_ENABLED` | — | `true` em **uma** instância (compose já define) |
| `DEFAULT_WAREHOUSE_CODE` | não | Almoxarifado de atendimento quando a requisição do Axis não informa |
| `ALERT_ORDER_ANALYSIS_HOURS` / `ALERT_ORDER_PICKING_HOURS` / `ALERT_TRANSIT_HOURS` | não (2 / 24 / 48) | SLAs dos alertas |
| `AXIS_PUBLIC_URL` | sim em produção | URL pública da API do Axis (ex.: `https://axis.exemplo.com.br/api/v1`), embutida no PWA no build (`VITE_AXIS_URL`): é para onde o login do e-mail/senha vai. **O Axis precisa liberar CORS para o domínio da Logística** |
| `LOGISTICA_DB_PASSWORD` | sim | Senha do Postgres (variável do compose; o default `logistica` é só para dev) |
| `PORT` | não (3100) | |

Segredos: gerar com `openssl rand -hex 32`; guardar no cofre da VPS; nunca em log ou no repositório.

## 3. Primeira implantação

1. Cadastrar o satélite "Logística" no Axis: URL do webhook `https://<dominio>/api/v1/webhooks/axis`, segredo = `AXIS_WEBHOOK_SECRET`, e assinar os eventos
   `user.*`, `collaborator.*`, `client.*`, `project.*`, `ticket.status_changed` (adaptador, 0.4) e `purchase_order.approved|changed`.
2. Preencher `backend/.env`, definir `LOGISTICA_DB_PASSWORD` e subir: `docker compose up -d --build`.
3. O comando do backend roda `prisma migrate deploy` e o seed (idempotente: unidades de medida, permissões e perfis; **não** sobrescreve o mapeamento
   `axis_role_to_logistics_role` já editado).
4. Mapear as roles do Axis para perfis de Logística (`PUT /api/v1/rbac/axis-role-mapping/:axisRole`) e atribuir escopo por almoxarifado
   (`PUT /api/v1/rbac/users/:axisUserId/warehouses`). Sem escopo, só quem tem `warehouse:access_all` enxerga os almoxarifados.
5. Cadastrar almoxarifados e endereços, importar o catálogo (seção 8 do planejamento) e as políticas de reposição (`PUT /stock-policies`).
6. TLS e proxy reverso da VPS apontando para `logistica-frontend`. **A câmera do PWA só funciona em HTTPS.**

## 4. Operação

- **Saúde:** `GET /api/v1/health` (público) e `GET /api/v1/integration/outbox/status` (fila de saída). Alertas: `GET /api/v1/alerts`; indicadores: `GET /api/v1/dashboard/kpis`.
- **Agendador (uma instância):** entrega do outbox a cada 30 s (backoff 1 min → 5 min → 30 min → 2 h → dead-letter), varredura de alertas e expiração de reservas a cada 5 min, reconciliação a cada hora.
- **Dead-letter:** `GET /api/v1/reconciliation/issues` lista `OUTBOX_DEAD_LETTER`; depois de tratar a causa, `POST /api/v1/integration/outbox/:id/retry`.
- **Reconciliação:** `BALANCE_VS_LEDGER`, `RESERVED_DRIFT`, `ORPHAN_RESERVATION`, `DELIVERED_WITHOUT_LEDGER`, `OUTBOX_DEAD_LETTER`. O sistema **detecta e abre item**; a correção é sempre humana (ajuste com aprovação do Axis) e o item é fechado com a resolução registrada.
- **Auditoria:** `GET /api/v1/audit/events` (filtros por agregado, ator, ação, período e `correlationId`). Toda mutação, leitura sensível (documentos, painel, custódia, trilha) e negação de acesso é gravada; a tabela é protegida por trigger contra UPDATE/DELETE. Envie `X-Correlation-Id` nas chamadas para amarrar a trilha ao fluxo do Axis.
- **Logs:** não contêm token, corpo de requisição nem assinatura; só nomes de campos.

## 5. Backup, restauração e rollback

- Backup: serviço `logistica-backup` (imediato ao subir e a cada 24 h) em `logistica_backups`. Teste a restauração **antes** de ir a produção:
  `docker compose exec logistica-backup sh /scripts/restore-postgres.sh /backups/logistica_<data>.sql.gz` em um banco de homologação.
- **Rollback de versão:** as migrations são aditivas (novas tabelas/colunas, sem remoção) para a imagem anterior continuar funcionando; volte a imagem e mantenha o schema.
  Se uma migration precisar ser desfeita, restaure o backup anterior ao deploy — **nunca** `DROP` manual em produção.
- O ledger (`stock_movements`) e a auditoria (`audit_events`) rejeitam UPDATE/DELETE/TRUNCATE por trigger; correções são movimentos reversos vinculados.

## 6. Checklist da primeira subida na VPS

- [ ] `docker compose config` sem erro; `docker compose up -d --build` termina saudável (`docker compose ps`).
- [ ] `curl -s https://<dominio>/api/v1/health` → `{"status":"ok"}`.
- [ ] Webhook de teste do Axis (`ping`) retorna 200; assinatura inválida retorna 401.
- [ ] Token real do Axis em `/api/v1/me` retorna perfis/permissões esperados.
- [ ] `outbox/status` com `configured: true`; criar um movimento de teste e confirmar a entrega ao Axis (`DELIVERED`).
- [ ] PWA abre em HTTPS, instala na tela inicial, lê um QR com a câmera e sincroniza uma ação feita em modo avião.
- [ ] Backup gerado e restaurado em homologação.
- [ ] Reconciliação (`POST /api/v1/reconciliation/run`) sem itens críticos abertos.

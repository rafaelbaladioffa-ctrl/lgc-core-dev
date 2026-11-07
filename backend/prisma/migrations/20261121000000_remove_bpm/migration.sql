-- Remove do banco o motor BPM (P01–P04), retirado do código em 2026-11-02 (commit 98dfce5).
-- Autorizado pelo dono do produto em 2026-11-07: os dados do piloto P01 nas tabelas bpm_* são descartados.
--
-- Mantido de propósito (ainda está no schema.prisma ou é dado de negócio):
--   * linhas de "requests" (inclusive as do piloto, execution_mode = 'bpm_v1', que o código bloqueia);
--   * colunas requests.execution_mode/current_cycle/requester_sector_id/completed_at/first_response_at,
--     queues.active/revision, category_versions.published_at opcional;
--   * enum "RequestExecutionMode" e os valores aguardando_correcao/aguardando_informacao de "RequestStatus"
--     (Postgres não remove valor de enum; saem numa limpeza do schema, junto com o código).
-- Idempotente (IF EXISTS): roda igual em banco novo e em banco que já tinha o piloto.

-- 1. Categorias do piloto ficam inativas. Até aqui o trigger bpm_request_executor impedia abrir
--    requisição comum nelas; sem ele, voltariam ao catálogo com um formulário do BPM.
UPDATE "request_categories" SET "active" = false
WHERE "runtime_enabled" = true
   OR "published_bpm_version_id" IS NOT NULL
   OR "id" IN (SELECT "category_id" FROM "category_versions" WHERE "bpm_status" IS NOT NULL);

-- 2. Triggers e funções sobre tabelas que continuam existindo.
DROP TRIGGER IF EXISTS "bpm_request_executor" ON "requests";
DROP TRIGGER IF EXISTS "bpm_version_immutability" ON "category_versions";
DROP TRIGGER IF EXISTS "bpm_published_pointer" ON "request_categories";
DROP FUNCTION IF EXISTS bpm_request_executor_guard();
DROP FUNCTION IF EXISTS bpm_immutable_published_version();
DROP FUNCTION IF EXISTS bpm_validate_published_pointer();

-- 3. Tabelas do BPM (os triggers bpm_preserve_* caem junto com elas; só barravam DELETE, não DROP).
DROP TABLE IF EXISTS
  "bpm_sla_intervals",
  "bpm_sla_clocks",
  "bpm_request_attachments",
  "bpm_request_comments",
  "bpm_runtime_incidents",
  "bpm_command_receipts",
  "bpm_runtime_events",
  "bpm_request_participants",
  "bpm_activity_assignments",
  "bpm_activity_candidates",
  "bpm_activity_instances",
  "bpm_execution_tokens",
  "bpm_process_instances",
  "process_config_grants",
  "request_queue_members";
DROP FUNCTION IF EXISTS bpm_preserve_history();

-- 4. Colunas e restrições do BPM em tabelas do módulo Requisições.
ALTER TABLE "request_categories" DROP CONSTRAINT IF EXISTS "request_categories_published_bpm_version_id_fkey";
ALTER TABLE "request_categories"
  DROP COLUMN IF EXISTS "runtime_enabled",
  DROP COLUMN IF EXISTS "config_revision",
  DROP COLUMN IF EXISTS "published_bpm_version_id";
ALTER TABLE "category_versions" DROP CONSTRAINT IF EXISTS "bpm_draft_not_published";
ALTER TABLE "category_versions"
  DROP COLUMN IF EXISTS "bpm_status",
  DROP COLUMN IF EXISTS "bpm_definition",
  DROP COLUMN IF EXISTS "bpm_content_hash",
  DROP COLUMN IF EXISTS "bpm_validated_hash",
  DROP COLUMN IF EXISTS "bpm_revision",
  DROP COLUMN IF EXISTS "bpm_calendar_snapshot";

-- 5. Tipos do BPM (nenhuma coluna os usa mais).
DROP TYPE IF EXISTS
  "BpmVersionStatus",
  "BpmQueueMemberRole",
  "BpmGrantRole",
  "BpmInstanceState",
  "BpmTokenState",
  "BpmActivityKind",
  "BpmActivityPhase",
  "BpmActivityState",
  "BpmIncidentState",
  "BpmSlaMetric";

-- 6. Permissões do BPM (inseridas pela migração p01; o seed não as cria).
DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions"
  WHERE "resource" = 'request_process' OR ("resource" = 'request_queue' AND "action" = 'manage')
);
DELETE FROM "permissions"
WHERE "resource" = 'request_process' OR ("resource" = 'request_queue' AND "action" = 'manage');

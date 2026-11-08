-- Dados do PT-06 (idempotentes: podem rodar de novo sem duplicar nada; o seed prisma/seed-envio-material.ts faz o mesmo).
--
-- 1. Usuário de sistema "Axis (automático)": solicitante das requisições automáticas. Não consegue entrar:
--    status `disabled` (o login e o refresh recusam) e hash que não é bcrypt. O colaborador vinculado fica
--    `desligado` + `is_system`, para não aparecer em listas, organograma nem integrações.
-- 2. Categoria "Envio de material para obra" (kind `envio_material`), no setor Almoxarifado e Patrimônio quando
--    existe; senão, num setor técnico `SISTEMA` criado aqui. Nunca aparece no catálogo da tela.

-- Setor técnico, só quando não há o Almoxarifado e Patrimônio (banco novo, sem o seed da organização).
INSERT INTO "sectors" ("id", "code", "name", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'SISTEMA', 'Sistema (automático)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "sectors" WHERE "name" = 'Almoxarifado e Patrimônio')
  AND NOT EXISTS (SELECT 1 FROM "sectors" WHERE "code" = 'SISTEMA');

INSERT INTO "job_titles" ("id", "name", "is_technician", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'Sistema (automático)', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "collaborators" (
  "id", "full_name", "rg_enc", "cpf_enc", "cpf_hash", "corporate_email", "job_title_id", "sector_id",
  "status", "offboarded_at", "management_level", "matricula", "is_system", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, 'Axis (automático)', 'n/a', 'n/a', 'sistema-axis-automatico', 'axis-automatico@sistema.axis.local',
  (SELECT "id" FROM "job_titles" WHERE "name" = 'Sistema (automático)'),
  COALESCE(
    (SELECT "id" FROM "sectors" WHERE "name" = 'Almoxarifado e Patrimônio' ORDER BY "code" LIMIT 1),
    (SELECT "id" FROM "sectors" WHERE "code" = 'SISTEMA')
  ),
  'desligado', CURRENT_TIMESTAMP, 'colaborador', 'SISTEMA-AUTO', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "collaborators" WHERE "corporate_email" = 'axis-automatico@sistema.axis.local');

INSERT INTO "users" ("id", "email", "password_hash", "status", "collaborator_id", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text, 'axis-automatico@sistema.axis.local', '!', 'disabled',
  (SELECT "id" FROM "collaborators" WHERE "corporate_email" = 'axis-automatico@sistema.axis.local'),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE "email" = 'axis-automatico@sistema.axis.local');

-- Categoria e versão 1 publicada (sem formulário nem fluxo: a requisição é criada e roteada pelo servidor).
INSERT INTO "request_categories" (
  "id", "code", "name", "sector_id", "kind", "confidentiality", "active", "requires_acceptance", "use_dynamic_authority",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, 'LOG-ENVIO-OBRA', 'Envio de material para obra',
  COALESCE(
    (SELECT "id" FROM "sectors" WHERE "name" = 'Almoxarifado e Patrimônio' ORDER BY "code" LIMIT 1),
    (SELECT "id" FROM "sectors" WHERE "code" = 'SISTEMA')
  ),
  'envio_material', 'interna', true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "request_categories" WHERE "code" = 'LOG-ENVIO-OBRA');

INSERT INTO "category_versions" (
  "id", "category_id", "version", "form_schema", "workflow_schema", "sla_first_response_minutes", "sla_resolution_minutes",
  "status", "published_at", "created_at"
)
SELECT
  gen_random_uuid()::text, c."id", 1, '[]'::jsonb, '[]'::jsonb, 240, 2880, 'publicada', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "request_categories" c
WHERE c."code" = 'LOG-ENVIO-OBRA'
  AND NOT EXISTS (SELECT 1 FROM "category_versions" v WHERE v."category_id" = c."id");

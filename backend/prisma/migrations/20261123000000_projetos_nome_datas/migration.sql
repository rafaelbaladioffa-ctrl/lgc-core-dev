-- Projetos: nome e datas previstas (decisão P-07 do módulo Projetos do Financeiro).
-- Colunas opcionais no banco para não exigir backfill dos projetos já cadastrados; a API exige
-- o nome ao criar e ao editar.
ALTER TABLE "projects" ADD COLUMN "name" TEXT;
ALTER TABLE "projects" ADD COLUMN "planned_start_date" DATE;
ALTER TABLE "projects" ADD COLUMN "planned_end_date" DATE;

ALTER TABLE "projects" ADD CONSTRAINT "projects_planned_dates_check"
  CHECK ("planned_start_date" IS NULL OR "planned_end_date" IS NULL OR "planned_end_date" >= "planned_start_date");

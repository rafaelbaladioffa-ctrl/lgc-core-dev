-- P-07: o projeto do Core passou a ter nome e prazo previsto.
-- Título do orçamento vira opcional: vazio = nome do projeto no Core (acompanha a edição no Core).
ALTER TABLE "project_budgets" ALTER COLUMN "title" DROP NOT NULL;

-- Títulos gerados automaticamente ("<código>" ou "<código> — <cliente>") passam a seguir o nome do Core.
UPDATE "project_budgets" SET "title" = NULL WHERE "title" = "project_code" OR "title" LIKE "project_code" || ' — %';

-- Início e conclusão previstos: nulo = usa a data do projeto no Core; preenchido = o orçamento sobrescreve.
ALTER TABLE "project_budgets" ADD COLUMN "planned_start_date" DATE, ADD COLUMN "planned_end_date" DATE;
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_planned_dates_check"
  CHECK ("planned_start_date" IS NULL OR "planned_end_date" IS NULL OR "planned_end_date" >= "planned_start_date");

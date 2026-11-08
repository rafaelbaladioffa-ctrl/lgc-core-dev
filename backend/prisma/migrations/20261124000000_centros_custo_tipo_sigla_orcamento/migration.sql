-- Centros de custo: tipo, sigla e situação do orçamento (docs/integracao-centros-de-custo.md §1 e §4).
CREATE TYPE "CostCenterKind" AS ENUM ('divisao', 'administrativo', 'operacional', 'equipe_tecnica');
CREATE TYPE "CostCenterBudgetStatus" AS ENUM ('ok', 'alerta', 'estourado');

ALTER TABLE "cost_centers"
  ADD COLUMN "kind" "CostCenterKind" NOT NULL DEFAULT 'administrativo',
  ADD COLUMN "short_code" TEXT,
  ADD COLUMN "budget_status" "CostCenterBudgetStatus",
  ADD COLUMN "budget_percent" DECIMAL(6,2),
  ADD COLUMN "budget_year" INTEGER,
  ADD COLUMN "budget_status_at" TIMESTAMP(3);

-- Raízes da árvore são as divisões; os demais ficam `administrativo` até alguém reclassificar.
UPDATE "cost_centers" SET "kind" = 'divisao' WHERE "parent_cost_center_id" IS NULL;

CREATE UNIQUE INDEX "cost_centers_short_code_key" ON "cost_centers"("short_code");

-- Sigla: maiúsculas, dígitos e hífen, até 30 caracteres (a API valida o mesmo formato).
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_short_code_check"
  CHECK ("short_code" IS NULL OR ("short_code" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND char_length("short_code") <= 30));

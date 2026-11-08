-- CreateEnum
CREATE TYPE "BudgetModel" AS ENUM ('generico', 'aws_sow');

-- CreateEnum
CREATE TYPE "BudgetRevisionStatus" AS ENUM ('rascunho', 'em_aprovacao', 'enviada', 'ganha', 'perdida', 'substituida', 'descartada');

-- CreateTable
CREATE TABLE "project_budgets" (
    "id" TEXT NOT NULL,
    "axis_project_id" TEXT NOT NULL,
    "project_code" TEXT NOT NULL,
    "model" "BudgetModel" NOT NULL DEFAULT 'generico',
    "title" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_revisions" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "BudgetRevisionStatus" NOT NULL DEFAULT 'rascunho',
    "parameter_set_id" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB,
    "revenue" DECIMAL(14,2),
    "taxes" DECIMAL(14,2),
    "direct_cost" DECIMAL(14,2),
    "indirect_cost" DECIMAL(14,2),
    "profit" DECIMAL(14,2),
    "profit_on_cost" DECIMAL(9,4),
    "computed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_budgets_axis_project_id_model_key" ON "project_budgets"("axis_project_id", "model");

-- CreateIndex
CREATE INDEX "budget_revisions_status_idx" ON "budget_revisions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "budget_revisions_budget_id_number_key" ON "budget_revisions"("budget_id", "number");

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "project_budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_parameter_set_id_fkey" FOREIGN KEY ("parameter_set_id") REFERENCES "parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Um rascunho por orçamento.
CREATE UNIQUE INDEX budget_revisions_one_draft ON "budget_revisions" ("budget_id") WHERE "status" = 'rascunho';

-- Revisão fora de rascunho não muda entradas, parâmetros nem resultado; nada é apagado.
CREATE FUNCTION budget_revisions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'revisão de orçamento não pode ser apagada';
  END IF;
  IF OLD.status <> 'rascunho' AND (
       NEW.inputs IS DISTINCT FROM OLD.inputs
    OR NEW.parameter_set_id IS DISTINCT FROM OLD.parameter_set_id
    OR NEW.result IS DISTINCT FROM OLD.result
    OR NEW.revenue IS DISTINCT FROM OLD.revenue
    OR NEW.profit IS DISTINCT FROM OLD.profit) THEN
    RAISE EXCEPTION 'revisão de orçamento fora de rascunho é imutável';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_revisions_immutable
  BEFORE UPDATE OR DELETE ON "budget_revisions"
  FOR EACH ROW EXECUTE FUNCTION budget_revisions_guard();

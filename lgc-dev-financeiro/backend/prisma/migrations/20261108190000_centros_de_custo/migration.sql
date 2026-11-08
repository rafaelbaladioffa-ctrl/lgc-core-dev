-- Centros de custo (controladoria): lançamentos, compras, adiantamentos, orçamento, alocações, rateio e diário das equipes.

-- CreateEnum
CREATE TYPE "CcEntryKind" AS ENUM ('receita', 'custo');

-- CreateEnum
CREATE TYPE "CcEntryStage" AS ENUM ('comprometido', 'realizado');

-- CreateEnum
CREATE TYPE "CcEntrySource" AS ENUM ('compra', 'reembolso', 'adiantamento', 'logistica', 'folha', 'manual');

-- CreateEnum
CREATE TYPE "CcCategory" AS ENUM ('faturamento', 'folha', 'material', 'compras', 'servicos', 'despesas_campo', 'frota', 'outros');

-- CreateEnum
CREATE TYPE "CcPurchaseStatus" AS ENUM ('aprovada', 'pedido', 'recebida_parcial', 'recebida', 'cancelada');

-- CreateEnum
CREATE TYPE "CcAdvanceStatus" AS ENUM ('aberto', 'prestado');

-- CreateEnum
CREATE TYPE "CcOverheadDriver" AS ENUM ('headcount', 'receita', 'custo_direto', 'percentual');

-- CreateEnum
CREATE TYPE "CcTeamActivity" AS ENUM ('projeto', 'deslocamento', 'treinamento', 'manutencao', 'ocioso');

-- CreateTable
CREATE TABLE "cc_entries" (
    "id" TEXT NOT NULL,
    "cost_center_axis_id" TEXT NOT NULL,
    "project_axis_id" TEXT,
    "competence" DATE NOT NULL,
    "kind" "CcEntryKind" NOT NULL,
    "category" "CcCategory" NOT NULL,
    "stage" "CcEntryStage" NOT NULL,
    "source" "CcEntrySource" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "source_ref" TEXT,
    "reverses_id" TEXT,
    "reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cc_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cc_purchases" (
    "id" TEXT NOT NULL,
    "request_axis_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "cost_center_axis_id" TEXT NOT NULL,
    "project_axis_id" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "CcPurchaseStatus" NOT NULL,
    "groups" JSONB NOT NULL DEFAULT '[]',
    "approved_at" TIMESTAMP(3),
    "ordered_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cc_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cc_advances" (
    "id" TEXT NOT NULL,
    "request_axis_id" TEXT NOT NULL,
    "request_code" TEXT NOT NULL,
    "collaborator_axis_id" TEXT NOT NULL,
    "cost_center_axis_id" TEXT NOT NULL,
    "project_axis_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL,
    "status" "CcAdvanceStatus" NOT NULL DEFAULT 'aberto',
    "spent_amount" DECIMAL(14,2),
    "notes" TEXT,
    "settled_at" TIMESTAMP(3),
    "settled_by" TEXT,

    CONSTRAINT "cc_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cc_budgets" (
    "id" TEXT NOT NULL,
    "cost_center_axis_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "category" "CcCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cc_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cc_settings" (
    "cost_center_axis_id" TEXT NOT NULL,
    "field_daily_limit" DECIMAL(14,2),
    "last_budget_status" TEXT,
    "last_budget_year" INTEGER,
    "last_budget_percent" DECIMAL(9,2),
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cc_settings_pkey" PRIMARY KEY ("cost_center_axis_id")
);

-- CreateTable
CREATE TABLE "cc_allocations" (
    "id" TEXT NOT NULL,
    "collaborator_axis_id" TEXT NOT NULL,
    "cost_center_axis_id" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "source_event_id" TEXT,

    CONSTRAINT "cc_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_title_role_maps" (
    "axis_job_title_id" TEXT NOT NULL,
    "job_title_name" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_title_role_maps_pkey" PRIMARY KEY ("axis_job_title_id")
);

-- CreateTable
CREATE TABLE "cc_overhead_rules" (
    "source_cost_center_axis_id" TEXT NOT NULL,
    "driver" "CcOverheadDriver" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cc_overhead_rules_pkey" PRIMARY KEY ("source_cost_center_axis_id")
);

-- CreateTable
CREATE TABLE "cc_overhead_targets" (
    "rule_source_id" TEXT NOT NULL,
    "cost_center_axis_id" TEXT NOT NULL,
    "percent" DECIMAL(9,6),

    CONSTRAINT "cc_overhead_targets_pkey" PRIMARY KEY ("rule_source_id","cost_center_axis_id")
);

-- CreateTable
CREATE TABLE "cc_team_logs" (
    "id" TEXT NOT NULL,
    "cost_center_axis_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "activity" "CcTeamActivity" NOT NULL,
    "project_axis_id" TEXT,
    "people" INTEGER NOT NULL,
    "hours_per_person" DECIMAL(5,2) NOT NULL,
    "km" DECIMAL(10,1),
    "produced_quantity" DECIMAL(14,3),
    "produced_unit" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cc_team_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cc_entries_reverses_id_key" ON "cc_entries"("reverses_id");

-- CreateIndex
CREATE INDEX "cc_entries_cost_center_axis_id_competence_idx" ON "cc_entries"("cost_center_axis_id", "competence");

-- CreateIndex
CREATE INDEX "cc_entries_project_axis_id_competence_idx" ON "cc_entries"("project_axis_id", "competence");

-- CreateIndex
CREATE INDEX "cc_entries_source_ref_idx" ON "cc_entries"("source_ref");

-- CreateIndex
CREATE UNIQUE INDEX "cc_purchases_request_axis_id_key" ON "cc_purchases"("request_axis_id");

-- CreateIndex
CREATE INDEX "cc_purchases_cost_center_axis_id_status_idx" ON "cc_purchases"("cost_center_axis_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cc_advances_request_axis_id_key" ON "cc_advances"("request_axis_id");

-- CreateIndex
CREATE INDEX "cc_advances_cost_center_axis_id_status_idx" ON "cc_advances"("cost_center_axis_id", "status");

-- CreateIndex
CREATE INDEX "cc_advances_collaborator_axis_id_status_idx" ON "cc_advances"("collaborator_axis_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cc_budgets_cost_center_axis_id_year_month_category_key" ON "cc_budgets"("cost_center_axis_id", "year", "month", "category");

-- CreateIndex
CREATE INDEX "cc_allocations_collaborator_axis_id_valid_from_idx" ON "cc_allocations"("collaborator_axis_id", "valid_from");

-- CreateIndex
CREATE INDEX "cc_allocations_cost_center_axis_id_valid_from_idx" ON "cc_allocations"("cost_center_axis_id", "valid_from");

-- CreateIndex
CREATE INDEX "cc_team_logs_cost_center_axis_id_date_idx" ON "cc_team_logs"("cost_center_axis_id", "date");

-- CreateIndex
CREATE INDEX "cc_team_logs_project_axis_id_date_idx" ON "cc_team_logs"("project_axis_id", "date");

-- AddForeignKey
ALTER TABLE "cc_entries" ADD CONSTRAINT "cc_entries_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "cc_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cc_overhead_targets" ADD CONSTRAINT "cc_overhead_targets_rule_source_id_fkey" FOREIGN KEY ("rule_source_id") REFERENCES "cc_overhead_rules"("source_cost_center_axis_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Lançamento não se altera nem se apaga: correção é estorno (centros-de-custo-especificacao §1).
CREATE FUNCTION cc_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cc_entries é somente inclusão: corrija com um estorno';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cc_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON "cc_entries"
  FOR EACH ROW EXECUTE FUNCTION cc_entries_append_only();

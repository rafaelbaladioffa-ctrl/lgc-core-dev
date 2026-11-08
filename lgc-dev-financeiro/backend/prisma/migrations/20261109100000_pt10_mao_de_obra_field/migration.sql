-- PT-10: mão de obra realizada por projeto a partir das horas do Field (plano ponta a ponta, PA-14).
-- 1) origem `mao_de_obra` nos lançamentos do CC (par custo no projeto / crédito no CC de origem do técnico);
-- 2) horas do Field por técnico, projeto e dia, com as pendências da importação.

ALTER TYPE "CcEntrySource" ADD VALUE 'mao_de_obra';

CREATE TYPE "FieldLaborStatus" AS ENUM ('lancado', 'pendente');

CREATE TABLE "field_labor_days" (
    "id" TEXT NOT NULL,
    "collaborator_axis_id" TEXT NOT NULL,
    "project_axis_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "adjusted" BOOLEAN NOT NULL DEFAULT false,
    "status" "FieldLaborStatus" NOT NULL,
    "pending_reason" TEXT,
    "project_cost_center_axis_id" TEXT,
    "origin_cost_center_axis_id" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_labor_days_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "field_labor_days_date_idx" ON "field_labor_days"("date");
CREATE INDEX "field_labor_days_origin_cost_center_axis_id_date_idx" ON "field_labor_days"("origin_cost_center_axis_id", "date");
CREATE INDEX "field_labor_days_project_axis_id_date_idx" ON "field_labor_days"("project_axis_id", "date");
CREATE UNIQUE INDEX "field_labor_days_collaborator_axis_id_project_axis_id_date_key" ON "field_labor_days"("collaborator_axis_id", "project_axis_id", "date");

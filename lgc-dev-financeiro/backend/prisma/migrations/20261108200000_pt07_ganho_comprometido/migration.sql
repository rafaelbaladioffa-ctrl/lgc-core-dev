-- PT-07: projeto ganho e comprometido no CC (plano ponta a ponta, PA-13/PA-16).
-- 1) origem `projeto` nos lançamentos do CC (comprometido da revisão ganha);
-- 2) alertas visíveis no orçamento (ex.: o Core aprovou uma revisão enquanto outra já está ganha).

ALTER TYPE "CcEntrySource" ADD VALUE 'projeto';

CREATE TABLE "budget_alerts" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "revision_id" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "budget_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "budget_alerts_budget_id_resolved_at_idx" ON "budget_alerts"("budget_id", "resolved_at");

ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "project_budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

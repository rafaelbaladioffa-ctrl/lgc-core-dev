-- Calendário de SLA (REQUISICOES_SPEC.md §10) — feriados, alertas 50/80/100%, escalonamento
-- automático. Sexto incremento da Fase 2 (calendário global único — Axis não modela
-- empresa/unidade separadamente ainda).

ALTER TABLE "sla_clocks" ADD COLUMN "alerted_thresholds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "requests" ADD COLUMN "escalated_at" TIMESTAMP(3);
ALTER TABLE "requests" ADD COLUMN "escalation_level" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

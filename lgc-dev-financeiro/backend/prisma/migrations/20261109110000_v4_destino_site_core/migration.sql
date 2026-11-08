-- V4 / F1 (docs/mapa-interoperabilidade.md): destino do orçamento pode apontar para o site do Core.
-- Aditiva: coluna nula, sem mexer nos destinos existentes. Km e pedágio continuam do Financeiro.
ALTER TABLE "budget_destinations" ADD COLUMN "site_axis_id" TEXT;

CREATE INDEX "budget_destinations_site_axis_id_idx" ON "budget_destinations"("site_axis_id");

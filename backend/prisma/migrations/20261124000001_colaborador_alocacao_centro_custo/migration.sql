-- Histórico de alocação do colaborador em centro de custo (docs/integracao-centros-de-custo.md §2).
-- `valid_to` é exclusivo (o último dia alocado é valid_to - 1); nulo = vigente.
CREATE TABLE "collaborator_cost_center_allocations" (
    "id" TEXT NOT NULL,
    "collaborator_id" TEXT NOT NULL,
    "cost_center_id" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collaborator_cost_center_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "collaborator_cost_center_allocations_period_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from")
);

CREATE INDEX "collaborator_cost_center_allocations_collaborator_id_valid__idx" ON "collaborator_cost_center_allocations"("collaborator_id", "valid_from");
CREATE INDEX "collaborator_cost_center_allocations_cost_center_id_idx" ON "collaborator_cost_center_allocations"("cost_center_id");
-- No máximo uma alocação vigente por colaborador (índice parcial; fica fora do schema do Prisma).
CREATE UNIQUE INDEX "collaborator_cost_center_allocations_current_key" ON "collaborator_cost_center_allocations"("collaborator_id") WHERE "valid_to" IS NULL;

ALTER TABLE "collaborator_cost_center_allocations" ADD CONSTRAINT "collaborator_cost_center_allocations_collaborator_id_fkey" FOREIGN KEY ("collaborator_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaborator_cost_center_allocations" ADD CONSTRAINT "collaborator_cost_center_allocations_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: quem já tem CC ganha uma alocação a partir da admissão (ou do cadastro, no dia de
-- São Paulo). Datas só-data (`admission_date`) são gravadas à meia-noite UTC, por isso o `::date` direto.
-- Desligado: a alocação já nasce fechada na data do desligamento (ou da última alteração, para
-- quem foi desligado pela tela antes de `offboarded_at` ser preenchido nesse caminho).
INSERT INTO "collaborator_cost_center_allocations" ("id", "collaborator_id", "cost_center_id", "valid_from", "valid_to")
SELECT
  gen_random_uuid()::text,
  c."id",
  c."cost_center_id",
  v."valid_from",
  CASE WHEN c."status" = 'desligado'
    THEN GREATEST(v."valid_from", ((COALESCE(c."offboarded_at", c."updated_at") AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date)
  END
FROM "collaborators" c
CROSS JOIN LATERAL (
  SELECT COALESCE(c."admission_date"::date, ((c."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date) AS "valid_from"
) v
WHERE c."cost_center_id" IS NOT NULL;

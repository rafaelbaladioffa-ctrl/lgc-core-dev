-- Requisições Fase 2, primeiro incremento (REQUISICOES_SPEC.md §9.1/§11.14): delegação de
-- aprovação e vínculo entre requisições (usado por reopen() para a reabertura fora da janela de
-- 5 dias úteis).

-- CreateEnum
CREATE TYPE "RequestRelationType" AS ENUM ('depende_de', 'bloqueia', 'duplica', 'origina', 'subtarefa_de');

-- CreateTable
CREATE TABLE "delegations" (
    "id" TEXT NOT NULL,
    "delegator_id" TEXT NOT NULL,
    "delegate_id" TEXT NOT NULL,
    "sector_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "approved_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_relations" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "relation_type" "RequestRelationType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delegations_delegator_id_idx" ON "delegations"("delegator_id");
CREATE INDEX "delegations_delegate_id_idx" ON "delegations"("delegate_id");

-- CreateIndex
CREATE INDEX "request_relations_source_id_idx" ON "request_relations"("source_id");
CREATE INDEX "request_relations_target_id_idx" ON "request_relations"("target_id");

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegator_id_fkey" FOREIGN KEY ("delegator_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_relations" ADD CONSTRAINT "request_relations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "request_relations" ADD CONSTRAINT "request_relations_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

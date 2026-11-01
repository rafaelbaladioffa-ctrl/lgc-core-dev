-- Matriz de alçada financeira dinâmica (REQUISICOES_SPEC.md §9.2) — faixas de valor
-- administráveis via API, não fixas no código. Quinto incremento da Fase 2.

ALTER TABLE "request_categories" ADD COLUMN "use_dynamic_authority" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "approval_authority_rules" (
    "id" TEXT NOT NULL,
    "sector_id" TEXT,
    "min_value" DECIMAL(19,4) NOT NULL,
    "max_value" DECIMAL(19,4),
    "levels" "ManagementLevel"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_authority_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_authority_rules_sector_id_idx" ON "approval_authority_rules"("sector_id");

-- AddForeignKey
ALTER TABLE "approval_authority_rules" ADD CONSTRAINT "approval_authority_rules_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

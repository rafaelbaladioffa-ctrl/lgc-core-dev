-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('ABERTA', 'ENVIADA_AXIS', 'APROVADA_AXIS', 'ATENDIDA', 'DESCARTADA');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('ESTOQUE_ABAIXO_PONTO_REPOSICAO', 'RUPTURA_PREVISTA', 'LOTE_VENCENDO', 'RESERVA_EXPIRANDO', 'REQUISICAO_SEM_MOVIMENTO', 'MATERIAL_BLOQUEADO_RESERVADO', 'TRANSITO_NAO_RECEBIDO', 'CUSTODIA_VENCIDA', 'DIVERGENCIA_INVENTARIO', 'FALHA_INTEGRACAO', 'CONSUMO_ANOMALO');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'ATENCAO', 'CRITICO');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ABERTO', 'RECONHECIDO', 'RESOLVIDO');

-- CreateTable
CREATE TABLE "stock_policies" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "min_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "max_qty" DECIMAL(18,6),
    "safety_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reorder_point" DECIMAL(18,6),
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replenishment_suggestions" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'ABERTA',
    "suggested_qty" DECIMAL(18,6) NOT NULL,
    "approved_qty" DECIMAL(18,6),
    "expected_at" DATE,
    "axis_purchase_order_id" TEXT,
    "justification" JSONB NOT NULL DEFAULT '{}',
    "discard_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "replenishment_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ABERTO',
    "warehouse_id" TEXT,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "message" TEXT NOT NULL,
    "responsible_role" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_policies_material_id_warehouse_id_key" ON "stock_policies"("material_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "replenishment_suggestions_seq_key" ON "replenishment_suggestions"("seq");

-- CreateIndex
CREATE INDEX "replenishment_suggestions_warehouse_id_material_id_status_idx" ON "replenishment_suggestions"("warehouse_id", "material_id", "status");

-- CreateIndex
CREATE INDEX "alerts_status_severity_idx" ON "alerts"("status", "severity");

-- CreateIndex
CREATE INDEX "alerts_dedupe_key_status_idx" ON "alerts"("dedupe_key", "status");

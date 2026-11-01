-- CreateEnum
CREATE TYPE "StockCountType" AS ENUM ('GERAL', 'ROTATIVO_ABC', 'ENDERECO', 'ITEM', 'LOTE', 'PROJETO', 'AMOSTRAGEM');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('ABERTA', 'EM_CONTAGEM', 'EM_RECONTAGEM', 'APURADA', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "CountLineStatus" AS ENUM ('PENDENTE', 'CONTADO', 'RECONTAR', 'CONFERIDO', 'DIVERGENTE');

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "type" "StockCountType" NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'ABERTA',
    "warehouse_id" TEXT NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "tolerance_pct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "frozen" BOOLEAN NOT NULL DEFAULT true,
    "action_plan" TEXT,
    "approval_ref" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "serial_id" TEXT,
    "condition" "StockCondition" NOT NULL DEFAULT 'DISPONIVEL',
    "ownership" "Ownership" NOT NULL DEFAULT 'PROPRIO',
    "system_qty" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,4),
    "count1_qty" DECIMAL(18,6),
    "count1_by" TEXT,
    "count1_at" TIMESTAMP(3),
    "count2_qty" DECIMAL(18,6),
    "count2_by" TEXT,
    "count2_at" TIMESTAMP(3),
    "final_qty" DECIMAL(18,6),
    "variance_qty" DECIMAL(18,6),
    "status" "CountLineStatus" NOT NULL DEFAULT 'PENDENTE',
    "reason" TEXT,
    "notes" TEXT,
    "adjustment_movement_id" TEXT,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_seq_key" ON "stock_counts"("seq");

-- CreateIndex
CREATE INDEX "stock_counts_warehouse_id_status_idx" ON "stock_counts"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "stock_count_lines_count_id_status_idx" ON "stock_count_lines"("count_id", "status");

-- CreateIndex
CREATE INDEX "stock_count_lines_location_id_idx" ON "stock_count_lines"("location_id");

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

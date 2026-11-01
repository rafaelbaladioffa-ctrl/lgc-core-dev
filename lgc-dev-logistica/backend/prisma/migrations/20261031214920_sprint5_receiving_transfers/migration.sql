-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('AGENDADO', 'EM_CONFERENCIA', 'RECEBIDO_PENDENTE_INSPECAO', 'LIBERADO', 'ARMAZENADO', 'DIVERGENTE', 'QUARENTENA', 'REJEITADO', 'DEVOLVIDO_FORNECEDOR');

-- CreateEnum
CREATE TYPE "ReceiptItemStatus" AS ENUM ('CONFERIDO', 'EM_INSPECAO', 'LIBERADO', 'REJEITADO', 'ARMAZENADO');

-- CreateEnum
CREATE TYPE "InspectionDecision" AS ENUM ('APROVADO', 'REPROVADO');

-- CreateEnum
CREATE TYPE "PutawayStatus" AS ENUM ('ABERTA', 'CONCLUIDA');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('SOLICITADA', 'APROVADA', 'SEPARANDO', 'EXPEDIDA', 'EM_TRANSITO', 'RECEBIDA', 'ENCERRADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "receiving_location_id" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'AGENDADO',
    "axis_purchase_order_id" TEXT,
    "supplier_axis_id" TEXT,
    "invoice_number" TEXT,
    "vehicle" TEXT,
    "volumes" INTEGER,
    "exception_approval_ref" TEXT,
    "expected_items" JSONB NOT NULL DEFAULT '[]',
    "has_divergence" BOOLEAN NOT NULL DEFAULT false,
    "divergence_notes" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT NOT NULL,
    "completed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_items" (
    "id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "lot_number" TEXT,
    "manufactured_at" DATE,
    "expires_at" DATE,
    "serials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "damaged" BOOLEAN NOT NULL DEFAULT false,
    "inspection_required" BOOLEAN NOT NULL DEFAULT false,
    "inspection_reason" TEXT,
    "unit_cost" DECIMAL(18,4),
    "photo_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certificate_ref" TEXT,
    "notes" TEXT,
    "status" "ReceiptItemStatus" NOT NULL DEFAULT 'CONFERIDO',
    "lot_id" TEXT,
    "serial_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_results" (
    "id" TEXT NOT NULL,
    "receipt_item_id" TEXT NOT NULL,
    "decision" "InspectionDecision" NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "certificate_ref" TEXT,
    "notes" TEXT,
    "inspected_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "putaway_tasks" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "receipt_item_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "serial_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quantity" DECIMAL(18,6) NOT NULL,
    "from_location_id" TEXT NOT NULL,
    "suggested_location_id" TEXT,
    "confirmed_location_id" TEXT,
    "condition" "StockCondition" NOT NULL DEFAULT 'DISPONIVEL',
    "status" "PutawayStatus" NOT NULL DEFAULT 'ABERTA',
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "putaway_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "from_warehouse_id" TEXT NOT NULL,
    "to_warehouse_id" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'SOLICITADA',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "has_divergence" BOOLEAN NOT NULL DEFAULT false,
    "requested_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "separated_by" TEXT,
    "dispatched_by" TEXT,
    "received_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_items" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "from_location_id" TEXT NOT NULL,
    "to_location_id" TEXT,
    "lot_id" TEXT,
    "serial_id" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "balance_id" TEXT,
    "reserved_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "received_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_seq_key" ON "receipts"("seq");

-- CreateIndex
CREATE INDEX "receipts_warehouse_id_status_idx" ON "receipts"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "receipt_items_receipt_id_idx" ON "receipt_items"("receipt_id");

-- CreateIndex
CREATE INDEX "inspection_results_receipt_item_id_idx" ON "inspection_results"("receipt_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "putaway_tasks_seq_key" ON "putaway_tasks"("seq");

-- CreateIndex
CREATE INDEX "putaway_tasks_warehouse_id_status_idx" ON "putaway_tasks"("warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_seq_key" ON "transfers"("seq");

-- CreateIndex
CREATE INDEX "transfers_status_idx" ON "transfers"("status");

-- CreateIndex
CREATE INDEX "transfer_items_transfer_id_idx" ON "transfer_items"("transfer_id");

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "receipt_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "receipt_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

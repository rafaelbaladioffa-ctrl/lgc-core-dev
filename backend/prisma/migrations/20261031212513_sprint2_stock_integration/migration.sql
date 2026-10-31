-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('LIBERADO', 'QUARENTENA', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "SerialCondition" AS ENUM ('NOVO', 'BOM', 'EM_MANUTENCAO', 'AVARIADO', 'BAIXADO');

-- CreateEnum
CREATE TYPE "StockCondition" AS ENUM ('DISPONIVEL', 'QUARENTENA', 'BLOQUEADO', 'AVARIADO');

-- CreateEnum
CREATE TYPE "Ownership" AS ENUM ('PROPRIO', 'CLIENTE', 'TERCEIRO_CONSIGNADO', 'LGC_EM_TERCEIRO');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRADA_RECEBIMENTO', 'ENTRADA_DEVOLUCAO', 'SAIDA_ENTREGA', 'TRANSFERENCIA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'BAIXA_PERDA', 'DESCARTE');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED', 'PENDING', 'DELIVERED');

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "lot_number" TEXT NOT NULL,
    "manufactured_at" DATE,
    "expires_at" DATE,
    "status" "LotStatus" NOT NULL DEFAULT 'LIBERADO',
    "status_reason" TEXT,
    "supplier_axis_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_numbers" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "asset_tag" TEXT,
    "condition" "SerialCondition" NOT NULL DEFAULT 'NOVO',
    "lot_id" TEXT,
    "current_location_id" TEXT,
    "custodian_axis_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serial_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "type" "MovementType" NOT NULL,
    "material_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "serial_id" TEXT,
    "from_location_id" TEXT,
    "to_location_id" TEXT,
    "from_condition" "StockCondition" NOT NULL DEFAULT 'DISPONIVEL',
    "to_condition" "StockCondition" NOT NULL DEFAULT 'DISPONIVEL',
    "ownership" "Ownership" NOT NULL DEFAULT 'PROPRIO',
    "reason" TEXT NOT NULL,
    "axis_document_ref" TEXT,
    "axis_approval_ref" TEXT,
    "logistics_document_ref" TEXT,
    "project_axis_id" TEXT,
    "cost_center_axis_id" TEXT,
    "client_axis_id" TEXT,
    "custodian_axis_id" TEXT,
    "unit_cost" DECIMAL(18,4),
    "effective_at" TIMESTAMP(3) NOT NULL,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_axis_id" TEXT NOT NULL,
    "device_id" TEXT,
    "reverses_movement_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "lot_key" TEXT NOT NULL DEFAULT '',
    "condition" "StockCondition" NOT NULL DEFAULT 'DISPONIVEL',
    "ownership" "Ownership" NOT NULL DEFAULT 'PROPRIO',
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reserved_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_messages" (
    "id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "correlation_id" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "integration_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "axis_master_cache" (
    "kind" TEXT NOT NULL,
    "axis_id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "data" JSONB NOT NULL DEFAULT '{}',
    "source_occurred_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "axis_master_cache_pkey" PRIMARY KEY ("kind","axis_id")
);

-- CreateIndex
CREATE INDEX "lots_material_id_expires_at_idx" ON "lots"("material_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "lots_material_id_lot_number_key" ON "lots"("material_id", "lot_number");

-- CreateIndex
CREATE UNIQUE INDEX "serial_numbers_asset_tag_key" ON "serial_numbers"("asset_tag");

-- CreateIndex
CREATE INDEX "serial_numbers_current_location_id_idx" ON "serial_numbers"("current_location_id");

-- CreateIndex
CREATE UNIQUE INDEX "serial_numbers_material_id_serial_key" ON "serial_numbers"("material_id", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_seq_key" ON "stock_movements"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_reverses_movement_id_key" ON "stock_movements"("reverses_movement_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_idempotency_key_key" ON "stock_movements"("idempotency_key");

-- CreateIndex
CREATE INDEX "stock_movements_material_id_effective_at_idx" ON "stock_movements"("material_id", "effective_at");

-- CreateIndex
CREATE INDEX "stock_movements_from_location_id_idx" ON "stock_movements"("from_location_id");

-- CreateIndex
CREATE INDEX "stock_movements_to_location_id_idx" ON "stock_movements"("to_location_id");

-- CreateIndex
CREATE INDEX "stock_movements_correlation_id_idx" ON "stock_movements"("correlation_id");

-- CreateIndex
CREATE INDEX "stock_balances_location_id_idx" ON "stock_balances"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_material_id_location_id_lot_key_condition_ow_key" ON "stock_balances"("material_id", "location_id", "lot_key", "condition", "ownership");

-- CreateIndex
CREATE INDEX "integration_messages_direction_status_next_attempt_at_idx" ON "integration_messages"("direction", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_messages_direction_event_id_key" ON "integration_messages"("direction", "event_id");

-- CreateIndex
CREATE INDEX "axis_master_cache_kind_active_idx" ON "axis_master_cache"("kind", "active");

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_current_location_id_fkey" FOREIGN KEY ("current_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "serial_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reverses_movement_id_fkey" FOREIGN KEY ("reverses_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sem estoque negativo (PLANNING_LOGISTICA 11.2) e reserva coerente.
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_quantity_nonneg" CHECK ("quantity" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_reserved_range" CHECK ("reserved_qty" >= 0 AND "reserved_qty" <= "quantity");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_qty_positive" CHECK ("quantity" > 0);

-- Ledger imutável (11.1): nenhuma alteração ou remoção, nem por acidente. Correção = movimento reverso.
CREATE FUNCTION "stock_movements_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements e imutavel: use um movimento reverso vinculado';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "stock_movements_no_update" BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_immutable"();
CREATE TRIGGER "stock_movements_no_truncate" BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "stock_movements_immutable"();

-- Trilha de auditoria append-only (20).
CREATE TRIGGER "audit_events_no_update" BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_immutable"();

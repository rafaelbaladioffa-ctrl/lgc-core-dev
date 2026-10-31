-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('RECEBIDA', 'EM_ANALISE', 'RESERVADA', 'RESERVADA_PARCIAL', 'LIBERADA_SEPARACAO', 'EM_SEPARACAO', 'SEPARADA', 'EM_CONFERENCIA', 'PRONTA_EXPEDICAO', 'EXPEDIDA', 'ENTREGUE', 'ENCERRADA', 'AGUARDANDO_ESTOQUE', 'AGUARDANDO_INFORMACAO', 'BLOQUEADA', 'CANCELAMENTO_SOLICITADO', 'CANCELADA', 'DIVERGENCIA');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ATIVA', 'CONSUMIDA', 'LIBERADA', 'EXPIRADA');

-- CreateTable
CREATE TABLE "fulfillment_orders" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "axis_request_id" TEXT NOT NULL,
    "request_version" INTEGER NOT NULL DEFAULT 1,
    "source_event_id" TEXT,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'RECEBIDA',
    "status_reason" TEXT,
    "warehouse_id" TEXT,
    "project_axis_id" TEXT,
    "cost_center_axis_id" TEXT,
    "requester_axis_id" TEXT,
    "recipient_axis_id" TEXT,
    "needed_by" DATE,
    "notes" TEXT,
    "reference_warnings" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "requested_material_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "balance_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ATIVA',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "release_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_orders_seq_key" ON "fulfillment_orders"("seq");

-- CreateIndex
CREATE INDEX "fulfillment_orders_status_idx" ON "fulfillment_orders"("status");

-- CreateIndex
CREATE INDEX "fulfillment_orders_requester_axis_id_idx" ON "fulfillment_orders"("requester_axis_id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_orders_axis_request_id_request_version_key" ON "fulfillment_orders"("axis_request_id", "request_version");

-- CreateIndex
CREATE INDEX "fulfillment_items_order_id_idx" ON "fulfillment_items"("order_id");

-- CreateIndex
CREATE INDEX "fulfillment_items_material_id_idx" ON "fulfillment_items"("material_id");

-- CreateIndex
CREATE INDEX "reservations_item_id_idx" ON "reservations"("item_id");

-- CreateIndex
CREATE INDEX "reservations_status_expires_at_idx" ON "reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "reservations_balance_id_idx" ON "reservations"("balance_id");

-- AddForeignKey
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "fulfillment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "fulfillment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

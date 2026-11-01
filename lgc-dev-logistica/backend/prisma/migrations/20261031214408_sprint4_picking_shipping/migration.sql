-- CreateEnum
CREATE TYPE "PickingTaskStatus" AS ENUM ('ABERTA', 'EM_SEPARACAO', 'SEPARADA', 'EM_CONFERENCIA', 'CONFERIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PickingItemStatus" AS ENUM ('PENDENTE', 'SEPARADO', 'DIVERGENTE');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PRONTO', 'EXPEDIDA', 'PARCIAL', 'ENTREGUE', 'RECUSADA');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('ABERTO', 'EXPEDIDO', 'ENTREGUE', 'RECUSADO');

-- CreateEnum
CREATE TYPE "DeliveryOutcome" AS ENUM ('ENTREGUE', 'PARCIAL', 'RECUSADA');

-- CreateTable
CREATE TABLE "picking_tasks" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "order_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "status" "PickingTaskStatus" NOT NULL DEFAULT 'ABERTA',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "requires_check" BOOLEAN NOT NULL DEFAULT false,
    "picked_by" TEXT,
    "checked_by" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "checked_at" TIMESTAMP(3),

    CONSTRAINT "picking_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "picking_items" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "fulfillment_item_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "serial_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quantity_planned" DECIMAL(18,6) NOT NULL,
    "quantity_picked" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "PickingItemStatus" NOT NULL DEFAULT 'PENDENTE',
    "divergence_reason" TEXT,

    CONSTRAINT "picking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PRONTO',
    "destination" TEXT,
    "carrier" TEXT,
    "route" TEXT,
    "vehicle" TEXT,
    "manifest_code" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "dispatched_by" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'ABERTO',
    "weight_kg" DECIMAL(12,4),
    "length_cm" DECIMAL(10,2),
    "width_cm" DECIMAL(10,2),
    "height_cm" DECIMAL(10,2),
    "seal" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_items" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "picking_item_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_proofs" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "outcome" "DeliveryOutcome" NOT NULL,
    "receiver_name" TEXT NOT NULL,
    "receiver_axis_id" TEXT,
    "delivered_at" TIMESTAMP(3) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "signature_ref" TEXT,
    "photo_ref" TEXT,
    "notes" TEXT,
    "package_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "registered_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "picking_tasks_seq_key" ON "picking_tasks"("seq");

-- CreateIndex
CREATE INDEX "picking_tasks_order_id_idx" ON "picking_tasks"("order_id");

-- CreateIndex
CREATE INDEX "picking_tasks_warehouse_id_status_idx" ON "picking_tasks"("warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "picking_items_reservation_id_key" ON "picking_items"("reservation_id");

-- CreateIndex
CREATE INDEX "picking_items_task_id_idx" ON "picking_items"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_seq_key" ON "shipments"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_manifest_code_key" ON "shipments"("manifest_code");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "packages_seq_key" ON "packages"("seq");

-- CreateIndex
CREATE INDEX "packages_shipment_id_idx" ON "packages"("shipment_id");

-- CreateIndex
CREATE INDEX "package_items_package_id_idx" ON "package_items"("package_id");

-- CreateIndex
CREATE INDEX "package_items_picking_item_id_idx" ON "package_items"("picking_item_id");

-- CreateIndex
CREATE INDEX "delivery_proofs_shipment_id_idx" ON "delivery_proofs"("shipment_id");

-- AddForeignKey
ALTER TABLE "picking_items" ADD CONSTRAINT "picking_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "picking_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_picking_item_id_fkey" FOREIGN KEY ("picking_item_id") REFERENCES "picking_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

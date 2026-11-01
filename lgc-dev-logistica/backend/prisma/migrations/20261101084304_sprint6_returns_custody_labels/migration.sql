-- CreateEnum
CREATE TYPE "CustodyStatus" AS ENUM ('ATIVO', 'DEVOLVIDO', 'PERDIDO');

-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('SOBRA', 'FERRAMENTA', 'ATIVO', 'DEFEITUOSO', 'AVARIA', 'TROCA_TAMANHO', 'RETORNO_PROJETO', 'RETORNO_TERCEIRO');

-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('DISPONIVEL', 'MANUTENCAO', 'QUARENTENA', 'AVARIADO_REPARO', 'SUCATA');

-- CreateEnum
CREATE TYPE "ReturnItemStatus" AS ENUM ('PENDENTE_INSPECAO', 'CLASSIFICADO');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('RECEBIDA', 'ENCERRADA');

-- CreateTable
CREATE TABLE "custody_terms" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "custodian_axis_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "serial_id" TEXT,
    "lot_id" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "returned_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "CustodyStatus" NOT NULL DEFAULT 'ATIVO',
    "order_id" TEXT,
    "shipment_id" TEXT,
    "project_axis_id" TEXT,
    "acceptance_ref" TEXT,
    "expected_return_at" DATE,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "close_notes" TEXT,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "custody_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "type" "ReturnType" NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'RECEBIDA',
    "warehouse_id" TEXT NOT NULL,
    "receiving_location_id" TEXT NOT NULL,
    "returned_by_axis_id" TEXT,
    "project_axis_id" TEXT,
    "custody_term_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "lot_id" TEXT,
    "serial_id" TEXT,
    "status" "ReturnItemStatus" NOT NULL DEFAULT 'PENDENTE_INSPECAO',
    "disposition" "ReturnDisposition",
    "classified_by" TEXT,
    "classified_at" TIMESTAMP(3),
    "approval_ref" TEXT,
    "notes" TEXT,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label_prints" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "format" TEXT NOT NULL DEFAULT 'json',
    "is_reprint" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "printed_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "label_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custody_terms_seq_key" ON "custody_terms"("seq");

-- CreateIndex
CREATE INDEX "custody_terms_custodian_axis_id_status_idx" ON "custody_terms"("custodian_axis_id", "status");

-- CreateIndex
CREATE INDEX "custody_terms_material_id_idx" ON "custody_terms"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "returns_seq_key" ON "returns"("seq");

-- CreateIndex
CREATE INDEX "returns_warehouse_id_status_idx" ON "returns"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "return_items_return_id_idx" ON "return_items"("return_id");

-- CreateIndex
CREATE INDEX "label_prints_kind_ref_id_idx" ON "label_prints"("kind", "ref_id");

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

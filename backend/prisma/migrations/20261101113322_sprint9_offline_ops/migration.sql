-- CreateEnum
CREATE TYPE "OfflineOpStatus" AS ENUM ('APLICADA', 'CONFLITO', 'REJEITADA');

-- CreateTable
CREATE TABLE "offline_operations" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "op_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "OfflineOpStatus" NOT NULL,
    "message" TEXT,
    "code" TEXT,
    "result" JSONB,
    "client_at" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offline_operations_user_id_applied_at_idx" ON "offline_operations"("user_id", "applied_at");

-- CreateIndex
CREATE UNIQUE INDEX "offline_operations_device_id_op_id_key" ON "offline_operations"("device_id", "op_id");

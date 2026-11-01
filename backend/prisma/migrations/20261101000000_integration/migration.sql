-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "SatelliteStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "integration_outbox" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "integration_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_satellites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhook_url" TEXT NOT NULL,
    "hmac_secret_enc" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "status" "SatelliteStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_satellites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_subscriptions" (
    "satellite_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,

    CONSTRAINT "integration_subscriptions_pkey" PRIMARY KEY ("satellite_id","event_type")
);

-- CreateIndex
CREATE INDEX "integration_outbox_status_next_attempt_at_idx" ON "integration_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_satellites_name_key" ON "integration_satellites"("name");

-- AddForeignKey
ALTER TABLE "integration_subscriptions" ADD CONSTRAINT "integration_subscriptions_satellite_id_fkey" FOREIGN KEY ("satellite_id") REFERENCES "integration_satellites"("id") ON DELETE CASCADE ON UPDATE CASCADE;


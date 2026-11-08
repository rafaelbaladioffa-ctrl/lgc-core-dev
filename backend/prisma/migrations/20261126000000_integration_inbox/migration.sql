-- Receptor de eventos dos satélites (PT-02): caixa de entrada com deduplicação por (satélite, evento).
CREATE TYPE "InboxStatus" AS ENUM ('processed', 'ignored', 'failed');

CREATE TABLE "integration_inbox" (
    "id" TEXT NOT NULL,
    "satellite_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "InboxStatus" NOT NULL,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "integration_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_inbox_satellite_id_event_id_key" ON "integration_inbox"("satellite_id", "event_id");
CREATE INDEX "integration_inbox_received_at_idx" ON "integration_inbox"("received_at");
CREATE INDEX "integration_inbox_status_received_at_idx" ON "integration_inbox"("status", "received_at");

ALTER TABLE "integration_inbox" ADD CONSTRAINT "integration_inbox_satellite_id_fkey" FOREIGN KEY ("satellite_id") REFERENCES "integration_satellites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

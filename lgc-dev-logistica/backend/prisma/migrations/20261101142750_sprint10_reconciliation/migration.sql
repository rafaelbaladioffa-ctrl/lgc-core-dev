-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('ABERTA', 'RESOLVIDA');

-- CreateTable
CREATE TABLE "reconciliation_issues" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'ATENCAO',
    "ref_type" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" "IssueStatus" NOT NULL DEFAULT 'ABERTA',
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution" TEXT,

    CONSTRAINT "reconciliation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_issues_status_kind_idx" ON "reconciliation_issues"("status", "kind");

-- CreateIndex
CREATE INDEX "reconciliation_issues_dedupe_key_status_idx" ON "reconciliation_issues"("dedupe_key", "status");

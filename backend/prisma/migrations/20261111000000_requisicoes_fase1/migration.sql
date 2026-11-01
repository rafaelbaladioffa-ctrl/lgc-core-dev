-- Replaces the ticket_* "Requisições" implementation with Fase 1 of the new, much broader spec
-- (REQUISICOES_SPEC.md), which supersedes PLANNING.md §4.6 entirely — different data model
-- (versioned catalog, full lifecycle states, audit_events), not an incremental change.

-- DropForeignKey/DropTable (CASCADE also drops their own FKs/indexes)
DROP TABLE IF EXISTS "ticket_approvals" CASCADE;
DROP TABLE IF EXISTS "ticket_approval_steps" CASCADE;
DROP TABLE IF EXISTS "ticket_attachments" CASCADE;
DROP TABLE IF EXISTS "ticket_comments" CASCADE;
DROP TABLE IF EXISTS "tickets" CASCADE;
DROP TABLE IF EXISTS "ticket_categories" CASCADE;
DROP TABLE IF EXISTS "ticket_forms" CASCADE;

DROP SEQUENCE IF EXISTS "ticket_number_seq";

-- ManagementLevel stays (collaborators.management_level depends on it; still used to resolve
-- the approval chain here, just driven by CategoryVersion.workflow_schema now).
DROP TYPE IF EXISTS "TicketApprovalStatus";
DROP TYPE IF EXISTS "TicketStatus";

-- CreateEnum
CREATE TYPE "RequestConfidentiality" AS ENUM ('interna', 'confidencial', 'restrita');

-- CreateEnum
CREATE TYPE "RequestPriority" AS ENUM ('baixa', 'normal', 'alta', 'critica');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('rascunho', 'enviada', 'em_triagem', 'aguardando_aprovacao', 'aprovada', 'planejada', 'em_atendimento', 'aguardando_solicitante', 'aguardando_terceiro', 'concluida', 'encerrada', 'devolvida_ajuste', 'reprovada', 'cancelada', 'suspensa', 'reaberta', 'expirada');

-- CreateEnum
CREATE TYPE "RequestApprovalStatus" AS ENUM ('pendente', 'aprovado', 'reprovado', 'devolvido');

-- CreateEnum
CREATE TYPE "RequestCommentVisibility" AS ENUM ('publico', 'interno');

-- CreateEnum
CREATE TYPE "SlaMetric" AS ENUM ('primeira_resposta', 'solucao');

-- CreateTable
CREATE TABLE "request_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "parent_category_id" TEXT,
    "confidentiality" "RequestConfidentiality" NOT NULL DEFAULT 'interna',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_versions" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "form_schema" JSONB NOT NULL,
    "workflow_schema" JSONB NOT NULL,
    "sla_first_response_minutes" INTEGER NOT NULL,
    "sla_resolution_minutes" INTEGER NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queues" (
    "id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category_version_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "queue_id" TEXT,
    "requester_id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "RequestPriority" NOT NULL DEFAULT 'normal',
    "confidentiality" "RequestConfidentiality" NOT NULL DEFAULT 'interna',
    "status" "RequestStatus" NOT NULL DEFAULT 'rascunho',
    "needed_by" TIMESTAMP(3),
    "project_id" TEXT,
    "cost_center_id" TEXT,
    "estimated_value" DECIMAL(19,4),
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "form_data" JSONB,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "sla_due_first_response_at" TIMESTAMP(3),
    "sla_due_resolution_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_number_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "request_number_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "required_level" "ManagementLevel",
    "approver_id" TEXT NOT NULL,
    "status" "RequestApprovalStatus" NOT NULL DEFAULT 'pendente',
    "decided_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_comments" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "visibility" "RequestCommentVisibility" NOT NULL DEFAULT 'publico',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_attachments" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_clocks" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "metric" "SlaMetric" NOT NULL,
    "target_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paused_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),
    "breached" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sla_clocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actor_id" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "correlation_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'api',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "request_categories_code_key" ON "request_categories"("code");
CREATE INDEX "request_categories_sector_id_idx" ON "request_categories"("sector_id");
CREATE INDEX "request_categories_parent_category_id_idx" ON "request_categories"("parent_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_versions_category_id_version_key" ON "category_versions"("category_id", "version");
CREATE INDEX "category_versions_category_id_idx" ON "category_versions"("category_id");

-- CreateIndex
CREATE INDEX "queues_sector_id_idx" ON "queues"("sector_id");

-- CreateIndex
CREATE UNIQUE INDEX "requests_code_key" ON "requests"("code");
CREATE INDEX "requests_category_version_id_idx" ON "requests"("category_version_id");
CREATE INDEX "requests_sector_id_idx" ON "requests"("sector_id");
CREATE INDEX "requests_queue_id_idx" ON "requests"("queue_id");
CREATE INDEX "requests_status_idx" ON "requests"("status");
CREATE INDEX "requests_requester_id_idx" ON "requests"("requester_id");
CREATE INDEX "requests_assignee_id_idx" ON "requests"("assignee_id");

-- CreateIndex
CREATE INDEX "approvals_request_id_idx" ON "approvals"("request_id");
CREATE INDEX "approvals_approver_id_idx" ON "approvals"("approver_id");

-- CreateIndex
CREATE INDEX "request_comments_request_id_idx" ON "request_comments"("request_id");

-- CreateIndex
CREATE INDEX "request_attachments_request_id_idx" ON "request_attachments"("request_id");

-- CreateIndex
CREATE INDEX "sla_clocks_request_id_idx" ON "sla_clocks"("request_id");

-- CreateIndex
CREATE INDEX "audit_events_aggregate_type_aggregate_id_idx" ON "audit_events"("aggregate_type", "aggregate_id");
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");

-- AddForeignKey
ALTER TABLE "request_categories" ADD CONSTRAINT "request_categories_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_categories" ADD CONSTRAINT "request_categories_parent_category_id_fkey" FOREIGN KEY ("parent_category_id") REFERENCES "request_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_versions" ADD CONSTRAINT "category_versions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "request_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_category_version_id_fkey" FOREIGN KEY ("category_version_id") REFERENCES "category_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "requests" ADD CONSTRAINT "requests_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "requests" ADD CONSTRAINT "requests_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "requests" ADD CONSTRAINT "requests_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "requests" ADD CONSTRAINT "requests_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "collaborators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requests" ADD CONSTRAINT "requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requests" ADD CONSTRAINT "requests_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_clocks" ADD CONSTRAINT "sla_clocks_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full rebuild of the "Requisições" module (tables tracked as ticket_*), requested directly by
-- the user to start from a clean baseline — not a requirements change, same data model as
-- PLANNING.md §5.10-5.13.2. Drops every ticket_* table/sequence/enum from the previous
-- implementation and recreates them from scratch in this single migration.

-- DropForeignKey (drop tables bottom-up through the dependency graph; CASCADE also removes their
-- own FKs/indexes, so no separate DROP CONSTRAINT statements are needed)
DROP TABLE IF EXISTS "ticket_approvals" CASCADE;
DROP TABLE IF EXISTS "ticket_approval_steps" CASCADE;
DROP TABLE IF EXISTS "ticket_attachments" CASCADE;
DROP TABLE IF EXISTS "ticket_comments" CASCADE;
DROP TABLE IF EXISTS "tickets" CASCADE;
DROP TABLE IF EXISTS "ticket_categories" CASCADE;
DROP TABLE IF EXISTS "ticket_forms" CASCADE;

DROP SEQUENCE IF EXISTS "ticket_number_seq";

-- ManagementLevel stays (collaborators.management_level depends on it, unrelated to this rebuild).
DROP TYPE IF EXISTS "TicketApprovalStatus";
DROP TYPE IF EXISTS "TicketStatus";

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('aberto', 'em_aprovacao', 'rejeitado', 'em_andamento', 'pendente', 'resolvido', 'fechado');

-- CreateEnum
CREATE TYPE "TicketApprovalStatus" AS ENUM ('pendente', 'aprovado', 'rejeitado');

-- CreateTable
CREATE TABLE "ticket_forms" (
    "id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_categories" (
    "id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_category_id" TEXT,
    "sla_first_response_minutes" INTEGER NOT NULL,
    "sla_resolution_minutes" INTEGER NOT NULL,
    "has_cost" BOOLEAN NOT NULL DEFAULT false,
    "form_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_approval_steps" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "required_level" "ManagementLevel" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "form_id" TEXT,
    "form_data" JSONB,
    "requester_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'aberto',
    "sla_due_first_response_at" TIMESTAMP(3),
    "sla_due_resolution_at" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_approvals" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "required_level" "ManagementLevel" NOT NULL,
    "approver_id" TEXT NOT NULL,
    "status" "TicketApprovalStatus" NOT NULL DEFAULT 'pendente',
    "decided_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_forms_sector_id_idx" ON "ticket_forms"("sector_id");

-- CreateIndex
CREATE INDEX "ticket_categories_sector_id_idx" ON "ticket_categories"("sector_id");

-- CreateIndex
CREATE INDEX "ticket_categories_parent_category_id_idx" ON "ticket_categories"("parent_category_id");

-- CreateIndex
CREATE INDEX "ticket_categories_form_id_idx" ON "ticket_categories"("form_id");

-- CreateIndex
CREATE INDEX "ticket_approval_steps_category_id_idx" ON "ticket_approval_steps"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_approval_steps_category_id_step_order_key" ON "ticket_approval_steps"("category_id", "step_order");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_sector_id_idx" ON "tickets"("sector_id");

-- CreateIndex
CREATE INDEX "tickets_category_id_idx" ON "tickets"("category_id");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_assignee_id_idx" ON "tickets"("assignee_id");

-- CreateIndex
CREATE INDEX "ticket_approvals_ticket_id_idx" ON "ticket_approvals"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_approvals_approver_id_idx" ON "ticket_approvals"("approver_id");

-- CreateIndex
CREATE INDEX "ticket_comments_ticket_id_idx" ON "ticket_comments"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_attachments_ticket_id_idx" ON "ticket_attachments"("ticket_id");

-- AddForeignKey
ALTER TABLE "ticket_forms" ADD CONSTRAINT "ticket_forms_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_parent_category_id_fkey" FOREIGN KEY ("parent_category_id") REFERENCES "ticket_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "ticket_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_approval_steps" ADD CONSTRAINT "ticket_approval_steps_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ticket_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ticket_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "ticket_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "collaborators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Native atomic sequence for the human-readable ticket number (REQ-000123).
CREATE SEQUENCE "ticket_number_seq" START WITH 1 INCREMENT BY 1;

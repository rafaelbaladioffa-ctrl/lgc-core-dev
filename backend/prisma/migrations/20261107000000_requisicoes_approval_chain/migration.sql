-- CreateEnum
CREATE TYPE "ManagementLevel" AS ENUM ('colaborador', 'supervisor', 'coordenador', 'gerente', 'diretor');

-- CreateEnum
CREATE TYPE "TicketApprovalStatus" AS ENUM ('pendente', 'aprovado', 'rejeitado');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketStatus" ADD VALUE 'em_aprovacao';
ALTER TYPE "TicketStatus" ADD VALUE 'rejeitado';

-- AlterTable
ALTER TABLE "collaborators" ADD COLUMN     "management_level" "ManagementLevel" NOT NULL DEFAULT 'colaborador';

-- AlterTable
ALTER TABLE "ticket_categories" ADD COLUMN     "has_cost" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tickets" ALTER COLUMN "sla_due_first_response_at" DROP NOT NULL,
ALTER COLUMN "sla_due_resolution_at" DROP NOT NULL;

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

-- CreateIndex
CREATE INDEX "ticket_approval_steps_category_id_idx" ON "ticket_approval_steps"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_approval_steps_category_id_step_order_key" ON "ticket_approval_steps"("category_id", "step_order");

-- CreateIndex
CREATE INDEX "ticket_approvals_ticket_id_idx" ON "ticket_approvals"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_approvals_approver_id_idx" ON "ticket_approvals"("approver_id");

-- AddForeignKey
ALTER TABLE "ticket_approval_steps" ADD CONSTRAINT "ticket_approval_steps_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ticket_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


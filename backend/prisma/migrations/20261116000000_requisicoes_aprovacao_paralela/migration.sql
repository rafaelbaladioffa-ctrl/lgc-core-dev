-- Workflow configurável com aprovação paralela (REQUISICOES_SPEC.md §9.1): TODOS/QUALQUER_UM/
-- N_DE_M por nó (stepOrder) da cadeia de aprovação. Quarto incremento da Fase 2.

-- CreateEnum
CREATE TYPE "RequestApprovalCompletionRule" AS ENUM ('todos', 'qualquer_um', 'n_de_m');

-- AlterTable
ALTER TABLE "approvals"
  ADD COLUMN "completion_rule" "RequestApprovalCompletionRule" NOT NULL DEFAULT 'todos',
  ADD COLUMN "required_count" INTEGER;

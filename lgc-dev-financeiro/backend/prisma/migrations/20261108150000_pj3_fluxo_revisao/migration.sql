-- PJ3: fluxo da revisão (projetos-especificacao §3.1): submeter, devolver, aprovar envio, ganha/perdida.

-- AlterTable
ALTER TABLE "budget_revisions" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "approved_by_email" TEXT,
ADD COLUMN     "decided_at" TIMESTAMP(3),
ADD COLUMN     "submitted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "budget_revision_events" (
    "id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "BudgetRevisionStatus" NOT NULL,
    "to_status" "BudgetRevisionStatus" NOT NULL,
    "reason" TEXT,
    "actor_axis_id" TEXT NOT NULL,
    "actor_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_revision_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_revision_events_revision_id_created_at_idx" ON "budget_revision_events"("revision_id", "created_at");

-- AddForeignKey
ALTER TABLE "budget_revision_events" ADD CONSTRAINT "budget_revision_events_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "budget_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- No máximo uma revisão enviada e uma ganha por orçamento (a enviada anterior vira substituída).
CREATE UNIQUE INDEX budget_revisions_one_sent ON "budget_revisions" ("budget_id") WHERE "status" = 'enviada';
CREATE UNIQUE INDEX budget_revisions_one_won ON "budget_revisions" ("budget_id") WHERE "status" = 'ganha';
-- No máximo uma em aprovação por orçamento.
CREATE UNIQUE INDEX budget_revisions_one_in_approval ON "budget_revisions" ("budget_id") WHERE "status" = 'em_aprovacao';

-- Só as transições do §3.1; o serviço confere antes, o banco garante.
CREATE FUNCTION budget_revisions_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.status = 'rascunho'     AND NEW.status IN ('em_aprovacao', 'descartada'))
    OR (OLD.status = 'em_aprovacao' AND NEW.status IN ('rascunho', 'enviada'))
    OR (OLD.status = 'enviada'      AND NEW.status IN ('ganha', 'perdida', 'substituida'))
  ) THEN
    RAISE EXCEPTION 'transição de revisão inválida: % → %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_revisions_transition
  BEFORE UPDATE OF "status" ON "budget_revisions"
  FOR EACH ROW EXECUTE FUNCTION budget_revisions_transition();

-- Histórico append-only.
CREATE FUNCTION budget_revision_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'histórico da revisão não pode ser alterado nem apagado';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_revision_events_append_only
  BEFORE UPDATE OR DELETE ON "budget_revision_events"
  FOR EACH ROW EXECUTE FUNCTION budget_revision_events_append_only();

-- PJ4 parte 2: Bid Template do RFQ na revisão (metas lidas do modelo), horas T à mão e justificativas dos indicadores.

-- AlterTable
ALTER TABLE "budget_revision_sow" ADD COLUMN     "field_hours_overrides" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "kpi_justifications" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "revision_bid_template" (
    "revision_id" TEXT NOT NULL,
    "quote_request_id" TEXT,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "targets" JSONB NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by" TEXT NOT NULL,

    CONSTRAINT "revision_bid_template_pkey" PRIMARY KEY ("revision_id")
);

-- AddForeignKey
ALTER TABLE "revision_bid_template" ADD CONSTRAINT "revision_bid_template_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "budget_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_bid_template" ADD CONSTRAINT "revision_bid_template_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- O Bid Template da revisão só muda enquanto a revisão está em rascunho (como a SOW).
CREATE FUNCTION revision_bid_template_guard() RETURNS trigger AS $$
DECLARE
  rev_status "BudgetRevisionStatus";
BEGIN
  SELECT status INTO rev_status FROM "budget_revisions" WHERE id = COALESCE(NEW.revision_id, OLD.revision_id);
  IF rev_status IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'Bid Template de revisão fora de rascunho é imutável';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revision_bid_template_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "revision_bid_template"
  FOR EACH ROW EXECUTE FUNCTION revision_bid_template_guard();

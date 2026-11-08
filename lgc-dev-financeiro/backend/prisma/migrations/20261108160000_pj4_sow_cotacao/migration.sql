-- PJ4: pedidos de cotação do Core (fila do orçamentista) e SOW lida na revisão (projetos-especificacao §7.1, §13.1).

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" TEXT NOT NULL,
    "axis_quote_request_id" TEXT NOT NULL,
    "axis_project_id" TEXT NOT NULL,
    "project_code" TEXT NOT NULL,
    "sow_document_id" TEXT NOT NULL,
    "sow_version" INTEGER NOT NULL,
    "sow_filename" TEXT NOT NULL,
    "sow_content_hash" TEXT NOT NULL,
    "bid_template_document_id" TEXT,
    "bid_template_version" INTEGER,
    "bid_template_filename" TEXT,
    "bid_template_content_hash" TEXT,
    "notes" TEXT,
    "requested_by_email" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "event_id" TEXT NOT NULL,
    "budget_id" TEXT,
    "started_at" TIMESTAMP(3),
    "started_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_revision_sow" (
    "revision_id" TEXT NOT NULL,
    "quote_request_id" TEXT,
    "source" TEXT NOT NULL,
    "sow_document_id" TEXT,
    "sow_version" INTEGER,
    "pages" INTEGER,
    "raw_text" TEXT NOT NULL,
    "header" JSONB NOT NULL,
    "devices" JSONB NOT NULL,
    "parsed_cables" JSONB NOT NULL,
    "cables" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "budget_revision_sow_pkey" PRIMARY KEY ("revision_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_axis_quote_request_id_key" ON "quote_requests"("axis_quote_request_id");

-- CreateIndex
CREATE INDEX "quote_requests_axis_project_id_idx" ON "quote_requests"("axis_project_id");

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "project_budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_revision_sow" ADD CONSTRAINT "budget_revision_sow_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "budget_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_revision_sow" ADD CONSTRAINT "budget_revision_sow_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A SOW da revisão só muda enquanto a revisão está em rascunho (como as entradas, gatilho da PJ2).
CREATE FUNCTION budget_revision_sow_guard() RETURNS trigger AS $$
DECLARE
  rev_status "BudgetRevisionStatus";
BEGIN
  SELECT status INTO rev_status FROM "budget_revisions" WHERE id = COALESCE(NEW.revision_id, OLD.revision_id);
  IF rev_status IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'SOW de revisão fora de rascunho é imutável';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_revision_sow_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "budget_revision_sow"
  FOR EACH ROW EXECUTE FUNCTION budget_revision_sow_guard();

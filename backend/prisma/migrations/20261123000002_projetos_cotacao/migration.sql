-- Cotação do projeto pelo Financeiro: o Core pede ("Solicitar cotação", com a SOW vigente) e o
-- Financeiro devolve, por revisão aprovada para envio, a Bid preenchida e a equipe orçada.
-- Nenhum custo, salário ou lucro é guardado no Core.
-- CreateTable
CREATE TABLE "project_quote_requests" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "sow_document_id" TEXT NOT NULL,
    "notes" TEXT,
    "requested_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_quotes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "satellite_id" TEXT NOT NULL,
    "external_revision_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "sow_document_id" TEXT,
    "work_days" DECIMAL(8,2) NOT NULL,
    "planned_start_date" DATE,
    "planned_end_date" DATE,
    "team" JSONB NOT NULL,
    "field_people" INTEGER NOT NULL,
    "total_hours" DECIMAL(12,2) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "approved_by_email" TEXT,
    "bid_filename" TEXT NOT NULL,
    "bid_mime_type" TEXT NOT NULL,
    "bid_size_bytes" INTEGER NOT NULL,
    "bid_content_hash" TEXT NOT NULL,
    "bid_content" BYTEA NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_quote_requests_project_id_idx" ON "project_quote_requests"("project_id");

-- CreateIndex
CREATE INDEX "project_quotes_project_id_idx" ON "project_quotes"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_quotes_satellite_id_external_revision_id_key" ON "project_quotes"("satellite_id", "external_revision_id");

-- AddForeignKey
ALTER TABLE "project_quote_requests" ADD CONSTRAINT "project_quote_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_quote_requests" ADD CONSTRAINT "project_quote_requests_sow_document_id_fkey" FOREIGN KEY ("sow_document_id") REFERENCES "project_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_quote_requests" ADD CONSTRAINT "project_quote_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_quotes" ADD CONSTRAINT "project_quotes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_quotes" ADD CONSTRAINT "project_quotes_satellite_id_fkey" FOREIGN KEY ("satellite_id") REFERENCES "integration_satellites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_quotes" ADD CONSTRAINT "project_quotes_sow_document_id_fkey" FOREIGN KEY ("sow_document_id") REFERENCES "project_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Valores coerentes mesmo se alguém escrever direto no banco.
ALTER TABLE "project_quotes" ADD CONSTRAINT "project_quotes_values_check"
  CHECK ("revision_number" >= 1 AND "work_days" > 0 AND "field_people" >= 0 AND "total_hours" >= 0 AND "bid_size_bytes" > 0);
ALTER TABLE "project_quotes" ADD CONSTRAINT "project_quotes_dates_check"
  CHECK ("planned_start_date" IS NULL OR "planned_end_date" IS NULL OR "planned_end_date" >= "planned_start_date");

-- Bid Template do RFQ: o cliente (AWS) manda, junto com a SOW, a planilha da proposta já preenchida
-- com os dados do projeto (FBN, SOW, região, preços). Ela fica anexada ao projeto do Core e o
-- Financeiro devolve essa mesma planilha preenchida. O pedido de cotação passa a apontar para ela.
ALTER TYPE "ProjectDocumentKind" ADD VALUE 'bid_template';

ALTER TABLE "project_quote_requests" ADD COLUMN "bid_template_document_id" TEXT;

ALTER TABLE "project_quote_requests" ADD CONSTRAINT "project_quote_requests_bid_template_document_id_fkey" FOREIGN KEY ("bid_template_document_id") REFERENCES "project_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

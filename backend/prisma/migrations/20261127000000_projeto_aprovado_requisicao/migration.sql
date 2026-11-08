-- Aprovação do projeto e requisição automática de envio de material (PT-06 do plano projeto aprovado -> obra).
-- Aditiva: valores novos de enum, colunas nulas/com default e uma tabela nova. Os dados (usuário de sistema e
-- categoria) vêm na migração seguinte, porque um valor de enum recém-criado não pode ser usado na mesma transação.

-- AlterEnum
ALTER TYPE "ProjectDocumentKind" ADD VALUE 'po';

-- AlterEnum
ALTER TYPE "RequestCategoryKind" ADD VALUE 'envio_material';

-- AlterTable
ALTER TABLE "collaborators" ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "origin" TEXT,
ADD COLUMN     "source_ref" TEXT;

-- CreateTable
CREATE TABLE "project_acceptances" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "project_quote_id" TEXT NOT NULL,
    "client_po_number" TEXT,
    "accepted_by_user_id" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_acceptances_project_id_key" ON "project_acceptances"("project_id");

-- CreateIndex
CREATE INDEX "project_acceptances_project_quote_id_idx" ON "project_acceptances"("project_quote_id");

-- CreateIndex: (origin, source_ref) único. No Postgres, NULL não conflita com NULL: as requisições abertas pela tela
-- (origin nulo) não são afetadas; a automática do projeto aprovado não se duplica.
CREATE UNIQUE INDEX "requests_origin_source_ref_key" ON "requests"("origin", "source_ref");

-- AddForeignKey
ALTER TABLE "project_acceptances" ADD CONSTRAINT "project_acceptances_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_acceptances" ADD CONSTRAINT "project_acceptances_project_quote_id_fkey" FOREIGN KEY ("project_quote_id") REFERENCES "project_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_acceptances" ADD CONSTRAINT "project_acceptances_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

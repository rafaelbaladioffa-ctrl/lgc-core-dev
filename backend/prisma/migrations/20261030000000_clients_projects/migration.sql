-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('proposta', 'aprovado', 'em_execucao', 'encerrado');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "legal_name" TEXT NOT NULL,
    "cnpj" TEXT,
    "contacts" JSONB,
    "address" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "cost_center_id" TEXT NOT NULL,
    "responsible_collaborator_id" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'proposta',
    "proposal_sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_code_key" ON "clients"("code");

-- CreateIndex
CREATE UNIQUE INDEX "clients_cnpj_key" ON "clients"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE INDEX "projects_client_id_idx" ON "projects"("client_id");

-- CreateIndex
CREATE INDEX "projects_cost_center_id_idx" ON "projects"("cost_center_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_responsible_collaborator_id_fkey" FOREIGN KEY ("responsible_collaborator_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Native atomic sequences for sequential codes (see PLANNING.md 5.7/5.8/5.9).
-- Preferred over a counter table: NEXTVAL is atomic and race-free under concurrent inserts.
CREATE SEQUENCE IF NOT EXISTS "client_code_seq" START WITH 100 INCREMENT BY 100;

CREATE SEQUENCE IF NOT EXISTS "project_proposal_seq" START WITH 1 INCREMENT BY 1;

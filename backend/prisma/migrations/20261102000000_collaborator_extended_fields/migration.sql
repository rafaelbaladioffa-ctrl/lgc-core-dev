-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('CLT', 'PJ', 'estagio', 'terceirizado');

-- AlterEnum: collaborators.status becomes more granular (active/offboarded -> ativo/afastado/ferias/desligado).
-- Existing rows map 1:1 (active -> ativo, offboarded -> desligado) so no data is lost.
BEGIN;
CREATE TYPE "CollaboratorStatus_new" AS ENUM ('ativo', 'afastado', 'ferias', 'desligado');
ALTER TABLE "collaborators" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "collaborators" ALTER COLUMN "status" TYPE "CollaboratorStatus_new" USING (
  CASE "status"::text
    WHEN 'active' THEN 'ativo'
    WHEN 'offboarded' THEN 'desligado'
    ELSE "status"::text
  END::"CollaboratorStatus_new"
);
ALTER TYPE "CollaboratorStatus" RENAME TO "CollaboratorStatus_old";
ALTER TYPE "CollaboratorStatus_new" RENAME TO "CollaboratorStatus";
DROP TYPE "CollaboratorStatus_old";
ALTER TABLE "collaborators" ALTER COLUMN "status" SET DEFAULT 'ativo';
COMMIT;

-- AlterTable: new collaborator fields (personal/contact, address, employment, documents).
-- `matricula` is added nullable first, backfilled below, then constrained NOT NULL + UNIQUE —
-- adding it NOT NULL directly would fail on any already-seeded collaborator row.
ALTER TABLE "collaborators" ADD COLUMN     "address_city" TEXT,
ADD COLUMN     "address_complement" TEXT,
ADD COLUMN     "address_district" TEXT,
ADD COLUMN     "address_number" TEXT,
ADD COLUMN     "address_state" TEXT,
ADD COLUMN     "address_street" TEXT,
ADD COLUMN     "admission_date" TIMESTAMP(3),
ADD COLUMN     "birth_date" TIMESTAMP(3),
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cnh_category" TEXT,
ADD COLUMN     "cnh_expires_at" TIMESTAMP(3),
ADD COLUMN     "contract_type" "ContractType",
ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_phone" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "marital_status" "MaritalStatus",
ADD COLUMN     "matricula" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "photo_filename" TEXT,
ADD COLUMN     "photo_storage_path" TEXT,
ADD COLUMN     "uniform_size" TEXT,
ADD COLUMN     "work_schedule" TEXT;

-- Native atomic sequence for the employee code ("matrícula"): 0000, 0001, 0002, ... — same
-- rationale as client_code_seq/project_proposal_seq (see PLANNING.md 5.9): NEXTVAL is atomic and
-- race-free under concurrent collaborator creation.
CREATE SEQUENCE IF NOT EXISTS "collaborator_matricula_seq" START WITH 0 MINVALUE 0 INCREMENT BY 1;

-- Backfill matricula for any collaborator rows that already existed (e.g. the seeded admin).
-- nextval() is called once per row by the UPDATE, so every row gets a distinct value; row order
-- isn't guaranteed, but uniqueness is all that matters here.
UPDATE "collaborators"
SET "matricula" = lpad(nextval('collaborator_matricula_seq')::text, 4, '0')
WHERE "matricula" IS NULL;

ALTER TABLE "collaborators" ALTER COLUMN "matricula" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "collaborators_matricula_key" ON "collaborators"("matricula");

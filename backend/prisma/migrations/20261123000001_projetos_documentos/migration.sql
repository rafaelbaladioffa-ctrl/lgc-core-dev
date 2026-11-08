-- Documentos do projeto (SOW do cliente), consumidos pelo módulo Projetos do Financeiro.
-- Versionados: cada envio cria a versão seguinte; nenhuma versão é sobrescrita.
CREATE TYPE "ProjectDocumentKind" AS ENUM ('sow');

CREATE TABLE "project_documents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "ProjectDocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_documents_project_id_kind_version_key" ON "project_documents"("project_id", "kind", "version");

ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A SOW é documento do cliente: ver e baixar exige permissão própria (enviar exige project:update).
INSERT INTO "permissions" ("id", "resource", "action", "description") VALUES
  (gen_random_uuid()::text, 'project', 'read_documents', 'Ver e baixar documentos do projeto (SOW)')
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" IN ('admin', 'gestor') AND p."resource" = 'project' AND p."action" = 'read_documents'
ON CONFLICT DO NOTHING;

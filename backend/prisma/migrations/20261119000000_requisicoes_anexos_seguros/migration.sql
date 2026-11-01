-- Anexos seguros versionados (REQUISICOES_SPEC.md §16) — hash SHA-256, MIME por conteúdo, nome
-- seguro e versionamento são reais; armazenamento é BYTEA no Postgres como solução temporária
-- (decisão da sessão de planejamento) até a infraestrutura definitiva ser escolhida. Último item
-- da Fase 2. `request_attachments` era só metadado (nome + path) até aqui, sem dado real
-- armazenado em lugar nenhum — recriar a tabela do zero é seguro.

DROP TABLE IF EXISTS "request_attachments" CASCADE;

CREATE TABLE "request_attachments" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "safe_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previous_version_id" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "request_attachments_request_id_idx" ON "request_attachments"("request_id");

ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "request_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

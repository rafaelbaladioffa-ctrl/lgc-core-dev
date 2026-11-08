-- Sites do Core (PA-05 do plano projeto aprovado -> obra): local de obra/entrega de um cliente, usado por
-- Logística, Financeiro e Field. Projeto ganha site_id opcional (obrigatório só para aprovar, no PT-06).
-- Aditiva: nenhuma tabela existente perde dado.

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cep" TEXT,
    "address_street" TEXT,
    "address_number" TEXT,
    "address_complement" TEXT,
    "address_district" TEXT,
    "address_city" TEXT,
    "address_state" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sites_client_id_idx" ON "sites"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_client_id_code_key" ON "sites"("client_id", "code");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "site_id" TEXT;

-- CreateIndex
CREATE INDEX "projects_site_id_idx" ON "projects"("site_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissões novas (o seed.ts também as cria a cada partida; aqui já chegam com a migração).
-- Vão para os papéis que já têm a permissão equivalente de clientes: site:read ← client:read,
-- site:create ← client:create, site:update ← client:update. Não há site:delete: site sai de uso
-- inativado (PUT /sites/:id com active=false).
INSERT INTO "permissions" ("id", "resource", "action", "description") VALUES
  (gen_random_uuid()::text, 'site', 'read', 'Visualizar sites dos clientes'),
  (gen_random_uuid()::text, 'site', 'create', 'Cadastrar sites dos clientes'),
  (gen_random_uuid()::text, 'site', 'update', 'Editar e inativar sites dos clientes')
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", sp."id"
FROM "role_permissions" rp
JOIN "permissions" cp ON cp."id" = rp."permission_id" AND cp."resource" = 'client' AND cp."action" IN ('read', 'create', 'update')
JOIN "permissions" sp ON sp."resource" = 'site' AND sp."action" = cp."action"
ON CONFLICT DO NOTHING;

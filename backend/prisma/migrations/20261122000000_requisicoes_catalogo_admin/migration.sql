-- Administração do catálogo de requisições: tipo da categoria, ciclo rascunho -> publicada das
-- versões e fim das subcategorias (parent_category_id nunca foi usado por tela nem fluxo).
-- A permissão request_category:publish chega aos bancos existentes pelo seed.ts, que roda a cada
-- partida do container e dá ao papel admin todas as permissões da lista.

-- CreateEnum
CREATE TYPE "RequestCategoryKind" AS ENUM ('padrao', 'compra_material', 'denuncia');

-- CreateEnum
CREATE TYPE "CategoryVersionStatus" AS ENUM ('rascunho', 'publicada');

-- Remove subcategorias
ALTER TABLE "request_categories" DROP CONSTRAINT "request_categories_parent_category_id_fkey";
DROP INDEX "request_categories_parent_category_id_idx";
ALTER TABLE "request_categories" DROP COLUMN "parent_category_id";

-- Tipo da categoria (substitui o teste por código/nome no código)
ALTER TABLE "request_categories" ADD COLUMN "kind" "RequestCategoryKind" NOT NULL DEFAULT 'padrao';

UPDATE "request_categories" SET "kind" = 'compra_material'
WHERE "code" = 'SUP-COMPRA' OR lower("name") = 'compra de material';

UPDATE "request_categories" SET "kind" = 'denuncia'
WHERE "code" = 'CMP-DENUNCIA';

-- Versões: status, autor do rascunho e publicação explícita
ALTER TABLE "category_versions" ADD COLUMN "created_by" TEXT;
-- Linhas existentes já estavam em uso: viram `publicada`. O default de linhas novas é `rascunho`.
ALTER TABLE "category_versions" ADD COLUMN "status" "CategoryVersionStatus" NOT NULL DEFAULT 'publicada';
ALTER TABLE "category_versions" ALTER COLUMN "status" SET DEFAULT 'rascunho';

ALTER TABLE "category_versions" ALTER COLUMN "published_at" DROP DEFAULT;
UPDATE "category_versions" SET "published_at" = "created_at" WHERE "published_at" IS NULL;

-- No máximo um rascunho por categoria (o Prisma não modela índice parcial).
CREATE UNIQUE INDEX "category_versions_one_draft_idx" ON "category_versions" ("category_id") WHERE "status" = 'rascunho';

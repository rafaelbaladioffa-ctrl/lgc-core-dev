-- Bid opcional na cotação recebida do Financeiro: o modelo `generico` não tem Bid Template do cliente e
-- devolve só equipe, dias e materiais. Ou a cotação tem a Bid inteira (arquivo, tipo, tamanho e hash) ou não
-- tem nenhuma dessas colunas.

ALTER TABLE "project_quotes" ALTER COLUMN "bid_filename" DROP NOT NULL;
ALTER TABLE "project_quotes" ALTER COLUMN "bid_mime_type" DROP NOT NULL;
ALTER TABLE "project_quotes" ALTER COLUMN "bid_size_bytes" DROP NOT NULL;
ALTER TABLE "project_quotes" ALTER COLUMN "bid_content_hash" DROP NOT NULL;
ALTER TABLE "project_quotes" ALTER COLUMN "bid_content" DROP NOT NULL;

ALTER TABLE "project_quotes" ADD CONSTRAINT "project_quotes_bid_all_or_none" CHECK (
    ("bid_filename" IS NOT NULL AND "bid_mime_type" IS NOT NULL AND "bid_size_bytes" IS NOT NULL AND "bid_content_hash" IS NOT NULL AND "bid_content" IS NOT NULL)
    OR
    ("bid_filename" IS NULL AND "bid_mime_type" IS NULL AND "bid_size_bytes" IS NULL AND "bid_content_hash" IS NULL AND "bid_content" IS NULL)
);

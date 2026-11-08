-- PJ7: perfil da Bid (fornecedor e mapeamento para as linhas do Bid Template) e Bid preenchida ao aprovar o envio.

-- CreateTable
CREATE TABLE "bid_profile_entries" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_profile_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_bid_output" (
    "revision_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "writes" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" TEXT NOT NULL,

    CONSTRAINT "revision_bid_output_pkey" PRIMARY KEY ("revision_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bid_profile_entries_kind_key_key" ON "bid_profile_entries"("kind", "key");

-- AddForeignKey
ALTER TABLE "revision_bid_output" ADD CONSTRAINT "revision_bid_output_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "budget_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A Bid gerada é o que foi enviado ao cliente e ao Core: não muda nem é apagada.
CREATE FUNCTION revision_bid_output_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Bid gerada não pode ser alterada nem apagada';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revision_bid_output_append_only
  BEFORE UPDATE OR DELETE ON "revision_bid_output"
  FOR EACH ROW EXECUTE FUNCTION revision_bid_output_append_only();

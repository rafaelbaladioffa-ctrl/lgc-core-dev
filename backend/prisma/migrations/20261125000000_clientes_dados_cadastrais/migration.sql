-- Clientes: nome fantasia, contato e endereço estruturado (CEP preenchido pela tela via ViaCEP).
-- Colunas opcionais para não exigir backfill; os JSON legados `contacts` e `address` ficam como estão.
ALTER TABLE "clients" ADD COLUMN "trade_name" TEXT;
ALTER TABLE "clients" ADD COLUMN "phone" TEXT;
ALTER TABLE "clients" ADD COLUMN "email" TEXT;
ALTER TABLE "clients" ADD COLUMN "cep" TEXT;
ALTER TABLE "clients" ADD COLUMN "address_street" TEXT;
ALTER TABLE "clients" ADD COLUMN "address_number" TEXT;
ALTER TABLE "clients" ADD COLUMN "address_complement" TEXT;
ALTER TABLE "clients" ADD COLUMN "address_district" TEXT;
ALTER TABLE "clients" ADD COLUMN "address_city" TEXT;
ALTER TABLE "clients" ADD COLUMN "address_state" TEXT;

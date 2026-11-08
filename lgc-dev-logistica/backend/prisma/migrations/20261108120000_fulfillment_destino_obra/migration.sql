-- Destino da ordem de atendimento (envio de material para obra): site do Axis, texto legível e coordenadas.
-- Colunas novas e opcionais: ordens existentes continuam válidas (sem destino).
ALTER TABLE "fulfillment_orders"
  ADD COLUMN "destination_site_axis_id" TEXT,
  ADD COLUMN "destination_text" TEXT,
  ADD COLUMN "destination_lat" DECIMAL(9,6),
  ADD COLUMN "destination_lng" DECIMAL(9,6);

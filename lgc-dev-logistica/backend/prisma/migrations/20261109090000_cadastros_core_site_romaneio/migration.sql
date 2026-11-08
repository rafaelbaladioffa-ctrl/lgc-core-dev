-- Vínculo com cadastros do Core (mapa de interoperabilidade, onda V4: L6 e L7). Colunas novas e opcionais, sem apagar dado.
-- Romaneio: site do Axis de destino, copiado da ordem; o texto `destination` continua como ajuste manual.
ALTER TABLE "shipments" ADD COLUMN "destination_site_axis_id" TEXT;

-- Romaneios já criados herdam o site da ordem de atendimento.
UPDATE "shipments" s
   SET "destination_site_axis_id" = o."destination_site_axis_id"
  FROM "fulfillment_orders" o
 WHERE s."order_id" = o."id" AND s."destination_site_axis_id" IS NULL AND o."destination_site_axis_id" IS NOT NULL;

-- Almoxarifado: site do Axis onde fica (opcional); o endereço em texto continua.
ALTER TABLE "warehouses" ADD COLUMN "site_axis_id" TEXT;

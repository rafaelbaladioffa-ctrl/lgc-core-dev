-- Satellite launcher: URL do frontend humano do satélite, distinta do webhookUrl
-- (backend-a-backend). Usada por POST /integration/satellites/:id/launch.

ALTER TABLE "integration_satellites" ADD COLUMN "frontend_url" TEXT;

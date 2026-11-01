-- Denúncia/relato ético (REQUISICOES_SPEC.md §7.3): identidade do solicitante nunca é apagada,
-- só ocultada de quem não tem a permissão nova request:view_whistleblower_identity.

ALTER TABLE "requests" ADD COLUMN "anonymous" BOOLEAN NOT NULL DEFAULT false;

-- Subtarefas (REQUISICOES_SPEC.md §11.4) e aceite obrigatório do solicitante (§15.2) — terceiro
-- incremento da Fase 2.

ALTER TABLE "request_categories" ADD COLUMN "requires_acceptance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "requests" ADD COLUMN "requester_accepted_at" TIMESTAMP(3);

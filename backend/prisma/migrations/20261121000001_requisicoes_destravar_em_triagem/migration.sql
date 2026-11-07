-- Destrava requisições reabertas antes de 2026-11-07, que ficaram presas em `em_triagem`.
--
-- Até essa data, `reopen` gravava `em_triagem`, um status do qual nenhum comando sai (a triagem
-- só parte de `enviada`). Agora a reabertura vai para `enviada`, e `em_triagem` só existe dentro
-- da transação do aceite da triagem — nunca fica gravado. Então toda linha nesse status é uma
-- requisição reaberta e parada: volta para a fila de triagem do setor.
--
-- O registro em audit_events fica no mesmo passo, para a trilha da requisição explicar a mudança.
-- Idempotente: numa segunda execução não há mais linhas em `em_triagem`.
INSERT INTO "audit_events" ("id", "aggregate_type", "aggregate_id", "event", "actor_id", "before_json", "after_json", "source")
SELECT gen_random_uuid()::text, 'request', "id", 'request.unstuck_from_triage', NULL,
       '{"status": "em_triagem"}'::jsonb, '{"status": "enviada"}'::jsonb, 'migration'
FROM "requests"
WHERE "status" = 'em_triagem';

UPDATE "requests" SET "status" = 'enviada' WHERE "status" = 'em_triagem';

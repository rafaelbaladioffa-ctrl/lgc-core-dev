-- Ajuste único do histórico de migrações (2026-11-07). Roda antes de `prisma migrate deploy`.
--
-- Quatro migrações tinham data anterior às tabelas que alteram e quebravam `migrate deploy` em banco
-- vazio. As pastas foram renomeadas para logo depois de 20261111000000_requisicoes_fase1, sem mudar o
-- conteúdo (o checksum continua o mesmo). Num banco que já as aplicou com o nome antigo, renomeia a
-- linha em _prisma_migrations para o Prisma não tentar aplicá-las de novo.
--
-- Idempotente: banco novo (sem _prisma_migrations) ou já ajustado não sofre alteração.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RETURN;
  END IF;
  UPDATE "_prisma_migrations" SET "migration_name" = '20261111000001_request_bpm_p01'
    WHERE "migration_name" = '20261101000000_request_bpm_p01';
  UPDATE "_prisma_migrations" SET "migration_name" = '20261111000002_bpm_p04_materials'
    WHERE "migration_name" = '20261102000000_bpm_p04_materials';
  UPDATE "_prisma_migrations" SET "migration_name" = '20261111000003_request_approval_source'
    WHERE "migration_name" = '20261103000001_request_approval_source';
  UPDATE "_prisma_migrations" SET "migration_name" = '20261111000004_request_bpm_p02'
    WHERE "migration_name" = '20261103000002_request_bpm_p02';
END $$;

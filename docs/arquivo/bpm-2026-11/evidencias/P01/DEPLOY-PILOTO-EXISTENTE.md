# Deploy do piloto P01 — 2026-11-02

- URL: `http://localhost:5173/requests/bpm`
- Migration: `20261101000000_request_bpm_p01` aplicada após ensaio em cópia descartável.
- Backup privado anterior ao deploy: `/backups/axis_20261102T090703Z.sql.gz`.
- Rollback de imagens: `lgc-dev-core-backend:rollback-p01-20261102` e `lgc-dev-core-frontend:rollback-p01-20261102`.
- Subida sem seed operacional:

```sh
docker compose -f docker-compose.yml -f docker-compose.p01.override.yml up -d --no-deps --force-recreate backend frontend
```

- Processo publicado: `P01-PILOTO`, versão 2; versão 1 preservada.
- Campos de demonstração: observação adicional, quantidade, urgência e anexos.
- Operador adicional da fila: Supervisor Oprações Teste.
- Verificações: 48 testes backend, 20 frontend/DOM e 4 PostgreSQL; smoke HTTP de login, capabilities, catálogo, rota antiga e frontend.

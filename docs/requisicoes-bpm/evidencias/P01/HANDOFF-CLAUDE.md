# Handoff para Claude — Requisições BPM

Data: 02/11/2026 (America/Sao_Paulo)

## Estado entregue

P01 está tecnicamente fechado: A01–A24 passaram nas verificações automatizadas. O piloto existente
continua preservado; não houve seed, reset, migração destrutiva, troca de volume, alteração no satélite
ou deploy durante esta consolidação.

Validações principais:

- frontend build: passou;
- frontend Vitest: 4 arquivos, 26 testes;
- Playwright A23: 1 teste passou em 390×844, gerando `a23-390-offline.png`,
  `a23-390-menu.png`, `a23-390-empty-after-retry.png` e `a23-390-conflict-preserved.png`;
- backend build: passou;
- backend unitários focados: 36 testes passaram, incluindo HTTP A02;
- PostgreSQL `_bpm_test`: jornada/anexos/autenticação 20 testes passaram;
- A01 HTTP/PostgreSQL: 1 teste passou;
- A22 PostgreSQL: 3 testes passaram;
- restart em dois processos Node: 1 teste passou.

O teste visual também encontrou e corrigiu um defeito real: autosave que recebia 409 não ativava a
mensagem de conflito; `BpmDraftEditorPage.tsx` agora sinaliza o conflito e preserva a edição.

## Arquivos importantes

- `backend/src/request-processes/` — administração, validação, publicação, filas e grants;
- `backend/src/request-runtime/` — runtime BPM, locks, SLA, anexos, comentários e autorização;
- `backend/test/bpm-a01-http.e2e-spec.ts` — administração por HTTP/PostgreSQL;
- `backend/test/bpm-a22-executor-separation.e2e-spec.ts` — separação legacy/BPM;
- `backend/test/bpm-journey.e2e-spec.ts` — jornada integrada e critérios A03–A21;
- `frontend/src/features/requisicoes-bpm/` — telas e autosave;
- `frontend/e2e/a23-mobile.spec.ts` e `frontend/playwright.config.ts` — evidência visual A23;
- `docs/requisicoes-bpm/evidencias/P01/A23-A24-20261102.md` — quadro A01–A24;
- `docs/requisicoes-bpm/pacotes/P01-processo-simples.md` — pacote normativo;
- `docs/requisicoes-bpm/evidencias/P01/DEPLOY-PILOTO-EXISTENTE.md` — backup/rollback e piloto.

## Próximo passo: P02

P02 ainda não foi implementado. Antes de começar, Claude deve:

1. ler `docs/requisicoes-bpm/07-backlog-validacao.md`, `01-arquitetura.md`, `02-regras-autorizacao.md`,
   `04-contratos-api.md`, `05-telas-publicacao.md` e `06-sla-logistica.md`;
2. preservar `executionMode=legacy`, o piloto P01 e as contas/cadastros existentes;
3. criar banco/fixtures dedicados terminados em `_bpm_test`; nunca usar `DATABASE_URL` operacional;
4. executar o baseline P01 antes de qualquer mudança de P02;
5. implementar somente o recorte P02: seções/reordenação, tabela repetível, dinheiro/referências,
   bindings de dados, condições tipadas e regras de campo por etapa;
6. manter P01 verde e registrar evidência nova sem editar evidência histórica.

## Pendências não bloqueantes

- Aceite humano visual no navegador real continua opcional; a evidência automatizada Chromium 390×844
  já passou.
- O bundle frontend ainda emite aviso de chunk acima de 500 kB; não bloqueia P01.
- Não fazer push adicional sem revisar o diff acumulado; este commit contém o estado completo para
  continuidade local.

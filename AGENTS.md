# Instruções para agentes (e desenvolvedores)

Leia antes de alterar este repositório. Vale para Claude, Codex e qualquer outro agente.

## Contexto

- Axis = ERP interno da LGC Instalações e Projetos. Usuários finais falam português; **toda UI, mensagem de erro e documentação em pt-BR**.
- Este repo tem o Core (`backend/`, `frontend/`) e os satélites Logística (`lgc-dev-logistica/`) e Financeiro (`lgc-dev-financeiro/`). Cada um tem `package.json` e banco separados.
- Visão e estado atual: [docs/README.md](docs/README.md). Diagnóstico e riscos: [docs/avaliacao-2026-11-07.md](docs/avaliacao-2026-11-07.md).
- Padrões obrigatórios e Definition of Done: [docs/diretrizes-desenvolvimento.md](docs/diretrizes-desenvolvimento.md).

## Regras que não podem ser quebradas

1. **Banco de dados**
   - Nunca rode `prisma migrate dev`, `migrate reset`, seeds ou testes e2e contra o banco de desenvolvimento ou de produção. Testes usam um banco separado com sufixo `_test`.
   - Migrações são aplicadas com `npm run db:migrate` (ajuste de histórico + `migrate deploy`), nunca só com `migrate deploy` num banco antigo.
2. **Migrações:** nunca edite uma migração já aplicada; crie uma nova. Mudanças destrutivas exigem backup e ensaio numa cópia.
3. **Segredos:** não versione `.env`, chaves ou senhas. O repositório no GitHub é público.
4. **Escopo:** um commit e um PR por escopo. Não misture mudanças do Core e da Logística no mesmo commit, salvo quando for mudança de contrato entre os dois, e diga isso na mensagem.
5. **Autorização no servidor:** toda rota nova usa `@RequirePermissions` e, se altera dados, `@AuditAction`. Visibilidade (confidencialidade, anonimato) é filtrada no servidor, antes de paginar.
6. **Outbox na mesma transação:** eventos de integração vão para `integration_outbox` dentro da transação da escrita de negócio.
7. **Documentação junto com o código:** se mudar comportamento descrito em `docs/dominio/*-estado-atual.md`, `docs/dominio/cadastros.md` ou `docs/integracao-core-logistica.md`, atualize o documento no mesmo PR.

## Convenções de código

- **Backend:**
  - NestJS em ESM: imports relativos com sufixo `.js`.
  - DTOs com class-validator; o `ValidationPipe` rejeita campos extras.
  - Use `this.prisma.$transaction` para escritas compostas.
- **Frontend:**
  - Componentes e tokens:
    - Estrutura e componentes: `FormPage`, `DataTable`, `Button`, `KpiCard`.
    - Cores e tokens: `src/styles/axis-tokens.css`.
    - Formatação: `formatBRL`, `formatDate` e `formatDateTime` (`America/Sao_Paulo`).
  - Toda chamada de API trata erro na tela.
  - Nada de estilo inline novo quando existir token ou componente.
- **Não reintroduza** `executionMode`/`bpm_v1` nem rotas `/bpm`. A reescrita do motor segue [docs/dominio/requisicoes-roadmap.md](docs/dominio/requisicoes-roadmap.md) e [docs/dominio/requisicoes-regras-motor.md](docs/dominio/requisicoes-regras-motor.md).

## Verificação antes de entregar

```bash
cd backend && npx tsc -p tsconfig.build.json --noEmit && npm run lint
```

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && npx oxlint src
```

```bash
cd lgc-dev-logistica/backend && npx tsc --noEmit -p tsconfig.build.json && npm test
```

```bash
cd lgc-dev-financeiro/backend && npx tsc -p tsconfig.build.json --noEmit && npm run lint && npm test
```

```bash
cd lgc-dev-financeiro/frontend && npx tsc -p tsconfig.json --noEmit && npx oxlint src && npm test
```

```bash
node scripts/sync-design.mjs --check
```

Se mudar `axis-tokens.css`, `axis-shell.css` ou a marca em `frontend/public/brand-industrial/`, rode `node scripts/sync-design.mjs` para atualizar as cópias dos satélites (não edite as cópias).

Rode também `cd backend && npm test` e `cd frontend && npm test`. A cobertura do Core ainda é pequena: escreva testes para o que mudar (exemplo de serviço com Prisma simulado: `backend/src/requests/requests-fluxo.spec.ts`).

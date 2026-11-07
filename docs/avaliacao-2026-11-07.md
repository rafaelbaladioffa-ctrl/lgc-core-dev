# Avaliação do código — 2026-11-07

> **Atualização de 2026-11-07 (tarde):** corrigidos na branch `rafaelbaladioffa-ctrl/correcoes-bloqueantes` o vazamento da fila, os três defeitos de fluxo (devolução, reabertura, resposta do solicitante), o tratamento de erro da tela de detalhe e da fila, os testes BPM quebrados (B4) e o tsbuildinfo/cache versionados (B3). Itens corrigidos estão marcados com ✅. B1/B2 (migrações) aguardam decisão.

Diagnóstico do Axis Core (`backend/`, `frontend/`) e do satélite Logística (`lgc-dev-logistica/`)
na branch `rafaelbaladioffa-ctrl/minhas-atividades` (HEAD `115d5b9`). Foi feito por leitura do
código e pela execução de typecheck, lint e testes unitários. Não foi usado banco de dados, então
os itens que dependem do estado do banco foram inferidos das migrações.

## 1. Resumo

| Área | Situação | Nota |
|---|---|---|
| Logística | Código sólido e consistente: transações, DTOs validados, ledger imutável. 417 testes unitários no backend e 98 no frontend passando. | Boa |
| Core — cadastros e acesso | Funcional, com criptografia LGPD e outbox bem desenhados. Faltam rate limit no login, auditoria completa e filtro global de erros. | Razoável |
| Core — Requisições | Rico em funcionalidade, mas com vazamento de dados na fila, transições sem controle de concorrência e telas sem tratamento de erro. | Atenção |
| Banco e migrações | Ordem das migrações quebrada (banco vazio não sobe) e drift das tabelas BPM. | **Bloqueante** |
| Testes do Core | Praticamente inexistentes; os que existem quebraram com a remoção do BPM. | **Bloqueante** |
| Integração Core ↔ Logística | O SSO e o catálogo funcionam. Os eventos não fecham, e o SSO tem falha de segurança. | Atenção |
| Documentação | Estava desatualizada. Foi reorganizada nesta data (ver §7). | Corrigida |

O repositório no GitHub (`rafaelbaladioffa-ctrl/lgc-core-dev`) é **público**. Não foram encontrados
segredos versionados, mas o código revela o desenho de segurança. Avalie torná-lo privado.

## 2. Bloqueantes

| # | Problema | Evidência | Correção |
|---|---|---|---|
| B1 | `prisma migrate deploy` falha em banco vazio. Três migrações BPM alteram tabelas criadas depois na ordem alfabética. | `backend/prisma/migrations/20261101000000_request_bpm_p01/migration.sql:22-40` × `20261111000000_requisicoes_fase1` | Gerar um baseline (`migrate diff` do schema atual) para ambientes novos e marcar como aplicado no banco existente, ou renomear com cuidado as pastas e o `_prisma_migrations`. |
| B2 | Drift: 15 tabelas `bpm_*`/`request_queue_members`/`process_config_grants`, colunas BPM em `request_categories`/`category_versions` e permissões `request_process:*` existem no banco sem model. | Commit `98dfce5` sem migração de DROP | Migração explícita de limpeza, depois de backup, e remoção dos resquícios no schema (`bpm_v1`, estados não usados). |
| B3 ✅ | `dist/` pode sair sem `main.js`: `tsconfig.build.tsbuildinfo` versionado e fora de `outDir`, com `incremental` + `deleteOutDir`. | `backend/tsconfig.build.tsbuildinfo` (aparece modificado no git status), `nest-cli.json` | Remover do git, adicionar ao `.gitignore` e ao `.dockerignore`, ou apontar `tsBuildInfoFile` para dentro de `dist`. |
| B4 ✅ | Testes quebrados. Backend: 6 de 9 e2e importam módulos removidos, e `tsc -p tsconfig.json` dá 169 erros. Frontend: 3 de 4 arquivos do Vitest falham, e o Playwright mira `/requests/bpm`. | `backend/test/bpm-*`, `frontend/tests/*`, `frontend/e2e/a23-mobile.spec.ts` | Apagar os testes BPM (o código está no checkpoint `629044d`). Recriar uma base mínima: auth, RBAC, requisições. |

### Defeitos funcionais em Requisições

| Sev. | Problema | Evidência |
|---|---|---|
| Alta ✅ | Requisição **devolvida para ajuste** fica sem saída: `update` e `submit` só aceitam `rascunho`, então o solicitante só consegue cancelar. | `backend/src/requests/requests.service.ts:186, 208` × `:245` |
| Alta ✅ | Requisição **reaberta** vai para `em_triagem`, mas a triagem exige o status `enviada`. Nenhum comando parte de `em_triagem`, então a requisição fica parada. | `requests.service.ts:623` × `:231` |
| Média ✅ | Solicitante com papel `colaborador` não conseguia responder um pedido de informação: `resume` exige `request:update`. | `backend/src/requests/requests.controller.ts:160` |
| Média | O próprio solicitante escolhe a confidencialidade (`dto.confidentiality ?? category.confidentiality`), podendo rebaixar uma categoria `restrita`. | `requests.service.ts:144` |
| Média | O SLA só começa depois da aprovação, não no envio. Compras ficam sem relógio até o responsável do centro de custo aprovar. | `finalizeApproval` em `requests.service.ts` |
| Média | As faixas de alçada usam intervalo fechado `[min, max]`, e o seed deixa um buraco entre 1.000,00 e 1.000,01: um valor nesse buraco aprova sozinho. | `seed-approval-authority-matrix.ts`; regra normativa RM-APR em [dominio/requisicoes-regras-motor.md](dominio/requisicoes-regras-motor.md) |

A lista completa (L01–L23) está em [dominio/requisicoes-estado-atual.md](dominio/requisicoes-estado-atual.md#15-limitações-conhecidas).

## 3. Segurança

| Sev. | Problema | Evidência |
|---|---|---|
| Alta ✅ | `GET /requests/queue` devolvia requisições sem filtro de confidencialidade e sem mascarar o solicitante anônimo. Qualquer usuário com `request:read` vê denúncias e requisições restritas. | `backend/src/requests/requests.service.ts:760-772` |
| Alta | O SSO da Logística troca **qualquer** access token do Core por uma sessão de 8 h. O Core aceita esse token de volta (não verifica `iss` nem fixa o algoritmo). | `lgc-dev-logistica/backend/src/auth/auth.controller.ts:30-50`, `backend/src/auth/strategies/jwt.strategy.ts` |
| Alta | Desativar um usuário no Core não chega à Logística (`user.disabled` não é emitido) e não revoga os refresh tokens no próprio Core. | `backend/src/users/users.service.ts:274-278` |
| Média | Quem tem `user:update` pode criar um papel com qualquer permissão e atribuí-lo a si mesmo. As rotas de papéis não são auditadas. | `backend/src/users/roles.controller.ts:29-38` |
| Média | `POST /auth/login` não tem rate limit. Na API de satélites, a checagem da chave roda antes do throttle e faz `bcrypt.compare` contra todos os satélites. | `auth.controller.ts`, `integration/guards/satellite-api-key.guard.ts:27-34` |
| Média | O solicitante consegue forjar a análise e as cotações de Suprimentos pelo `formData` livre. A edição de rascunho não recalcula o valor usado na alçada. | `create-request.dto.ts:52-53`, `requests.service.ts:184-204, 361, 421` |
| Média | A confidencialidade `confidencial` não é aplicada. Comentários e anexos não verificam se o autor pode ver a requisição. | `requests.service.ts:650-691, 729` |
| Média | O catálogo de compra da Logística expõe custo a quem tem só `material:read`. O Core aceita preço e material vindos do navegador. | `lgc-dev-logistica/backend/src/materials/materials.service.ts:60-87`, `requests.service.ts:165-174` |
| Média | CORS aberto na Logística (sem allow-list). O PWA aceita `#token=` na URL. | `lgc-dev-logistica/backend/src/main.ts:12`, `frontend/src/lib/api.ts:18-23` |
| Baixa | Tokens em `localStorage`, o JWT é aceito no cliente sem checar `exp`, o seed imprime a senha do admin e CNH, telefone e endereço ficam em texto puro. | `frontend/src/context/AuthContext.tsx`, `backend/prisma/seed.ts:316` |

## 4. Qualidade e confiabilidade

### Backend do Core

- **Concorrência:** as transições leem o estado fora da transação e fazem o update sem condicionar
  ao status. `lockVersion` é incrementado mas nunca checado. Aprovações paralelas simultâneas podem
  travar ou finalizar duas vezes (`requests.service.ts:412-451`).
- **Transações:** `assign`, `recordPurchaseAnalysis` e `selectPurchaseQuotation` gravam a
  requisição e o evento de auditoria fora de transação.
- **Crons:** `runAutoClose`, `runSlaAlertsAndEscalation` e o dispatcher do outbox não têm lock
  distribuído (rodariam em dobro com duas instâncias). O dispatcher reenvia para todos os assinantes
  quando só um falha. `completedAt` nunca é preenchido.
- **N+1:** escalonamento de SLA, auto-fechamento, cadeia hierárquica e `statusOverview` de satélites.
- **Regras por string:** `SUP-COMPRA` / "compra de material" aparece repetido 5 vezes, e papéis são
  checados pelo nome `'admin'` / `'analista_suprimentos'`.
- **Erros:** não há filtro global do Prisma, então FK inválida ou registro em uso viram 500.
- **Código morto:** triagem nas linhas 286-293, ramos `bpm_v1`/`WRONG_EXECUTOR`, `REQUEST_BPM_ENABLED`,
  `docker-compose.p01.override.yml`, `scripts/provision-p01-pilot.ts`,
  `scripts/publish-p01-demo-version.mjs`, `seed-requests-suprimentos.ts` (não compila), script `deploy`
  (NestJS Mau).
- **Docker:** o runtime instala devDependencies e o seed roda a cada partida.

### Cadastros (Core)

- **Código hierárquico de setor e centro de custo:** é a contagem de irmãos + 1
  (`sectors.service.ts:77-78`, `cost-centers.service.ts:69-70`). Depois de excluir um irmão, a
  próxima criação repete um código existente e falha com P2002 sem mensagem tratada.
- **Duplicidade de CPF:** o `cpfHash` é calculado sobre o texto como veio, sem normalizar
  (`common/crypto/field-encryption.service.ts:45-46`). O mesmo CPF com e sem máscara gera hashes
  diferentes e escapa da checagem. Também não há validação de dígito verificador.
- **Desligamento pela tela:** grava `status=desligado` via `PUT`, sem passar por `/offboard`. Com
  isso, `offboarded_at` não é preenchido e o evento `collaborator.offboarded` não é emitido.
- **Datas sem hora** (validade de ASO, CNH e certificações): são gravadas à meia-noite UTC e
  aparecem um dia antes em `America/Sao_Paulo`.
- **Mês do código de projeto (`MMAA`):** depende do fuso do processo, e o compose não define `TZ`.
- **Dados sensíveis:** a tela não usa `GET /collaborators/:id/sensitive`. ASO, CNH, telefones,
  endereço e data de nascimento ficam em texto puro.
- Detalhes em [dominio/cadastros.md](dominio/cadastros.md).

### Frontend do Core

- Typecheck limpo, sem `any` em `src/` e sem resquícios de BPM no código. `oxlint src` dá 18 warnings.
- **As telas não tratam erro de API.** As ações do detalhe da requisição (`RequestDetailPage.tsx:132-187`)
  geram rejeições silenciosas. O carregamento fica em "Carregando…" para sempre em caso de 403/404
  (detalhe, Minhas atividades, Aprovações), e a Nova requisição não mostra nada se uma das 8 chamadas
  falhar. Também faltam `catch` em várias listas de cadastro.
- `create` seguido de `submit` sem compensação deixa rascunho órfão se o submit falhar
  (`NewRequestPage.tsx:187-188`).
- **Duplicação:** o mapa `STATUS_LABEL` está copiado em 5 páginas, e alguns status e prioridades
  aparecem crus. As páginas são grandes: `CollaboratorFormPage` (652 linhas), `RequestDetailPage`
  (418) e `NewRequestPage` (379).
- `frontend/.vite-codex-cache/` está versionado (24 arquivos) e faz `npm run lint` falhar. A
  dependência `@xyflow/react` não é usada. Não há `.dockerignore`.
- **Acessibilidade:** nenhum `<label htmlFor>`; motivos são pedidos via `window.prompt`.
- **Navegação:** `/requests/dashboard` não tem link no menu, a busca da topbar não tem lógica e não
  existe `/projects/:id/edit`.

### Logística

- Quatro erros de tipo em mocks de teste (`tsc -p tsconfig.json`). Os testes unitários passam porque
  o Vitest não faz typecheck.
- `SEED_REVISED_CATALOG=true` no compose sobrescreve o catálogo a cada partida e filtra a listagem em
  tempo de execução.
- Alguns controllers acessam o Prisma diretamente. A criação de almoxarifado e endereço fica fora da
  transação da auditoria.

## 5. Estrutura do repositório

- **Logística duplicada.** Ela existe como subpasta deste repositório (`lgc-dev-logistica/`, versão
  mais recente, com as telas web) **e** como repositório irmão em
  `orca-dev/lgc-dev-logistica` (último commit em 01/11). As duas divergem em 54 arquivos de
  `backend/src`. **Recomendação:** tratar a subpasta como oficial e arquivar o repositório irmão.
- **Monorepo informal.** Não há workspaces nem pacote compartilhado, e commits do Core misturam
  mudanças na Logística (ex.: `605d97a`). Recomendação: formalizar como monorepo
  (`apps/core-api`, `apps/core-web`, `apps/logistica-api`, `apps/logistica-web`,
  `packages/contracts`). O pacote de contratos guardaria o envelope e os tipos de evento, os DTOs de
  catálogo e disponibilidade e as claims do JWT. Os bancos devem continuar separados.
- **Acoplamento de deploy.** O compose do Core exige a rede da Logística (`external: true`), e o
  nginx do Core resolve `logistica-backend` na partida.
- **Artefatos gerados no git:** `backend/tsconfig.build.tsbuildinfo` e `frontend/.vite-codex-cache/`.
  Evidências do BPM (logs, `.cjs`, imagens) foram movidas para `docs/arquivo/`.
- **Duas identidades visuais.** O kit `branding/` é o v3 navy, mas o app usa o tema "Industrial Flow
  Graphite". Ver [design/identidade-visual.md](design/identidade-visual.md).
- Há também a pasta `orca-dev/lgc-dev-sys`, fora deste repositório; não foi avaliada.

## 6. Prioridades sugeridas

**Agora (antes de novo deploy ou de seguir com o BPM)**
1. Corrigir o vazamento da fila (`findQueue`) e aplicar confidencialidade em comentários e anexos.
2. Resolver B1–B3: baseline de migrações, limpeza do drift e tsbuildinfo/cache fora do git.
3. Apagar os testes BPM e criar a suíte mínima: auth, RBAC, transições de requisição, fila.
4. Endurecer o SSO com a Logística e revogar refresh tokens ao desativar usuário.
5. Tratamento de erro padrão nas telas de Requisições (toast + estados de erro).

**Depois**
6. Fechar os contratos de evento Core ↔ Logística e criar o receptor de eventos no Core.
7. Controle de concorrência nas transições (update condicional por status/`lockVersion`) e locks nos crons.
8. Rate limit no login, auditoria completa e filtro global de erros do Prisma.
9. Decidir a estrutura do repositório (monorepo formal) e a identidade visual oficial.
10. Retomar a reescrita do motor de processos conforme [dominio/requisicoes-roadmap.md](dominio/requisicoes-roadmap.md).

## 7. O que mudou na documentação

| Antes | Agora |
|---|---|
| `README.md` (desatualizado; setup quebrava) | Reescrito |
| `PLANNING.md` | Conteúdo vigente em `arquitetura.md`, `diretrizes-desenvolvimento.md` e `dominio/cadastros.md`; original em `arquivo/planning-v0.2.md` |
| `REQUISICOES_SPEC.md` | `dominio/requisicoes-spec.md` (especificação alvo) |
| `PLANEJAMENTO_REQUISICOES_BPM.md` e `docs/requisicoes-bpm/**` | Consolidados em `dominio/requisicoes-{estado-atual,regras-motor,roadmap}.md` e `dominio/decisoes-negocio.md`; originais em `arquivo/` |
| `PLANNING_LOGISTICA.md` | `lgc-dev-logistica/docs/especificacao.md` |
| `DESIGN_MIGRATION_CHECKLIST.md`, `GLOBAL_FIELD_STANDARDIZATION_AUDIT.md` | `design/checklist-qa-rotas.md` e a seção de campos de `diretrizes-desenvolvimento.md`; originais em `arquivo/` |
| `branding/*.md` | `design/identidade-visual.md`; originais em `arquivo/branding-v3/` |
| `backend/README.md`, `frontend/README.md` (templates) | Reescritos |
| `backend/AGENTS.md` (template do NestJS Observe) | Substituído por `AGENTS.md` na raiz |
| `lgc-dev-logistica/STATUS_FINAL.md` | `arquivo/logistica-status-final-2026-11-01.md`; README e DEPLOY da Logística corrigidos |

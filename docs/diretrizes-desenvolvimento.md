# Diretrizes de desenvolvimento

Propósito: regras obrigatórias para quem desenvolve no Axis Core — pessoas e agentes de IA. Valem para todo módulo existente e futuro; a especificação de uma feature complementa estas regras, nunca as substitui.
Data: 2026-11-07. Fontes: [planning-v0.2.md §1.1](arquivo/planning-v0.2.md), [global-field-standardization-audit.md](arquivo/global-field-standardization-audit.md) e o código atual (backend NestJS, frontend React/Vite).

## 1. Padrões brasileiros

- Idioma da interface: pt-BR. Mensagens de erro exibidas ao usuário em pt-BR.
- Moeda: BRL, `R$ 1.234,56`. Valor numérico separado da apresentação; no banco e no cálculo usar `Decimal`/`numeric`, nunca float. Formatar só na tela com [`formatBRL`](../frontend/src/utils/format.ts).
- Datas: `DD/MM/AAAA`; data+hora `DD/MM/AAAA HH:mm` (24h); fuso `America/Sao_Paulo`. Usar [`formatDate` / `formatDateTime`](../frontend/src/utils/formatDate.ts).
- Percentual com vírgula (`15,50%`): [`formatPercentBR`](../frontend/src/utils/format.ts). Atenção: ele divide por 100 quando o valor é maior que 1 (heurística); passar sempre a mesma escala.
- Números: [`formatNumberBR`](../frontend/src/utils/format.ts).
- Máscaras de CPF, CNPJ, CEP e telefone: [`MASKS` / `applyMask`](../frontend/src/utils/mask.ts) via [`MaskedInput`](../frontend/src/components/MaskedInput.tsx). Pendências na seção 9.
- Não aceitar valor negativo onde a regra de negócio não autoriza (validar no DTO com `@Min`).

## 2. Todo formulário

Sem precisar ser pedido:

- Página própria em rota dedicada (`/<módulo>/new`, `/<módulo>/:id/edit`), nunca modal. Usar [`FormPage` / `FormSection`](../frontend/src/components/layout/FormPage.tsx), que já dá breadcrumb, botões salvar/cancelar, proteção contra duplo envio e aviso de alterações não salvas.
- Campos obrigatórios identificados; máscaras de entrada; validação de formato com mensagem em pt-BR; indicação do campo inválido.
- Valores iniciais sensatos; busca em selects extensos; calendário para datas; formatação monetária ao digitar.
- Anexo com restrição de tipo e tamanho.
- Feedback de sucesso e de erro — inclusive erro **ao carregar** os dados do formulário (hoje a maioria das telas só trata o erro do submit; ver [checklist de QA](design/checklist-qa-rotas.md)).
- Responsivo e navegável por teclado.

## 3. Toda tabela/listagem

Quando pertinente: busca, filtros, ordenação, paginação, contagem, estado vazio, estado de carregamento, ações por linha, export conforme permissão, formatação correta de valor/data/status.

Usar [`DataTable`](../frontend/src/components/DataTable.tsx) (filtro por coluna, paginação client-side de 20, ações em lote, `toolbar`, `emptyMessage`) e [`StatusBadge`](../frontend/src/components/DataTable.tsx). Lacunas conhecidas do `DataTable`: **não tem ordenação nem estado de carregamento** — quem precisar deve evoluir o componente, não criar outro.

## 4. Todo registro operacional

Identificador único + código amigável, setor/unidade responsável, solicitante, criado em/por, status, última alteração por/em, histórico relevante e permissões de acesso. Reaproveitar cadastros existentes (clientes, setores, colaboradores, projetos, centros de custo — ver [dominio/cadastros.md](dominio/cadastros.md)); nunca duplicar.

## 5. Segurança

- Autenticação e autorização **no backend**; esconder botão ou menu no frontend é cosmético.
- Validar todo dado no servidor.
- Transação quando houver alterações relacionadas.
- Não expor credencial nem dado sensível além do necessário. Dados sensíveis de pessoa (CPF, RG, CTPS, PIS) são criptografados com `FieldEncryptionService`; leitura descriptografada exige permissão própria e grava log de acesso.
- Sem exclusão definitiva de registro operacional sem regra explícita que autorize.
- Respeitar a retenção definida: dados de colaborador desligado são mantidos indefinidamente.

## 6. Convenções do backend

- **NestJS em ESM** (`"type": "module"`): imports relativos terminam em `.js` mesmo no fonte `.ts` (`import { X } from './x.service.js'`).
- Prefixo global `/api/v1`. `ValidationPipe` global com `whitelist: true`, `forbidNonWhitelisted: true` e `transform: true` ([main.ts](../backend/src/main.ts)): todo campo do corpo precisa estar declarado no DTO com decorators do class-validator, senão a requisição é rejeitada com `400`.
- Atenção ao `@IsObject()`: ele rejeita arrays. Para listas use `@IsArray()` + `@ValidateNested({ each: true })`.
- Código gerado (matrícula, código de setor/CC/cliente/projeto) **nunca** vem do cliente: fica fora do DTO e é calculado no serviço com `nextval()` de sequence Postgres, ou com `SELECT ... FOR UPDATE` na linha do pai, dentro da transação.
- **Autorização:** todo controller com `@UseGuards(JwtAuthGuard, PermissionsGuard)` e toda rota com `@RequirePermissions('recurso:ação')` ([rbac/](../backend/src/rbac)). Permissão nova entra em [seed.ts](../backend/prisma/seed.ts) (catálogo e papéis). Não criar permissão no seed sem rota que a use.
- **Auditoria:** ações sensíveis (criar/alterar/desligar pessoa, mexer em login e papéis, decisões de aprovação) recebem `@AuditAction({ action, resourceType, resourceIdParam })` ([audit/](../backend/src/audit)). O interceptor grava depois da resposta, fora da transação.
- **Outbox transacional:** mudança que interessa a satélites grava o evento com `outbox.record(tx, 'entidade.acao', payload)` usando **o mesmo `tx`** da escrita (`prisma.$transaction(async (tx) => ...)`). Nunca gravar o evento depois do commit ou com o cliente Prisma global.
- **Erros:** usar as exceções do Nest (`BadRequestException`, `NotFoundException`, `ConflictException`); converter `P2003` (FK) em `409` com mensagem clara. As mensagens do backend estão em inglês; o frontend traduz as conhecidas em [apiError.ts](../frontend/src/utils/apiError.ts) — ao criar uma mensagem que o usuário verá, adicione a tradução lá com o texto **idêntico**.
- **Fuso:** cálculos de data no backend que dependem do calendário (ex.: mês do código de projeto) devem usar `America/Sao_Paulo` de forma explícita; hoje o processo não define `TZ`.

### 6.1 Prisma e migrações

- Mudança de modelo = nova migration em `backend/prisma/migrations/`. **Nunca editar uma migration já aplicada** em qualquer ambiente.
- **Nunca rodar `prisma migrate dev` contra banco com dados** (o drift das tabelas `bpm_*` foi eliminado em 2026-11-07, mas `migrate dev` continua sendo ferramenta só de banco descartável) (criadas por migrations do BPM removido e ausentes do schema): o comando propõe reset e apaga dados. Detalhes em [arquitetura.md](arquitetura.md) e [operacao.md](operacao.md). Gerar SQL com `prisma migrate diff` e aplicar com `migrate deploy`.
- Sequences e travas (`FOR UPDATE`) são criadas por SQL na migration; documente-as no comentário do serviço que as usa.

## 7. Convenções do frontend

- Telas usam [`AppLayout`](../frontend/src/components/layout/AppLayout.tsx) (listas) ou `FormPage` (formulários). Rotas novas entram em [App.tsx](../frontend/src/App.tsx) dentro de `<PrivateRoute permission="recurso:ação">` e, se forem de primeiro nível, no `NAV_ITEMS` do `AppLayout` com a mesma permissão.
- Componentes compartilhados: [`Button`](../frontend/src/components/Button.tsx) (variantes `primary`, `positive` para criar, `secondary`, `tertiary`, `ghost`, `outline`, `info`, `danger`), [`DataTable`](../frontend/src/components/DataTable.tsx), [`KpiCard` / `KpiRow`](../frontend/src/components/KpiCard.tsx), [`MaskedInput`](../frontend/src/components/MaskedInput.tsx), [`SlideOver`](../frontend/src/components/SlideOver.tsx), [`HierarchyTree`](../frontend/src/components/HierarchyTree.tsx), [`charts.tsx`](../frontend/src/components/charts.tsx). Não criar componente visualmente diferente quando já existe equivalente.
- Cores, fontes, raios, espaçamentos e sombras **só por token** de [axis-tokens.css](../frontend/src/styles/axis-tokens.css) (`var(--primary)`, `var(--danger)`, `var(--radius)`...). Sem hex fixo em página; prefira classes em [index.css](../frontend/src/index.css) a estilo inline. Detalhes em [design/identidade-visual.md](design/identidade-visual.md).
- Chamadas de API pelos módulos em [frontend/src/api](../frontend/src/api) (axios com refresh automático). Toda chamada precisa de tratamento de erro visível (`try/catch` ou `.catch`) usando `translateApiError(err, 'mensagem padrão em pt-BR')`. `void promise.then(...)` sem `.catch` é proibido em código novo.
- Exclusão em lote: [`runBulkDelete`](../frontend/src/utils/bulkDelete.ts).

## 8. Regra de autonomia (humanos e agentes)

- Antecipar estes padrões sem esperar que a spec os repita.
- Melhoria claramente dentro destas diretrizes (não é decisão de negócio nova) pode ser implementada direto.
- Decisão de negócio não coberta (regra crítica indefinida) é levantada como recomendação **antes** de ser presumida.
- Preservar arquitetura, dados e funcionalidades existentes. Sem refatoração extensa nem mudança destrutiva sem aprovação explícita.
- Agentes de IA: não rodar comandos destrutivos de banco (`migrate dev`, `migrate reset`, `db push`) e não fazer commit/push sem pedido explícito; registrar no PR o que foi verificado e o que não foi.

## 9. Definition of Done

Uma entrega só está pronta quando:

1. **Typecheck** sem erros:
   - backend: `cd backend && npx tsc -p tsconfig.build.json --noEmit`
   - frontend: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`
2. **Lint** sem erros novos: `npm run lint` no backend (`oxlint --type-aware src/ test/`) e no frontend (`oxlint`).
3. **Testes do que mudou** escritos ou atualizados e passando (backend: `npm test`, e `npm run test:e2e` com `TEST_DATABASE_URL` local; frontend: `npm test`).
4. **Erro de API tratado na tela**: carregamento e ações mostram mensagem em pt-BR; nada falha em silêncio.
5. **Permissão na rota**: backend com `@RequirePermissions`; frontend com `PrivateRoute permission` e item de menu filtrado pela mesma permissão; permissão nova no seed.
6. **Auditoria**: ação sensível com `@AuditAction`; mudança relevante para satélites com evento no outbox na mesma transação.
7. Padrões BR (moeda, data, fuso, máscaras) aplicados.
8. Documentação de estado atual em `docs/` atualizada no mesmo PR quando o comportamento descrito mudar.

## 10. Backlog de padronização de campos

Pendências abertas, conferidas em [mask.ts](../frontend/src/utils/mask.ts), [format.ts](../frontend/src/utils/format.ts), [formatDate.ts](../frontend/src/utils/formatDate.ts) e nos DTOs em 2026-11-07:

| Campo | Situação atual | Pendência |
|---|---|---|
| CPF | máscara `999.999.999-99`; enviado **com pontuação**; backend só limita a 14 caracteres | validar dígitos verificadores (front e back); normalizar para dígitos antes de criptografar e de calcular `cpf_hash` (hoje o hash depende da formatação) |
| RG | máscara fixa `99.999.999-9`, só dígitos | aceitar formatos por UF e dígito `X`; decidir formato persistido antes de mudar |
| CNPJ | máscara `99.999.999/9999-99`, só dígitos; backend sem validação de formato/DV | suportar CNPJ alfanumérico; validar DV no backend |
| Telefone | máscara única `(99) 99999-9999` (celular nacional) | fixo de 8 dígitos sai com máscara errada; sem formato internacional |
| CTPS / PIS | máscaras fixas `9999999/9999` e `999.99999.99-9` | validar PIS (DV); confirmar formato de CTPS digital |
| CEP | máscara `99999-999` + ViaCEP; backend valida regex | coberto |
| CNH | 11 dígitos, validado no backend | sem DV; em texto puro no banco |
| Datas só-data | `formatDate` converte com `America/Sao_Paulo`; campos `DateTime` à meia-noite UTC (ex.: `aso_validity`, `cnh_expires_at`, `expires_at` de certificação) **aparecem um dia antes** (`2026-11-07T00:00Z` → `06/11/2026`) | tratar data sem hora como data de calendário (formatar a parte `AAAA-MM-DD` sem conversão de fuso, ou `timeZone: 'UTC'`) |
| Moeda | `formatBRL` usado nas telas de requisição | migrar ocorrências restantes; máscara monetária ao digitar não centralizada |
| Percentual | `formatPercentBR` com heurística `> 1 ⇒ /100` | definir escala única (fração ou percentual) |
| Mensagens de erro | `apiError.ts` traduz 4 mensagens; as de setor e centro de custo **não batem** com o texto atual do backend (backend cita `subsectors` e `sub-cost-centers`) e caem no texto genérico | alinhar textos ou trocar por códigos de erro |

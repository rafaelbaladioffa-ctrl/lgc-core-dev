# BPM P02 — Evidências de Implementação

**Data:** 2026-11-02  
**Escopo:** Seções/campos reordenáveis, tipos `money`/`reference`/`repeatable_table`, condições AST, regras de campo por passo, fluxos `returnForCorrection`/`saveCorrection`/`resubmit`/`requestInformation`/`respondInformation`.

---

## Arquivos Criados / Modificados

### Backend — novos

| Arquivo | Descrição |
|---|---|
| `backend/src/request-processes/forms/form-schema.ts` | Tipos TypeScript do esquema axis-bpm/1 P02+: `FieldDef` (união discriminada), `FormShape`, `FormSection`, AST `Condition`, `extractFields`, `toSections` |
| `backend/src/request-processes/forms/condition-evaluator.ts` | Avaliador de condições AST com `MAX_DEPTH=10`, `MAX_OPS=100`; ops: `and, or, not, exists, eq, neq, gt, gte, lt, lte, in` |
| `backend/src/request-processes/forms/form-validator.ts` | `validateFormValues` (runtime), `validateFormSchema` (admin); valida `money` como `{amount, currency}`, `repeatable_table` por coluna |
| `backend/src/request-processes/forms/field-projection.ts` | `projectFields`, `buildAccessMap`, `visibleKeys`; regra mais restritiva vence (hidden > read > write) |
| `backend/prisma/migrations/20261103000002_request_bpm_p02/migration.sql` | Dois novos valores de `RequestStatus`; 4 novas colunas em `bpm_activity_instances` |
| `backend/test/bpm-p02-correction-info.e2e-spec.ts` | 6 testes de integração (B01–B06) para os fluxos de correção e informação |

### Backend — modificados

| Arquivo | Mudança |
|---|---|
| `backend/prisma/schema.prisma` | `aguardando_correcao`, `aguardando_informacao` em `RequestStatus`; `correctionFieldKeys`, `question`, `informationDueAt`, `parentActivityId` em `ActivityInstance` |
| `backend/src/request-runtime/dto.ts` | 5 novos DTOs P02; correção de `@IsUUID` → `@IsString` em `editableFieldKeys` |
| `backend/src/request-runtime/request-runtime.controller.ts` | 5 novos endpoints: `POST /activities/:id/return`, `PATCH /requests/:id/correction`, `POST /requests/:id/resubmit`, `POST /activities/:id/question`, `POST /requests/:id/respond` |
| `backend/src/request-runtime/request-runtime.service.ts` | Métodos `returnForCorrection`, `saveCorrection`, `resubmit`, `requestInformation`, `respondInformation`; `detail` ciente de seções; `allowedActions` atualizado |
| `backend/src/request-processes/request-processes.service.ts` | Delegação de validação para `validateFormSchema`; `capabilities()` expõe `fieldTypes` e `commands` P02 |

### Frontend — novos

| Arquivo | Descrição |
|---|---|
| `frontend/src/features/requisicoes-bpm/forms/MoneyField.tsx` | Campo monetário: `{amount, currency}`; padrão BRL |
| `frontend/src/features/requisicoes-bpm/forms/RepeatableTableField.tsx` | Tabela repetível com colunas dinâmicas; add/remove linha |
| `frontend/src/features/requisicoes-bpm/forms/ReferenceField.tsx` | Campo de referência (ID de registro externo) |

### Frontend — modificados

| Arquivo | Mudança |
|---|---|
| `frontend/src/features/requisicoes-bpm/DynamicForm.tsx` | Tipos P02 em `BpmField`; `applyFormAccess` normaliza P01/P02; `SectionedDynamicForm` renderiza fieldsets por seção |
| `frontend/src/features/requisicoes-bpm/api.ts` | 5 novos métodos: `returnForCorrection`, `saveCorrection`, `resubmit`, `requestInformation`, `respondInformation` |
| `frontend/src/features/requisicoes-bpm/BpmDraftEditorPage.tsx` | Seções P02; painel de correção (`saveCorrection`/`resubmit`); painel de resposta de informação (`respondInformation`); botões de atividade P02 (`returnForCorrection`/`requestInformation`) com painel inline |

---

## Fluxo de Correção

```
executor → returnForCorrection(activityId, reason, [editableFieldKeys])
  ↓ status: aguardando_correcao
  ↓ cria correction activity com correctionFieldKeys
author → saveCorrection(requestId, fields) — somente campos em correctionFieldKeys
author → resubmit(requestId)
  ↓ status: em_atendimento
  ↓ cria nova execução activity
```

## Fluxo de Informação

```
executor → requestInformation(activityId, question)
  ↓ status: aguardando_informacao
  ↓ SLA pausa (interval kind: paused)
  ↓ question armazenada na atividade
author → respondInformation(requestId, answer, [fields])
  ↓ status: em_atendimento
  ↓ SLA retoma (interval kind: running)
  ↓ answer armazenada no timeline
```

---

## Compatibilidade P01

- `executionMode=legacy` preservado; nenhum código legado tocado  
- `REQUEST_BPM_ENABLED=false` mantém padrão; P02 está atrás do mesmo flag  
- `record.schema` de requisições P01 continua como array plano; `applyFormAccess` normaliza ambos  
- Todas as atividades P01 existentes permanecem funcionais  

---

## Testes de Integração P02

Arquivo: `backend/test/bpm-p02-correction-info.e2e-spec.ts`

| Teste | Cobre |
|---|---|
| B01 | `returnForCorrection` → `aguardando_correcao`, `allowedActions` |
| B02 | `saveCorrection` mescla campos, mantém status |
| B03 | `resubmit` → `em_atendimento`, nova atividade de execução |
| B04 | `requestInformation` → `aguardando_informacao`, pergunta na atividade |
| B05 | `respondInformation` → `em_atendimento`, answer no timeline |
| B06 | `editableFieldKeys` restringe correção; violação rejeita com erro |

Executar com:
```bash
BPM_TEST_DATABASE_URL=postgresql://localhost/axis_bpm_test \
  npx vitest run test/bpm-p02-correction-info.e2e-spec.ts
```

---

## Erros Pré-existentes (não-P02)

Os seguintes erros de TypeScript existiam antes de P02 e **não bloqueiam** compilação ou execução:

- `prisma/seed-requests-fase1.ts` e `seed-requests-fase2-sectors.ts`: `FieldDef[]` local vs `Record<string, unknown>[]`
- `test/bpm-journey.e2e-spec.ts`: narrowing de união em tipos de retorno do serviço
- `src/request-runtime/client-contract.spec.ts`: importação cross-root para `frontend/`

Nenhum arquivo P02 tem erros de TypeScript.

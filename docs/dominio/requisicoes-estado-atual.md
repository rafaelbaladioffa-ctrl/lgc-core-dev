# Requisições — estado atual do código

> **Propósito:** descrever o que o módulo Requisições do Axis Core faz hoje (executor `legacy`), verificado no código, para servir de linha de base da reescrita do motor.
> **Data:** 2026-11-07 · branch `rafaelbaladioffa-ctrl/docs-reestruturacao`, HEAD `115d5b9`.
> **Fontes:** [requests.service.ts](../../backend/src/requests/requests.service.ts), [requests.controller.ts](../../backend/src/requests/requests.controller.ts), [DTOs](../../backend/src/requests/dto/), [attachment-security.ts](../../backend/src/requests/attachment-security.ts), [schema.prisma](../../backend/prisma/schema.prisma), seeds `backend/prisma/seed*.ts`, telas `frontend/src/pages/*Request*`, `MyActivitiesPage.tsx`, `DelegationsPage.tsx`. Documentos antigos não foram usados como fonte de comportamento.

Referências `arquivo:linha` apontam para o estado do HEAD acima. Quando um comportamento não pôde ser confirmado por leitura do código, está marcado como "não verificado".

---

## 1. Visão geral

- Um único serviço, [`RequestsService`](../../backend/src/requests/requests.service.ts) (1.390 linhas), concentra criação, triagem, aprovação, compras, execução, SLA, crons, anexos, comentários, consultas e painel.
- O motor BPM (P01–P04) foi removido no commit `98dfce5` (2026-11-02). Restaram no código: o enum `RequestExecutionMode { legacy, bpm_v1 }` ([schema.prisma:420-423](../../backend/prisma/schema.prisma#L420-L423)), filtros `executionMode: 'legacy'` em todas as consultas e o erro `409 WRONG_EXECUTOR` para registros `bpm_v1` ([requests.service.ts:1044-1049](../../backend/src/requests/requests.service.ts#L1044-L1049)).
- O fluxo de aprovação é lido do JSON `CategoryVersion.workflowSchema` ou da matriz `ApprovalAuthorityRule`; o fluxo de compras é um caminho especial codificado no serviço, escolhido pelo `kind` da categoria (`compra_material`).
- Rotas HTTP sob `/requests`, protegidas por `JwtAuthGuard` + `PermissionsGuard` com permissões `request:*` ([requests.controller.ts:35-37](../../backend/src/requests/requests.controller.ts#L35-L37)). Toda ação que cria registro exige que o usuário esteja vinculado a um colaborador (`requireCollaboratorId`, [requests.controller.ts:23-26](../../backend/src/requests/requests.controller.ts#L23-L26)).

## 2. Modelo de dados (Prisma)

| Modelo | Papel | Referência |
|---|---|---|
| `RequestCategory` | Identidade do catálogo: `code` (único, imutável), `name`, `sectorId`, `kind` (`RequestCategoryKind`: `padrao`, `compra_material`, `denuncia`; definido só na criação), `confidentiality` padrão, `active`, `requiresAcceptance`, `useDynamicAuthority`. Não há subcategorias: `parentCategoryId` foi removido | [schema.prisma:425-445](../../backend/prisma/schema.prisma#L425-L445) |
| `CategoryVersion` | `version`, `status` (`CategoryVersionStatus`: `rascunho` ou `publicada`), `formSchema` (JSON), `workflowSchema` (JSON), metas `slaFirstResponseMinutes`/`slaResolutionMinutes`, `publishedAt` (nulo no rascunho), `publishedBy`, `createdBy`. No máximo um rascunho por categoria (índice único parcial `category_versions_one_draft_idx`, criado na migração `20261122000000`) | [schema.prisma:447-464](../../backend/prisma/schema.prisma#L447-L464) |
| `Queue` | Fila por setor (`active`, `revision` vêm da migration BPM e não são usados pelo serviço) | [schema.prisma:466-478](../../backend/prisma/schema.prisma#L466-L478) |
| `Request` | Registro; `status` (19 valores), `confidentiality`, `anonymous`, `formData` (JSON livre), `estimatedValue` Decimal(19,4), `lockVersion`, `slaDue*`, `escalationLevel`, `requesterAcceptedAt`, `closedAt`; campos `currentCycle`, `requesterSectorId`, `completedAt`, `firstResponseAt` existem mas nunca são escritos | [schema.prisma:480-541](../../backend/prisma/schema.prisma#L480-L541) |
| `RequestNumberCounter` | Código `REQ-AAAA-NNNNNN` gerado por `UPDATE ... RETURNING` transacional | [schema.prisma:543-548](../../backend/prisma/schema.prisma#L543-L548), [requests.service.ts:1367-1372](../../backend/src/requests/requests.service.ts#L1367-L1372) |
| `RequestApproval` (`approvals`) | Uma linha por aprovador e `stepOrder`; `completionRule` (`todos`/`qualquer_um`/`n_de_m`), `requiredCount`, `approvalSource` (`hierarquia`/`centro_custo`) | [schema.prisma:550-569](../../backend/prisma/schema.prisma#L550-L569) |
| `RequestComment` | `visibility` `publico`/`interno` | [schema.prisma:571-583](../../backend/prisma/schema.prisma#L571-L583) |
| `RequestAttachment` | Conteúdo em `Bytes` (BYTEA), `contentHash` SHA-256, `version`/`previousVersionId` | [schema.prisma:585-605](../../backend/prisma/schema.prisma#L585-L605) |
| `SlaClock` | `metric` (`primeira_resposta`/`solucao`), `startedAt`, `targetAt`, `pausedAt`, `stoppedAt`, `breached`, `alertedThresholds` | [schema.prisma:607-621](../../backend/prisma/schema.prisma#L607-L621) |
| `Holiday` | Feriados (DATE único) usados no cálculo de horário útil | [schema.prisma:623-631](../../backend/prisma/schema.prisma#L623-L631) |
| `AuditEvent` | Trilha de domínio (`aggregateType='request'`), append-only por convenção | [schema.prisma:633-648](../../backend/prisma/schema.prisma#L633-L648) |
| `Delegation` | Delegação de aprovação com janela, escopo opcional por setor e revogação | [schema.prisma:658-675](../../backend/prisma/schema.prisma#L658-L675) |
| `RequestRelation` | `depende_de`/`bloqueia`/`duplica`/`origina`/`subtarefa_de` (só `subtarefa_de` e `origina` são gravados) | [schema.prisma:650-689](../../backend/prisma/schema.prisma#L650-L689) |
| `ApprovalAuthorityRule` | Faixa `[minValue, maxValue]` → lista de `ManagementLevel`; `sectorId` opcional | [schema.prisma:691-703](../../backend/prisma/schema.prisma#L691-L703) |

`RequestStatus` tem 19 valores ([schema.prisma:375-395](../../backend/prisma/schema.prisma#L375-L395)): `rascunho`, `enviada`, `em_triagem`, `aguardando_aprovacao`, `aprovada`, `planejada`, `em_atendimento`, `aguardando_solicitante`, `aguardando_terceiro`, `aguardando_correcao`, `aguardando_informacao`, `concluida`, `encerrada`, `devolvida_ajuste`, `reprovada`, `cancelada`, `suspensa`, `reaberta`, `expirada`. O frontend declara 17 (sem os dois `aguardando_*` do P02) em [frontend/src/api/requests.ts:4-21](../../frontend/src/api/requests.ts#L4-L21).

## 3. Catálogo e abertura

**Setor → categoria → versão.** A tela [NewRequestPage.tsx](../../frontend/src/pages/NewRequestPage.tsx) lista primeiro os setores que têm alguma categoria publicada e depois as categorias do setor ([NewRequestPage.tsx:86-93](../../frontend/src/pages/NewRequestPage.tsx#L86-L93)). O catálogo vem de `GET /request-categories` (categorias ativas com ao menos uma versão **publicada**; `currentVersion` = maior versão publicada; rascunho nunca aparece) — [request-categories.service.ts:39-51](../../backend/src/request-categories/request-categories.service.ts#L39-L51).

**Versão fixada.** `create()` recusa categoria inativa e grava a maior versão **publicada** (`findLatestPublishedVersion`, em [category-kind.ts](../../backend/src/request-categories/category-kind.ts)) no `categoryVersionId`; a recategorização na triagem usa o mesmo helper. Versão publicada nunca é editada; requisições existentes seguem na versão em que foram criadas.

**Administração do catálogo.** Pela tela `/request-categories` (menu "Catálogo de requisições", permissão `request_category:update`) e pelas rotas do §14. Ciclo: criar categoria (nasce com a versão 1 em `rascunho`) → editar o rascunho (campos do formulário, aprovação, SLA) → publicar (`request_category:publish`). Para mudar uma categoria publicada, cria-se um rascunho (versão = maior + 1, copiado da última publicada) e publica-se de novo. O conteúdo é validado ao salvar e de novo ao publicar ([category-schema.validator.ts](../../backend/src/request-categories/category-schema.validator.ts)): formulário (até 50 campos, chaves únicas `^[a-z][a-z0-9_]{0,39}$`, `select` com `options` ou `optionsSource`), fluxo (`stepOrder` único, de 1 em diante e sem buracos; nó paralelo = um passo `colaboradores` com vários colaboradores ativos; `gestor_direto` no máximo uma vez e sem misturar com níveis; níveis estritamente crescentes; `colaboradores` não se mistura com outras regras) e SLA (minutos inteiros, 1 ≤ primeira resposta ≤ solução ≤ 525.600). Por tipo: `compra_material` não aceita alçada por valor (a aprovação vem do responsável do centro de custo); `denuncia` exige confidencialidade `restrita`. A publicação é um `update` condicional (`where status = 'rascunho'`): com dois publicadores simultâneos, um vence e o outro recebe 409. Desativar a categoria (`active=false`) a tira do catálogo e faz `create()` recusá-la; requisições abertas seguem.

Os seeds (`seed-requests-fase1`, `seed-requests-fase2-sectors`, `seed-requests-parallel-demo`, `seed-approval-authority-matrix`) gravam o `kind` correto e criam a versão 1 já `publicada` (`createPublishedForSeed`).

**Campos obrigatórios em toda abertura** ([requests.service.ts:85-159](../../backend/src/requests/requests.service.ts#L85-L159)):
- `categoryId` ativo com versão; `description` (DTO, `MinLength(1)`).
- **Centro de custo obrigatório** para qualquer categoria e precisa existir ([requests.service.ts:101-104](../../backend/src/requests/requests.service.ts#L101-L104)); a tela também bloqueia sem CC ([NewRequestPage.tsx:166-169](../../frontend/src/pages/NewRequestPage.tsx#L166-L169)).
- `title` 10–120 caracteres, exceto compras, onde é gerado no servidor como `Compra de Materiais - <setor pai>/<setor>` ([requests.service.ts:177-182](../../backend/src/requests/requests.service.ts#L177-L182)).
- Campos `required` do `formSchema` (verificação de presença apenas: vazio, nulo, string em branco ou array vazio) — [requests.service.ts:1245-1255](../../backend/src/requests/requests.service.ts#L1245-L1255). Tipo, opções e formato não são validados.

**Solicitante e beneficiário.** `requesterId` é sempre o colaborador do JWT; `beneficiaryId` opcional, padrão = solicitante ([create-request.dto.ts:6-14](../../backend/src/requests/dto/create-request.dto.ts#L6-L14), [requests.service.ts:93-99](../../backend/src/requests/requests.service.ts#L93-L99)). Não há regra de quais categorias aceitam abertura em nome de terceiro.

**Fila.** A requisição entra na primeira fila do setor da categoria; se não houver, cria `Fila - <setor>` na mesma transação ([requests.service.ts:121-128](../../backend/src/requests/requests.service.ts#L121-L128)).

**Confidencialidade.** `dto.confidentiality ?? category.confidentiality` ([requests.service.ts:144](../../backend/src/requests/requests.service.ts#L144)) — o solicitante pode informar qualquer valor, inclusive rebaixar uma categoria `restrita` para `interna`.

**Subtarefa.** `parentRequestId` cria `RequestRelation subtarefa_de` ([requests.service.ts:153-155](../../backend/src/requests/requests.service.ts#L153-L155)); o pai não conclui com filha aberta ([requests.service.ts:529-536](../../backend/src/requests/requests.service.ts#L529-L536)).

**Rascunho na prática.** A tela chama `create` e em seguida `submit` no mesmo clique ([NewRequestPage.tsx:187-188](../../frontend/src/pages/NewRequestPage.tsx#L187-L188)). Se o `submit` falhar, o rascunho aparece em Minhas atividades e pode ser enviado pelo botão "Enviar requisição" do detalhe. Não há tela para editar os campos de um rascunho ou de uma requisição devolvida, embora a API (`PUT /requests/:id`) aceite os dois.

**Catálogo semeado.** 13 categorias em [seed-requests-fase1.ts](../../backend/prisma/seed-requests-fase1.ts) (TI, Financeiro, Suprimentos, Almoxarifado, Frota, RH, DP, Administração) e 14 em [seed-requests-fase2-sectors.ts](../../backend/prisma/seed-requests-fase2-sectors.ts) (Jurídico, Compliance, Operações, Qualidade, HSE) — 27 no total; mais duas categorias de QA: `[QA] Aprovação paralela` ([seed-requests-parallel-demo.ts:49-56](../../backend/prisma/seed-requests-parallel-demo.ts#L49-L56)) e `[QA] Alçada dinâmica por valor` ([seed-approval-authority-matrix.ts:57-80](../../backend/prisma/seed-approval-authority-matrix.ts#L57-L80)). Metas padrão 240/2.880 minutos ([seed-requests-fase1.ts:43-44](../../backend/prisma/seed-requests-fase1.ts#L43-L44)). O antigo `seed-requests-suprimentos.ts` (resíduo do BPM, não compilava) foi removido em 2026-11-07.

## 4. Máquina de estados

Legenda de quem pode: **Sol.** = solicitante; **Benef.** = beneficiário; "não-sol." = ator não pode ser solicitante nem beneficiário (`assertNotRequester`, [requests.service.ts:1055-1059](../../backend/src/requests/requests.service.ts#L1055-L1059)). Toda transição chama `getOrThrow` (404 se não existe, 409 `WRONG_EXECUTOR` se `bpm_v1`).

| Status | Ação (rota) | Permissão da rota | Quem pode, além da permissão | Destino |
|---|---|---|---|---|
| `rascunho`, `devolvida_ajuste` | editar (`PUT /:id`) | `request:create` | só Sol. (`update`) | mesmo status |
| `rascunho`, `devolvida_ajuste` | enviar / reenviar (`POST /:id/submit`) | `request:create` | só Sol.; valida obrigatórios da versão atual da categoria, exceto quando há `purchaseItems`. Reenvio grava `request.resubmitted` e emite `request.status_changed`; `submittedAt` mantém o primeiro envio (`submit`) | `enviada` |
| `enviada` | triagem `aceitar` (`POST /:id/triage`) | `request:update` | não-sol.; compras: papel `analista_suprimentos` ou `admin`; denúncia: fora da cadeia do denunciado ([:229-328](../../backend/src/requests/requests.service.ts#L229-L328)) | compras → `em_atendimento`; demais → `aguardando_aprovacao`, ou `aprovada` se a cadeia resolver vazia |
| `enviada` | triagem `devolver` | `request:update` | idem; motivo obrigatório | `devolvida_ajuste` |
| `enviada` | triagem `recategorizar` | `request:update` | idem; troca só `categoryVersionId` (setor/fila não mudam) ([:248-257](../../backend/src/requests/requests.service.ts#L248-L257)) | `devolvida_ajuste` |
| `aguardando_aprovacao` | aprovar / reprovar (`POST /:id/approve`, `/reject`) | `request:approve` | aprovador de linha pendente da etapa ativa ou delegado ativo dele; não-sol. ([:412-471](../../backend/src/requests/requests.service.ts#L412-L471)) | aguarda demais / próxima etapa / `aprovada`; reprovação → `reprovada` |
| `aprovada`, `planejada` | iniciar (`POST /:id/start`) | `request:update` | não-sol.; qualquer portador da permissão (não exige ser o `assignee`) ([:476-486](../../backend/src/requests/requests.service.ts#L476-L486)) | `em_atendimento` |
| `em_atendimento` | pedir informação (`POST /:id/request-information`) | `request:update` | não-sol. ([:488-500](../../backend/src/requests/requests.service.ts#L488-L500)) | `aguardando_solicitante` |
| `em_atendimento` | concluir (`POST /:id/complete`) | `request:update` | não-sol.; sem subtarefas abertas; compra de material exige aprovação do centro de custo aprovada e nenhuma pendente ([:524-548](../../backend/src/requests/requests.service.ts#L524-L548)) | `concluida` |
| `aguardando_solicitante` | responder (`POST /:id/resume`) | `request:create` | Sol./Benef., com `answer` obrigatória (vira comentário público) (`resume`) | `em_atendimento` |
| `aguardando_solicitante`, `aguardando_terceiro` | retomar (`POST /:id/resume`) | `request:create` | quem tem `request:update` (verificado no serviço); o solicitante não retoma pendência de terceiro | `em_atendimento` |
| `concluida` | aceitar entrega (`POST /:id/accept`) | `request:create` | só Sol. ([:552-561](../../backend/src/requests/requests.service.ts#L552-L561)) | `concluida` (grava `requesterAcceptedAt`) |
| `concluida` | encerrar (`POST /:id/close`) ou cron | `request:update` | não-sol.; exige aceite se `requiresAcceptance` ([:563-577](../../backend/src/requests/requests.service.ts#L563-L577)) | `encerrada` |
| `concluida`, `encerrada`, `reprovada` | reabrir (`POST /:id/reopen`) | `request:create` | Sol. ou quem tem `request:update` (`reopen`); emite `request.status_changed` | `enviada` (volta à fila de triagem do setor); ou, se > 5 dias úteis desde `closedAt ?? updatedAt` (exceto `reprovada`), nova requisição `rascunho` ligada por `origina` |
| qualquer, exceto `concluida`/`encerrada`/`cancelada` | cancelar (`POST /:id/cancel`) | `request:create` | Sol./Benef. só em `rascunho`/`devolvida_ajuste`; quem tem `request:update` em qualquer dessas fases ([:634-648](../../backend/src/requests/requests.service.ts#L634-L648)) | `cancelada` |
| qualquer | atribuir (`POST /:id/assign`) | `request:assign` | sem checagem de estado nem de conflito ([:330-335](../../backend/src/requests/requests.service.ts#L330-L335)) | mesmo status |

Estados sem saída ou sem entrada:
- `em_triagem`: só existe dentro da transação do aceite da triagem (gravado e sobrescrito em seguida); nenhum comando parte dele. Registros reabertos antes de 2026-11-07 que ficaram presos nele são movidos para `enviada` pela migração `20261121000001_requisicoes_destravar_em_triagem`, com um `audit_event` `request.unstuck_from_triage` para cada um.
- `planejada`, `aguardando_terceiro`: aceitos como origem, nunca atribuídos.
- `suspensa`, `reaberta`, `expirada`, `aguardando_correcao`, `aguardando_informacao`: não referenciados em `backend/src`.

## 5. Aprovações

**Resolução da cadeia** (na triagem, [requests.service.ts:268-327](../../backend/src/requests/requests.service.ts#L268-L327), [:1299-1365](../../backend/src/requests/requests.service.ts#L1299-L1365)). O `workflowSchema` é uma lista de passos com um dos `approverRule`:
- `gestor_direto`: sobe a partir do solicitante até o primeiro supervisor que não esteja em conflito; um aprovador; sem supervisor → cadeia vazia.
- `management_level`: passos com `requiredLevel` acima do nível do solicitante; sobe a cadeia `supervisorId` e casa níveis exatos (`colaborador < supervisor < coordenador < gerente < diretor`, [:25-31](../../backend/src/requests/requests.service.ts#L25-L31)); nível que ninguém ocupa é pulado.
- `colaboradores`: nó com lista explícita de IDs; `completionRule` `todos`/`qualquer_um`/`n_de_m`. Misturar `colaboradores` com outros tipos não é suportado ([:1319-1333](../../backend/src/requests/requests.service.ts#L1319-L1333)).

**Conflitos.** Solicitante e beneficiário são sempre removidos da cadeia; em denúncia (`kind = denuncia`, helper `isWhistleblower`), o envolvido (`formData.envolvido_id`) e toda a sua cadeia de supervisores também ([:274-282](../../backend/src/requests/requests.service.ts#L274-L282), [:1106-1125](../../backend/src/requests/requests.service.ts#L1106-L1125)). Pela leitura de [:1349-1361](../../backend/src/requests/requests.service.ts#L1349-L1361), um ancestral em conflito com nível exato faz o laço subir, mas o ancestral seguinte de nível maior faz `cursor += 1` sem gravar aprovador — o nível tende a ser pulado em vez de receber substituto (não reproduzido em teste).

**Alçada por valor** (`useDynamicAuthority=true`, [:1275-1297](../../backend/src/requests/requests.service.ts#L1275-L1297)): valor efetivo = `estimatedValue` próprio + soma de `estimatedValue` de outras requisições do mesmo solicitante criadas nos últimos 30 dias (qualquer categoria, exceto rascunho/cancelada/reprovada). A regra aplicável prefere a do setor à global; faixas fechadas nos dois lados `value >= min && value <= max` ([approval-authority-rules.service.ts:21-26](../../backend/src/approval-authority-rules/approval-authority-rules.service.ts#L21-L26)). Matriz semeada: 0–1.000 supervisor; 1.000,01–10.000 supervisor+coordenador; 10.000,01–50.000 coordenador+gerente; 50.000,01–100.000 gerente+diretor; > 100.000 diretor ([seed-approval-authority-matrix.ts:36-42](../../backend/prisma/seed-approval-authority-matrix.ts#L36-L42)). Sem regra aplicável → cadeia vazia. Fracionamento detectado só gera `AuditEvent request.fractionation_detected`.

**Paralelo e quórum.** Linhas com o mesmo `stepOrder` formam um nó; a etapa ativa é o menor `stepOrder` com linha `pendente` ([:1071-1076](../../backend/src/requests/requests.service.ts#L1071-L1076)). Ao aprovar: conta aprovações e total **apenas sobre as linhas ainda pendentes** ([:435-436](../../backend/src/requests/requests.service.ts#L435-L436), [:1080-1084](../../backend/src/requests/requests.service.ts#L1080-L1084)); satisfeito o nó, os pendentes restantes viram `devolvido`. Qualquer reprovação reprova a requisição inteira (veto) e marca todos os pendentes `devolvido` ([:456-471](../../backend/src/requests/requests.service.ts#L456-L471)).

**Delegação.** `findDecidableRow` aceita o titular ou um delegado com `Delegation` não revogada, `startsAt <= agora <= endsAt` e setor nulo ou igual ([:1089-1100](../../backend/src/requests/requests.service.ts#L1089-L1100), [delegations.service.ts:39-52](../../backend/src/delegations/delegations.service.ts#L39-L52)). Delegação não pode começar no passado ([delegations.service.ts:11-20](../../backend/src/delegations/delegations.service.ts#L11-L20)); só quem delegou revoga. A tela [DelegationsPage.tsx](../../frontend/src/pages/DelegationsPage.tsx) cria/lista/revoga. `myApprovals` e o acesso a requisição `restrita` consideram só `approverId`, não delegações ([:831-861](../../backend/src/requests/requests.service.ts#L831-L861), [:728](../../backend/src/requests/requests.service.ts#L728)).

**Auto-aprovação no topo.** Quando a cadeia resolve vazia (solicitante sem superior, todos os níveis abaixo do dele, nenhuma regra de alçada aplicável ou todos em conflito), a triagem chama `finalizeApproval` direto e a requisição vai a `aprovada` sem aprovador ([:308-310](../../backend/src/requests/requests.service.ts#L308-L310)). É a decisão registrada no §27.2 da spec (ver [decisoes-negocio.md](decisoes-negocio.md)); hoje não há evento de auditoria específico distinguindo "pulo legítimo" de "falha de configuração".

## 6. Compra de material (`kind = compra_material`)

Identificada por `category.kind === 'compra_material'` (helper `isPurchase` em [category-kind.ts](../../backend/src/request-categories/category-kind.ts)) nos cinco pontos do serviço e, no frontend, em [NewRequestPage.tsx](../../frontend/src/pages/NewRequestPage.tsx) (`selectedCategory.kind`). Código e nome da categoria não influenciam mais. A migração `20261122000000` marcou como `compra_material` as categorias com `code = 'SUP-COMPRA'` ou nome "compra de material".

1. **Itens da Logística.** A tela carrega o catálogo e a disponibilidade direto do satélite Logística com o token do Core (`/materials/purchase-catalog`, `/materials/availability:batch` — [frontend/src/api/logisticsCatalog.ts:27-40](../../frontend/src/api/logisticsCatalog.ts#L27-L40)) e monta `formData.purchaseItems` com `materialId`, código, descrição, unidade, `quantity` e `unitPrice` ([NewRequestPage.tsx:182-186](../../frontend/src/pages/NewRequestPage.tsx#L182-L186)). O backend só confere `materialId` string, `quantity > 0`, `unitPrice >= 0` e calcula `estimatedValue = Σ quantity × unitPrice` em ponto flutuante ([:161-175](../../backend/src/requests/requests.service.ts#L161-L175)).
2. **Triagem de Suprimentos.** Só `analista_suprimentos`/`admin` aceitam; a requisição vai direto a `em_atendimento` com o triador como `assignee`, sem cadeia de aprovação nem relógios SLA ([:261-267](../../backend/src/requests/requests.service.ts#L261-L267)). O `workflowSchema` semeado (`CADEIA_CUSTO`) e a alçada dinâmica não são usados em compras.
3. **Análise de Suprimentos** (`POST /:id/purchase-analysis`, papel analista/admin): por item `stockStatus` `disponivel`/`parcial`/`indisponivel`, `availableQuantity`, `needsQuotation`; precisa cobrir todos os `materialId`; aceita em `enviada`…`em_atendimento`; grava `formData.procurementAnalysis` e assume a requisição ([:337-351](../../backend/src/requests/requests.service.ts#L337-L351)). Não cria reserva nem movimento na Logística.
4. **Cotações** (`POST /:id/purchase-quotation`, só em `em_atendimento`, exige análise): fornecedor, número, `totalValue`, anexos (IDs não verificados), `selected`; lista em `formData.procurementQuotations`; `estimatedValue` passa a ser o `totalValue` da última cotação gravada. Na primeira cotação cria uma `RequestApproval` `approvalSource='centro_custo'` para o responsável do CC e muda para `aguardando_aprovacao`; se já houver aprovação do CC `aprovado`, o status não muda ([:353-387](../../backend/src/requests/requests.service.ts#L353-L387)).
5. **Escolha pelo responsável do CC** (`POST /:id/purchase-quotation-selection`, rota com `request:read`): só o `responsibleCollaboratorId` do CC; sem checagem de status; não altera `estimatedValue` ([:389-407](../../backend/src/requests/requests.service.ts#L389-L407)).
6. **Aprovação final** pelo responsável do CC exige `procurementAnalysis` presente ([:420-423](../../backend/src/requests/requests.service.ts#L420-L423)); se o responsável for o solicitante, `assertNotRequester` bloqueia e não há substituto.
7. Depois de `aprovada`, segue o fluxo comum: iniciar → `em_atendimento` → concluir. A conclusão de compra só é aceita (`complete`, e o botão Concluir só aparece) depois que existe aprovação `centro_custo` aprovada e nenhuma linha pendente; antes disso o Suprimentos só pode pedir informação ao solicitante ou cancelar. Não há emissão de pedido, recebimento ou evento de material para a Logística.

## 7. SLA

- **Relógios** `primeira_resposta` e `solucao` são criados só em `finalizeApproval` — o SLA começa na aprovação, não no envio ([:1228-1243](../../backend/src/requests/requests.service.ts#L1228-L1243)). Compras não têm relógio até a aprovação do CC.
- **Prazo** em minutos úteis: seg–sex 08h–18h, feriados de `Holiday`, fuso fixo UTC−3 (`SP_OFFSET_MS`) ([:65-69](../../backend/src/requests/requests.service.ts#L65-L69), [:1127-1218](../../backend/src/requests/requests.service.ts#L1127-L1218)). O prazo é gravado em dois lugares: `SlaClock.targetAt` e `Request.slaDue*`.
- **Primeira resposta** para em `start()`; **solução** para em `complete()`; `breached = agora > targetAt` ([:482-484](../../backend/src/requests/requests.service.ts#L482-L484), [:540-541](../../backend/src/requests/requests.service.ts#L540-L541)).
- **Pausa:** `requestInformation` pausa `solucao`; `resume` estende `targetAt` pela duração corrida da pausa ([:493-519](../../backend/src/requests/requests.service.ts#L493-L519)).
- **Cron `runAutoClose`** (`EVERY_HOUR`, [:966-980](../../backend/src/requests/requests.service.ts#L966-L980)): encerra `concluida` com `updatedAt` há mais de 3 dias corridos (`AUTO_CLOSE_AFTER_DAYS`, [:61](../../backend/src/requests/requests.service.ts#L61)); categorias com aceite pendente ficam paradas (exceção logada).
- **Cron `runSlaAlertsAndEscalation`** (`EVERY_5_MINUTES`, [:994-1040](../../backend/src/requests/requests.service.ts#L994-L1040)): para relógios abertos e não pausados, fração corrida `(agora − startedAt)/(targetAt − startedAt)`; limiares 50/80/100% gravados uma vez em `alertedThresholds` com `sla.warning`; no primeiro estouro de `solucao` com `escalationLevel=0`, marca `breached`, incrementa o nível e reatribui ao supervisor do `assignee` (`sla.breached`).
- **Bucket da tela** (`no_prazo`/`em_alerta` ≥ 80%/`atrasado` ≥ 100%) usa a mesma fração corrida ([:953-962](../../backend/src/requests/requests.service.ts#L953-L962)).
- **Reabertura:** janela de 5 dias úteis contados por `countBusinessDays` desde `closedAt ?? updatedAt` ([:592-596](../../backend/src/requests/requests.service.ts#L592-L596)).
- **Calendário:** CRUD de feriados em `/holidays` ([holidays.controller.ts](../../backend/src/holidays/holidays.controller.ts)); `HolidaysService` é injetado em `RequestsService` mas não usado (leitura direta via Prisma em [:1175-1178](../../backend/src/requests/requests.service.ts#L1175-L1178)).

## 8. Confidencialidade e anonimato

- `confidentiality` `interna`/`confidencial`/`restrita`. Só `restrita` restringe o detalhe: exige ser solicitante, beneficiário, `assignee` ou ter linha de aprovação ([:725-731](../../backend/src/requests/requests.service.ts#L725-L731)); a negação é 403 (não 404). `confidencial` é tratada como `interna`: qualquer portador de `request:read` lê o detalhe completo, inclusive `formData`.
- Notas `interno` são removidas do detalhe para quem não é aprovador nem executor, inclusive solicitante/beneficiário ([:732-736](../../backend/src/requests/requests.service.ts#L732-L736)).
- **Anonimato:** só em categoria `kind = denuncia` com `formData.anonimo === true` ([:117](../../backend/src/requests/requests.service.ts#L117)). No detalhe, `requesterId`/`requester` viram `null` e `requesterDisplay='Anônimo'` para quem não é o próprio solicitante nem tem `request:view_whistleblower_identity` ([:743-751](../../backend/src/requests/requests.service.ts#L743-L751)); em `myApprovals` o nome é mascarado ([:858](../../backend/src/requests/requests.service.ts#L858)). A fila (`findQueue`) devolve só campos de cabeçalho (sem `formData`/`description`), filtra `restrita` no SQL para quem não participa e mascara `requesterId` e `beneficiaryId` de denúncia anônima. `findMine` (só as próprias), `myActivities` (não devolve identidade), comentários (`authorId`), anexos (`uploadedBy`) e auditoria não mascaram.

## 9. Anexos

- Upload em JSON base64 (`POST /:id/attachments`, `request:comment`), sem checagem de participação nem de status ([:659-691](../../backend/src/requests/requests.service.ts#L659-L691)).
- [attachment-security.ts](../../backend/src/requests/attachment-security.ts): MIME por magic bytes com allowlist PDF/PNG/JPEG/ZIP (DOCX/XLSX entram como ZIP), bloqueio de executável (MZ, ELF, `#!`) e de extensões perigosas, 25 MB por arquivo e 100 MB por requisição, nome seguro `uuid.ext`, SHA-256. Sem antimalware (decisão §27.1).
- Nova versão via `replacesAttachmentId` (mesma requisição), sem sobrescrever.
- Download (`GET /:id/attachments/:attachmentId`, `request:read`) chama `findOne` antes, herdando o bloqueio de `restrita` ([requests.controller.ts:224-231](../../backend/src/requests/requests.controller.ts#L224-L231)).

## 10. Comentários

`POST /:id/comments` (`request:comment`) grava `publico` ou `interno` em qualquer status, para qualquer requisição existente, sem checar participação; o solicitante pode gravar nota interna ([:650-653](../../backend/src/requests/requests.service.ts#L650-L653)). `requestInformation`, `resume` e `complete` também criam comentários públicos com a pergunta, a resposta e a resolução. A tela de detalhe não oferece escolha de visibilidade ([RequestDetailPage.tsx:392-414](../../frontend/src/pages/RequestDetailPage.tsx#L392-L414)).

## 11. Minhas atividades

`GET /requests/my-activities` ([:883-949](../../backend/src/requests/requests.service.ts#L883-L949)) agrega quatro origens: (1) `minha_requisicao` — próprias ou como beneficiário em `rascunho`/`devolvida_ajuste`/`aguardando_solicitante`; (2) `triagem` — `enviada` do setor do colaborador, só para quem tem `request:update`; (3) `aprovacao` — `myApprovals` (etapa ativa, sem delegações); (4) `execucao` — `aprovada`/`planejada`/`em_atendimento` com `assigneeId` = colaborador. Cada item traz `dueAt` e `bucket` do relógio `solucao`. A tela [MyActivitiesPage.tsx](../../frontend/src/pages/MyActivitiesPage.tsx) é a rota `/requests` e agrupa por categoria com contadores por bucket.

Demais telas: [MyRequestsPage](../../frontend/src/pages/MyRequestsPage.tsx) (`/requests/mine`), [RequestsQueuePage](../../frontend/src/pages/RequestsQueuePage.tsx) (`/requests/queue`, filtro de setor escolhido no cliente), [MyRequestApprovalsPage](../../frontend/src/pages/MyRequestApprovalsPage.tsx) (`/my-approvals`), [RequestsDashboardPage](../../frontend/src/pages/RequestsDashboardPage.tsx) (`/requests/dashboard`), [DelegationsPage](../../frontend/src/pages/DelegationsPage.tsx) (`/delegations`).

## 12. Travamento do solicitante

Commit `115d5b9`: em [RequestDetailPage.tsx:14](../../frontend/src/pages/RequestDetailPage.tsx#L14), `REQUESTER_TURN_STATUSES = ['rascunho','devolvida_ajuste','aguardando_solicitante']`. Fora desses status, quem é solicitante/beneficiário vê aviso de "travada" e nenhum botão de staff (aprovar, iniciar, pedir informação, concluir, retomar, encerrar), mesmo que o papel tenha a permissão ([RequestDetailPage.tsx:115-123](../../frontend/src/pages/RequestDetailPage.tsx#L115-L123), [:329-389](../../frontend/src/pages/RequestDetailPage.tsx#L329-L389)). Exceções: reabrir (status terminal) e aceite de entrega. O travamento é só de UI; no backend a mesma proteção existe via `assertNotRequester` em triagem, análise/cotação de compras, aprovação, iniciar, pedir informação, concluir e encerrar — mas **não** em `resume`, `assign`, `addComment`, `addAttachment` e `selectPurchaseQuotation`. Nos status de vez do solicitante, a tela oferece "Enviar requisição" (rascunho), "Reenviar para triagem" (devolvida para ajuste) e "Responder ao atendente" (aguardando solicitante). Erros das ações aparecem ao lado dos botões.

## 13. Eventos de outbox

Gravados via `OutboxService.record` na mesma transação do estado ([outbox.service.ts](../../backend/src/integration/outbox.service.ts)):

| Evento | Quando | Payload | Referência |
|---|---|---|---|
| `request.submitted` | `submit` | `request_id`, `code` | [:222](../../backend/src/requests/requests.service.ts#L222) |
| `request.status_changed` | reprovação, cancelamento, aprovação final, reenvio após devolução, reabertura | `request_id`, `status` (+`code` exceto na aprovação) | [:468](../../backend/src/requests/requests.service.ts#L468), [:645](../../backend/src/requests/requests.service.ts#L645), [:1241](../../backend/src/requests/requests.service.ts#L1241) |
| `request.completed` | `complete` | `request_id`, `code` | [:545](../../backend/src/requests/requests.service.ts#L545) |
| `sla.warning` | cron, cada limiar 50/80/100 | `request_id`, `code`, `metric`, `threshold` | [:1013](../../backend/src/requests/requests.service.ts#L1013) |
| `sla.breached` | cron, primeiro estouro de `solucao` | `request_id`, `code`, `reassigned_to` | [:1033](../../backend/src/requests/requests.service.ts#L1033) |

Triagem, início, encerramento e atribuição não emitem evento de outbox. Nenhum evento `material_request.*` é emitido.

`AuditEvent` de domínio é gravado em quase todas as transições (lista em `this.audit(...)`); `start()` e `update()` não gravam `AuditEvent` (a rota grava `AuditLog` genérico via `@AuditAction`).

## 14. Endpoints

| Método | Rota | Permissão | Serviço |
|---|---|---|---|
| POST | `/requests` | `request:create` | `create` |
| GET | `/requests/mine` | `request:read` | `findMine` |
| GET | `/requests/queue` | `request:read` | `findQueue` |
| GET | `/requests/dashboard` | `request:read` | `dashboard` |
| GET | `/requests/my-approvals` | `request:read` | `myApprovals` |
| GET | `/requests/my-activities` | `request:read` | `myActivities` |
| GET | `/requests/:id` | `request:read` | `findOne` |
| PUT | `/requests/:id` | `request:create` | `update` |
| POST | `/requests/:id/submit` | `request:create` | `submit` |
| POST | `/requests/:id/triage` | `request:update` | `triage` |
| POST | `/requests/:id/assign` | `request:assign` | `assign` |
| POST | `/requests/:id/purchase-analysis` | `request:update` + papel `analista_suprimentos`/`admin` | `recordPurchaseAnalysis` |
| POST | `/requests/:id/purchase-quotation` | `request:update` + papel `analista_suprimentos`/`admin` | `recordPurchaseQuotation` |
| POST | `/requests/:id/purchase-quotation-selection` | `request:read` | `selectPurchaseQuotation` |
| POST | `/requests/:id/approve` | `request:approve` | `approve` |
| POST | `/requests/:id/reject` | `request:approve` | `reject` |
| POST | `/requests/:id/start` | `request:update` | `start` |
| POST | `/requests/:id/request-information` | `request:update` | `requestInformation` |
| POST | `/requests/:id/resume` | `request:create` (serviço exige `request:update`, exceto o solicitante respondendo) | `resume` |
| POST | `/requests/:id/complete` | `request:update` | `complete` |
| POST | `/requests/:id/accept` | `request:create` | `accept` |
| POST | `/requests/:id/close` | `request:update` | `close` |
| POST | `/requests/:id/reopen` | `request:create` | `reopen` |
| POST | `/requests/:id/cancel` | `request:create` | `cancel` |
| POST | `/requests/:id/comments` | `request:comment` | `addComment` |
| POST | `/requests/:id/attachments` | `request:comment` | `addAttachment` |
| GET | `/requests/:id/attachments/:attachmentId` | `request:read` | `findOne` + `getAttachmentContent` |
| GET | `/request-categories` | `request_category:read` | catálogo da abertura: ativas com versão publicada |
| GET | `/request-categories/admin` | `request_category:update` | lista da administração (inclui inativas, versão vigente, rascunho pendente) |
| GET | `/request-categories/:id` | `request_category:update` | categoria + todas as versões |
| POST | `/request-categories` | `request_category:create` | cria categoria (`code`, `kind`) + versão 1 em rascunho; 409 se o código existe |
| PATCH | `/request-categories/:id` | `request_category:update` | nome, setor, confidencialidade, aceite, alçada por valor, ativa |
| POST / PUT / DELETE | `/request-categories/:id/draft` | `request_category:update` | cria (409 se já há), edita e descarta o rascunho |
| POST | `/request-categories/:id/draft/publish` | `request_category:publish` | publica o rascunho (409 em corrida) |
| POST / GET / DELETE | `/approval-authority-rules[/:id]` | `request_category:create` / `:read` | matriz de alçada (DELETE inativa) |
| POST / GET / DELETE | `/holidays[/:id]` | `request_category:create` / `:read` | feriados |
| POST / GET / POST | `/delegations`, `/delegations/mine`, `/delegations/:id/revoke` | `delegation:create` / `:read` / `:create` | delegações |

Papéis semeados com permissões de requisição ([seed.ts](../../backend/prisma/seed.ts)): `admin` (todas), `rh` (create/read/comment/approve), `gestor` (create/read/update/assign/approve/comment), `tecnico` (create/read/update/comment), `analista_suprimentos` (create/read/update/assign/comment), `colaborador` (create/read/comment), `compliance` (read/update/approve/comment/view_whistleblower_identity, não atribuído por padrão).

## 15. Limitações conhecidas

Cada item foi conferido no HEAD `115d5b9`; as linhas citadas referem-se a esse commit. Itens marcados ~~riscados~~ foram corrigidos em 2026-11-07 (branch `rafaelbaladioffa-ctrl/correcoes-bloqueantes`).

| # | Limitação | Evidência |
|---|---|---|
| ~~L01~~ | **Corrigido.** `GET /requests/queue` devolvia linhas cruas de `Request` (inclui `requesterId`, `formData`, `estimatedValue`) sem filtro de confidencialidade, sem mascarar denúncia anônima e com `sectorId` escolhido pelo cliente (exceto analista de Suprimentos). | [requests.service.ts:760-772](../../backend/src/requests/requests.service.ts#L760-L772) |
| L02 | `formData` é objeto livre (`@IsObject`): o solicitante pode enviar `procurementAnalysis` e `procurementQuotations` na criação/edição. A cotação só checa a presença de `procurementAnalysis` e a aprovação do CC também, então a análise forjada satisfaz ambas. | [create-request.dto.ts:51-53](../../backend/src/requests/dto/create-request.dto.ts#L51-L53); [requests.service.ts:361](../../backend/src/requests/requests.service.ts#L361), [:420-423](../../backend/src/requests/requests.service.ts#L420-L423) |
| L03 | `update()` de rascunho grava `formData`, `estimatedValue`, `costCenterId` e `confidentiality` do DTO sem revalidar `purchaseItems` nem recalcular `estimatedValue`; `submit` pula a validação de obrigatórios quando há `purchaseItems`. | [requests.service.ts:184-204](../../backend/src/requests/requests.service.ts#L184-L204), [:215-217](../../backend/src/requests/requests.service.ts#L215-L217) |
| L04 | Sem lock otimista: `lockVersion` é incrementado em `update()` e nunca comparado; transições leem o estado fora da transação e gravam sem condição de versão/estado. | [requests.service.ts:201](../../backend/src/requests/requests.service.ts#L201), [:1220-1226](../../backend/src/requests/requests.service.ts#L1220-L1226) |
| L05 | Quórum calculado só sobre linhas ainda pendentes: em `n_de_m` com N≥2 cada voto conta 1 e o nó nunca é satisfeito; duas aprovações simultâneas num nó `todos` com 2 pendentes leem o mesmo snapshot, nenhuma finaliza e a requisição fica em `aguardando_aprovacao` sem pendentes. | [requests.service.ts:413-451](../../backend/src/requests/requests.service.ts#L413-L451), [:1071-1084](../../backend/src/requests/requests.service.ts#L1071-L1084) |
| L06 | Código morto na triagem: o bloco de compras dentro da transação nunca executa, porque compras retornam antes. | [requests.service.ts:261-267](../../backend/src/requests/requests.service.ts#L261-L267) vs [:286-293](../../backend/src/requests/requests.service.ts#L286-L293) |
| ~~L07~~ | **Corrigido.** String mágica `SUP-COMPRA` / `'compra de material'` (e `CMP-DENUNCIA`) repetida no serviço e no frontend: agora o comportamento vem do campo `kind` da categoria. | [requests.service.ts:106](../../backend/src/requests/requests.service.ts#L106), [:238](../../backend/src/requests/requests.service.ts#L238), [:286](../../backend/src/requests/requests.service.ts#L286), [:341](../../backend/src/requests/requests.service.ts#L341), [:357](../../backend/src/requests/requests.service.ts#L357); [NewRequestPage.tsx:97](../../frontend/src/pages/NewRequestPage.tsx#L97) |
| L08 | Papéis checados por nome (`'admin'`, `'analista_suprimentos'`) em vez de permissão. | [requests.service.ts:239](../../backend/src/requests/requests.service.ts#L239), [:762](../../backend/src/requests/requests.service.ts#L762); [requests.controller.ts:28-33](../../backend/src/requests/requests.controller.ts#L28-L33); [RequestDetailPage.tsx:111](../../frontend/src/pages/RequestDetailPage.tsx#L111) |
| L09 | Resquícios do BPM: `executionMode`/`bpm_v1` e `WRONG_EXECUTOR`; filtros `executionMode: 'legacy'` espalhados; estados `aguardando_correcao`/`aguardando_informacao` sem uso; ~~`seed-requests-suprimentos.ts` referencia modelos inexistentes~~ (removido). | [schema.prisma:385-386](../../backend/prisma/schema.prisma#L385-L386), [:420-423](../../backend/prisma/schema.prisma#L420-L423), [:500](../../backend/prisma/schema.prisma#L500); [requests.service.ts:723](../../backend/src/requests/requests.service.ts#L723), [:1047](../../backend/src/requests/requests.service.ts#L1047), [:1064](../../backend/src/requests/requests.service.ts#L1064) |
| L10 | Crons `@Cron` sem lock distribuído: com mais de uma instância do backend, auto-close e alertas rodam em paralelo; `alertedThresholds` é lido fora da transação, então dois processos podem emitir o mesmo `sla.warning`. | [requests.service.ts:966-980](../../backend/src/requests/requests.service.ts#L966-L980), [:994-1040](../../backend/src/requests/requests.service.ts#L994-L1040) |
| L11 | `completedAt` (e `firstResponseAt`, `currentCycle`, `requesterSectorId`) nunca preenchidos; auto-close e métricas usam `updatedAt`/`closedAt`. | [schema.prisma:501-504](../../backend/prisma/schema.prisma#L501-L504); [requests.service.ts:969](../../backend/src/requests/requests.service.ts#L969), [:804](../../backend/src/requests/requests.service.ts#L804) |
| L12 | `unitPrice`/`materialId` vêm do cliente sem verificação na Logística; `estimatedValue` de compras é calculado em `Number` (float). | [requests.service.ts:161-175](../../backend/src/requests/requests.service.ts#L161-L175), [:131](../../backend/src/requests/requests.service.ts#L131), [:149](../../backend/src/requests/requests.service.ts#L149) |
| L13 | Solicitante escolhe a confidencialidade e pode rebaixar categoria `restrita`. | [requests.service.ts:144](../../backend/src/requests/requests.service.ts#L144); [create-request.dto.ts:31-33](../../backend/src/requests/dto/create-request.dto.ts#L31-L33) |
| L14 | `confidencial` não restringe leitura; `restrita` responde 403 (revela existência). Delegado não é considerado participante. | [requests.service.ts:725-731](../../backend/src/requests/requests.service.ts#L725-L731) |
| L15 | Comentários e anexos sem checagem de participação/confidencialidade; solicitante grava nota `interno`. | [requests.service.ts:650-653](../../backend/src/requests/requests.service.ts#L650-L653), [:659-661](../../backend/src/requests/requests.service.ts#L659-L661) |
| L16 | ~~`devolvida_ajuste` não tem reenvio; `reopen` leva a `em_triagem`~~ (**corrigido**). Continua aberto: recategorização não muda setor/fila, e não há tela para editar os campos antes de reenviar. | [requests.service.ts:186](../../backend/src/requests/requests.service.ts#L186), [:208](../../backend/src/requests/requests.service.ts#L208), [:231](../../backend/src/requests/requests.service.ts#L231), [:253](../../backend/src/requests/requests.service.ts#L253), [:623](../../backend/src/requests/requests.service.ts#L623) |
| L17 | Cadeia vazia aprova automaticamente também quando não há regra de alçada aplicável (lacuna de faixa, ex.: valor entre 1.000,00 e 1.000,01 com 4 casas decimais), não só no topo da hierarquia. | [requests.service.ts:308-310](../../backend/src/requests/requests.service.ts#L308-L310), [:1292-1293](../../backend/src/requests/requests.service.ts#L1292-L1293); [approval-authority-rules.service.ts:23](../../backend/src/approval-authority-rules/approval-authority-rules.service.ts#L23) |
| L18 | Compras: nova cotação após aprovação do CC mantém a aprovação antiga; seleção não sincroniza `estimatedValue`; `attachmentIds` da cotação não são verificados. | [requests.service.ts:377-379](../../backend/src/requests/requests.service.ts#L377-L379), [:403-404](../../backend/src/requests/requests.service.ts#L403-L404), [:371](../../backend/src/requests/requests.service.ts#L371) |
| L19 | SLA: fuso fixo UTC−3, relógio só a partir da aprovação, pausa estendida em tempo corrido, percentual por tempo corrido, prazo duplicado em `Request.slaDue*` e `SlaClock.targetAt`; painel chama de "SLA" o tempo corrido `createdAt → closedAt`. | [requests.service.ts:1136](../../backend/src/requests/requests.service.ts#L1136), [:1228-1243](../../backend/src/requests/requests.service.ts#L1228-L1243), [:510-513](../../backend/src/requests/requests.service.ts#L510-L513), [:1006](../../backend/src/requests/requests.service.ts#L1006), [:803-805](../../backend/src/requests/requests.service.ts#L803-L805) |
| L20 | Painel e `myApprovals` globais/sem delegação; `GET /requests/dashboard` agrega todas as requisições para qualquer `request:read`. | [requests.service.ts:778-829](../../backend/src/requests/requests.service.ts#L778-L829), [:831-840](../../backend/src/requests/requests.service.ts#L831-L840) |
| L21 | `start`, `complete`, `resume`, `close` não exigem que o ator seja o `assignee` nem membro da fila; `assign` aceita qualquer destino em qualquer status. | [requests.service.ts:330-335](../../backend/src/requests/requests.service.ts#L330-L335), [:476-548](../../backend/src/requests/requests.service.ts#L476-L548) |
| ~~L22~~ | **Corrigido.** Solicitante sem `request:update` não conseguia responder a um pedido de informação (`resume` exige a permissão; a tela não oferece outra ação). | [requests.controller.ts:160-165](../../backend/src/requests/requests.controller.ts#L160-L165); [RequestDetailPage.tsx:364-367](../../frontend/src/pages/RequestDetailPage.tsx#L364-L367) |
| L23 | Fracionamento soma todas as requisições do solicitante nos 30 dias, de qualquer categoria, e sempre usa a soma para escolher a faixa. | [requests.service.ts:1276-1290](../../backend/src/requests/requests.service.ts#L1276-L1290) |

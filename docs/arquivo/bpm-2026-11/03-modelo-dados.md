# Modelo de dados e preservação

Este é contrato de modelagem, não migration aplicada. Nomes Prisma são propostos e devem manter `@@map` snake_case. UUID, timestamps UTC e dinheiro `Decimal(19,4)`; quantidades `Decimal(19,6)`. Sem float nos cálculos financeiros. FKs de histórico usam RESTRICT, sem cascade de exclusão de operações.

## Aproveitamento e extensões

| Entidade existente | Mudança decidida |
|---|---|
| `RequestCategory` | Identidade do processo/catálogo; acrescentar `runtimeEnabled`, `currentBpmVersionId?`, `ownerQueueId?`, `configRevision`. Campos antigos preservados para legado. Snapshot BPM prevalece sobre flags mutáveis da categoria |
| `CategoryVersion` | Acrescentar `format` (`legacy`/`axis-bpm/1`), `lifecycle` (`draft/published/retired`), `definition Json?`, `definitionHash?`, `revision`, `validatedHash?`, `validationReport?`, `validatedAt?`, `retiredAt?`; tornar `publishedAt` nullable, mantendo default de now para produtores legados. Novo draft BPM escreve explicitamente publishedAt=null, format BPM e lifecycle draft. Linhas antigas classificadas legacy/published, sem reescrever seu JSON |
| `Queue` | Acrescentar `active`, `revision`, `manager`/members via tabela abaixo; não eleger primeira fila do setor nem criar fila operacional no submit |
| `Request` | Acrescentar `executionMode` default legacy, `currentCycle` default 0, `requesterSectorId?` snapshot, `completedAt?`, `firstResponseAt?`, `reopenDeadlineAt?`, `closureDeadlineAt?`, `currentMaterialRevision` default 0, `criticalImpact?`; manter `lockVersion` único do agregado |
| `RequestNumberCounter` | Reusar transação/contador anual; ano obtido em America/Sao_Paulo, código nunca reutilizado |
| `RequestAttachment` | BYTEA preservado, mais `visibility`, `fieldKey?`, `activityId?`, `withdrawnAt?`, `validationStatus` (`validated`/`rejected`); nunca chamar esse status de antivírus limpo |
| `RequestComment` | Acrescentar `cycle`, `activityId?`, `authorUserId?`; visibilidade e autor filtrados na projeção |
| `RequestApproval`, `SlaClock`, `AuditEvent` | Legado preservado. Aprovação/relógio BPM têm modelo próprio por atividade/ciclo; não escrever resultados BPM nas linhas antigas. AuditEvent recebe referência/resumo de BPM apenas se necessário; RuntimeEvent é timeline operacional autoritativa |
| `Delegation` | Reusar setor/intervalo; acrescentar escopo opcional categoria/processo e revisão em P03, sem alterar semântica dos registros legados |
| `Holiday`, `ApprovalAuthorityRule` | Reusar como fonte de configuração/importação. Publicação BPM copia regras/calendário para snapshot; não consulta matriz mutável a cada decisão |
| `IntegrationOutbox` | Transporte existente permanece. Acrescentar entrega por destinatário em P07, sem quebrar cadastros/satélites antigos |

Não usar defaults inválidos para esconder campos obrigatórios legados: ao criar versão BPM, preencher `formSchema` com projeção compatível do form e `workflowSchema` com objeto marcador BPM, junto das metas de SLA requeridas pelo schema atual. Nenhum consumidor legado pode executar essa versão: catálogo antigo exclui format BPM; Request.executionMode impede comandos. Não passar esse marcador ao resolvedor antigo.

CategoryVersion.version continua número sequencial único por categoria (inclui drafts/legacy). Reservar sob lock da categoria; lacunas são aceitáveis. `currentBpmVersionId` usa relação nomeada distinta de `versions` e FK para versão publicada da MESMA categoria, validada em transação/trigger. Não presumir que o maior número seja publicado. Uma categoria pode manter ponteiros legado e BPM durante piloto; roteamento de nova abertura é explícito.

Defaults de compatibilidade de CategoryVersion: format=legacy, lifecycle=published, publishedAt=now. Caminho BPM sempre fornece os três campos explicitamente. Assim o cadastro/seed legado existente continua criando publicação legada, enquanto draft BPM não é publicado por omissão. Catálogo e latestVersion legados filtram format=legacy/publicação; processos só com versão BPM não aparecem no portal antigo.

## Novas entidades

Campos `createdAt`/IDs omitidos na tabela abaixo continuam obrigatórios em todos os modelos operacionais pertinentes.

| Modelo | Campos e invariantes | Pacote |
|---|---|---|
| `RequestQueueMember` | queueId, collaboratorId, role (`member/manager`), active, startsAt/endsAt; unique(queueId, collaboratorId, role). User ativo ligado obrigatório para atuação; histórico não apaga membro | P01 |
| `ProcessConfigGrant` | categoryId, userId, role (`modeler/publisher/operator/auditor`), expiresAt?, restrictedRead=false; unique(categoryId,userId,role). Permissão RBAC também exigida | P01 |
| `ProcessInstance` | requestId, cycle, categoryVersionId, state (`draft/running/completed/closed/rejected/cancelled/superseded`), startedAt, completedAt?, closedAt?, currentMaterialRevision, lastEventSequence; unique(requestId,cycle). Nada de currentNode único para paralelismo | P01 |
| `ExecutionToken` | instanceId, nodeId, state (`active/waiting/consumed/cancelled`), activationKey, forkId?, branchKey?, parentTokenId?; unique(instanceId,activationKey). Nunca reutilizar token consumido | P01 |
| `ActivityInstance` | instanceId, nodeId, tokenId, activationKey, kind, phase (`triage/execution/...`), state (`available/claimed/waiting/completed/superseded/cancelled`), queueId?, assigneeId?, round, inputRevision, openedAt, claimedAt?, completedAt?, outcome?, resolution?; unique(instanceId,activationKey) | P01 |
| `ActivityCandidate` | activityId, collaboratorId, sourceResolver, principalId?, delegationId?; candidatura titular materializada, delegação efetiva reavaliada em consulta/decisão. unique(activityId,collaboratorId,sourceResolver) | P01/P03 |
| `ActivityAssignment` | activityId, from/to collaborator/queue, byUserId, reason, startedAt, endedAt?; append-only, no máximo uma atribuição aberta | P01 |
| `RequestParticipant` | requestId, cycle, collaboratorId/userId conforme tipo, kind, sourceActivityId?, fieldScope Json, restrictedAllowed, startsAt, endsAt?; CHECK um sujeito válido, vínculo operacional expira ao fechar atividade conforme política | P01 |
| `RequestRuntimeEvent` | requestId, instanceId?, cycle, sequence, type, actorUserId?, actorCollaboratorId?, principalId?, delegationId?, commandId, correlationId, occurredAt, summary Json mínimo, visibility; unique(requestId,sequence). Append-only | P01 |
| `RequestCommandReceipt` | commandId UUID, actorUserId, key, routeScope, requestHash, requestId?, statusCode, resultRef Json, completedAt; unique(actorUserId,key). Resultado guarda referência/metadado seguro, não DTO completo sensível | P01 |
| `RequestRuntimeIncident` | requestId, instanceId, activityId/jobId?, type, state (`open/resolved`), safeDetails, createdAt, resolvedBy?, resolvedAt?, resolution; um incidente aberto por effectKey/tipo | P01 |
| `ApprovalSlot` | activityId, round, principalCollaboratorId, resolverTrace Json, state; unique(activityId,round,principalCollaboratorId) | P03 |
| `ApprovalDecision` | slotId, activityId, round, actorUserId, actorCollaboratorId, principalId, delegationId?, outcome, reason?, materialRevision, snapshotId, decidedAt; unique(slotId) e unique(activityId,round,actorCollaboratorId). Append-only | P03 |
| `RequestMaterialSnapshot` | requestId, cycle, revision, canonicalJson, hash, createdBy, createdAt; unique(requestId,cycle,revision); contém dados materiais/documentos necessários, leitura restrita | P03 |
| `ExecutionFork` / `ExecutionBranch` | fork: instanceId, splitNodeId, joinNodeId, activationKey, parentForkId?, state; branch: forkId, branchKey, arrivedAt?, terminalTokenId?; unique(forkId,branchKey). Cada ativação tem fork distinto | P03 |
| `RequestRuntimeJob` | requestId, instanceId, activityId?, effectKey unique, kind (`service/timer/escalation/closure`), payloadRef, state (`pending/leased/succeeded/failed/cancelled`), dueAt, attempts, leaseUntil?, leaseOwner?, lastErrorCode?, resultRef?; check lease coerente | P04/P05 |
| `BusinessCalendar` / `BusinessCalendarVersion` | identidade + versões; timezone IANA, weekIntervals Json, exceptions Json, revision/hash; snapshot publicado referencia cópia e hash. Intervalos sem sobreposição, pelo menos uma abertura futura | P05 |
| `RequestSlaClock` | requestId, instanceId, activityId?, metric, activationKey, calendarSnapshot Json, budgetSeconds, elapsedSeconds, checkpointAt, originalTargetAt, targetAt?, pausedAt?, stoppedAt?, breachedAt?; unique(instanceId,metric,activationKey) | P01 base/P05 completo |
| `RequestSlaInterval` | clockId, kind (`running/paused`), startAt, endAt?, reason?, actorUserId?; um intervalo aberto por clock; checkpoints não duplicam consumo | P01 base/P05 |
| `RequestSlaSignal` | clockId, thresholdKey, escalationLevel, eventId, emittedAt; unique(clockId,thresholdKey,escalationLevel) | P05 |
| `RequestNotification` | eventId, recipientUserId, channel (`in_app` inicialmente), state/readAt, templateKey, requestId/ activityId, safePayload; unique(eventId,recipientUserId,channel). Consulta revalida acesso | P05 |
| `RequestIntegrationInbox` | source, eventId, bodyHash, envelope Json restrito, status, attempts, errorCode?, nextAttemptAt?, processedAt?; unique(source,eventId). Dedupe gravado com efeito na mesma tx | P07 |
| `RequestIntegrationDelivery` | outboxId, satelliteId, state, attempts, nextAttemptAt, lease*, lastErrorCode?, deliveredAt?; unique(outboxId,satelliteId). Legado e outros produtores compatíveis | P07 |
| `RequestExternalOperation` | requestId, cycle, kind, externalId?, operationVersion, effectKey, state, lastSequence, approvedSnapshotHash?, payloadHash, cancellationState; unique(effectKey), unique(externalSystem,externalId) quando presente | P07 |

`RequestParticipant` não concede poder de decisão por si só: a atividade/slot e a política continuam necessários. `ActivityCandidate` não deve persistir delegação como acesso irrevogável. IDs opcionais de ator preservam execução por sistema sem inventar colaborador “admin”.

Em P01, ao ativar tarefa de fila atualizar Request.queueId/sectorId para a fila atual, e limpar assigneeId até claim; claim/reassign mantém coordenador e atribuição coerentes. Ao concluir, manter fila de execução para close e leitura de gestão. requesterSectorId não é reescrito. Filas de triagem/execução P01 pertencem ao setor do processo; cruzar setores e resumo de coordenação no paralelismo são capacidades P03. Participante de tarefa fechada pode conservar grant de leitura histórica interna quando a política concede, sem poderes de mutação/delegação permanentes; remoção do vínculo/grant elimina esse acesso. Em múltiplas atividades, campos-resumo de fila/assignee nunca substituem Activity/Participant na autorização.

## Compras normalizadas (P04/P07)

| Modelo | Campos centrais |
|---|---|
| `RequestProcurementItem` | requestId, cycle, lineId UUID estável, materialExternalId, materialCode, description/unit snapshot, requestedQty Decimal(19,6), referenceUnitPrice Decimal(19,4)?, catalogFetchedAt, requestedDeliveryDate/local, stockEvidenceRef?; unique(requestId,cycle,lineId) |
| `RequestStockAnalysis` / `RequestStockAnalysisLine` | revision, analyst, warehouseId/code, evidence/ref/time, lineId, requested/reserved/shortage qty; shortage calculada no servidor; análise manual nunca é reserva |
| `RequestQuotation` / `RequestQuotationLine` | quotationId, revision, supplierExternalId? ou fornecedor textual identificado, quoteNumber, validityDate, freight, tax, discount, lines(lineId,qty,unitPrice), attachmentIds; total calculado exato no servidor; linhas vinculadas ao pedido |
| `RequestProcurementProposal` | requestId, cycle, revision, selectedQuotationId/revision, totalCommitment, effectiveAuthorityValue, currency, term/recurrence, materialSnapshotId, selectedBy, selectedAt; unique(requestId,cycle,revision) |
| `RequestAuthorityReservation` | bucketKey, requestId, cycle, commitment, occurredAt, state; bloqueio do bucket serializa cálculo agregado de fracionamento para submits simultâneos |
| `RequestPurchaseOrder` / `RequestPurchaseOrderLine` (P07) | id/código imutável, requestId/cycle, operationVersion, proposalRevision/snapshotHash, supplier identificado, warehouseCode, expectedDate, estado (`prepared/issued/cancellation_pending/cancelled/received`), issuedBy/At; linhas com lineId e material/quantidade/preço/total exatos; unique(requestId,cycle,proposalRevision). Revisão aprovada anterior nunca é sobrescrita |

Preço de catálogo é referência, não custo aprovado. Proposta aprovada guarda total e hash imutáveis. Seleção não altera o orçamento de outra proposta nem preserva aprovação anterior. Não guardar a fonte financeira de verdade só em `formData.procurementQuotation`.

## Índices e restrições a preparar

- Request: `(executionMode,requesterId,createdAt,id)`, `(executionMode,queueId,status,createdAt,id)`, `(executionMode,categoryVersionId,status)`, beneficiário. Busca por código única existente.
- Activity: `(assigneeId,state,openedAt,id)`, `(queueId,state,openedAt,id)`, `(instanceId,state)`. Candidate: `(collaboratorId,activityId)`.
- Participant/grant: sujeito + request/category + validade; não depender só de JSON para filtro de autorização.
- Clock/job: `(state,dueAt)`/`(stoppedAt,targetAt)`, lease, incidentes por estado/processo. Eventos `(requestId,sequence)`; inbox/delivery por estado/próxima tentativa.
- Índice parcial único em atribuição e intervalo SLA abertos; Prisma pode exigir SQL explícito para isso. CHECKs de valores, round≥1, estados e FKs complementam validadores do servidor.
- Número financeiro com escala excedente → 422, não truncar entrada. Rounding de total comercial por linha em 2 casas HALF_UP; guardar montantes de cálculo em 4 casas e quantidade em 6, com regra no snapshot. BRL é a moeda única deste ciclo.
- Snapshot publicado não pode UPDATE de conteúdo/hash; configurar proteção de serviço e trigger com exceções apenas lifecycle/retiredAt. RuntimeEvent/Decision sem endpoints UPDATE/DELETE e proteção de banco para alteração comum. Migração administrativa futura exige caminho separado e auditado.

## Migrations e dados

1. Antes de implementar: inventário read-only de formatos e contagens do ambiente escolhido; detectar versões que já parecem BPM, códigos duplicados, filas e orfandades. Relatar sem corrigir por seed.
2. Criar migrations aditivas por pacote, mantendo migrations locais `20261103000000_cost_center_responsible` e `20261103000001_request_approval_source` intactas. Não editar migration já aplicada nem presumir ordem pelas datas do host. Checar histórico do banco alvo.
3. Backfill somente metadados: linhas atuais = legacy; sem reinterpretar aprovações, prazo, JSON ou anexos. Nova funcionalidade consulta executionMode antes de agir. Trigger de imutabilidade limita-se às versões BPM publicadas.
4. P01 não importa 27 categorias nem demo de aprovação automaticamente. Administrador configura processo simples de teste pela UI; dados sintéticos em testes ficam no banco descartável.
5. Ensaiar migration/restore em banco descartável explícito, separado de `axis`/`axis_logistica`. Não usar `prisma migrate reset`, `db push --accept-data-loss` ou compose do projeto para “testar”, pois o comando atual do backend executa migrate deploy + seed ao subir.
6. Após etapa de projeto, aplicar migrations apenas no ambiente de desenvolvimento/homologação identificado na execução do pacote; dados reais ou ambiente ambíguo exigem esclarecer destino. A presente etapa não autoriza execução.
7. Não migrar instâncias abertas neste ciclo. Exportar/importar definições legadas como rascunho para revisão em P08; sem aprovação automática do conteúdo importado. Reversão é desligar novas aberturas BPM, não excluir tabelas/dados.

## P01: recorte obrigatório do modelo

Implementar somente extensões necessárias de Category/Version/Queue/Request, membresia/grants, Instance/Token/Activity/Candidate/Assignment/Participant/Event/Receipt/Incident e Clock/Interval simples. Não criar tabelas de compras/approval/jobs sem uso. Clock inicial usa snapshot semanal 08h–18h e feriados selecionados na publicação; extensões de pausa/escalonamento/calendário visual entram em P05. Detail já lê relógio novo como fonte única; campos `slaDue*` legados não são usados por BPM.

# Contratos HTTP, comandos e erros

Prefixo existente `/api/v1`; novos endpoints sob `/api/v1/bpm`. Nomes JSON camelCase seguem o código atual. Não migrar os demais módulos para snake_case. JWT e cliente Axios/refresh existentes preservados. IDs são UUID, datas-hora ISO UTC; datas civis `YYYY-MM-DD`; dinheiro/quantidade em strings decimais. Nunca aceitar ator real do body.

## Convenções

- Toda mutação BPM exige `Idempotency-Key` UUID e, salvo createDraft/createProcess, `expectedVersion` inteiro ≥0 do agregado relevante (Request.lockVersion; CategoryVersion.revision; RequestCategory.configRevision; Queue.revision).
- GET devolve `ETag: "<version>"`; neste ciclo, body `expectedVersion` é o mecanismo normativo de escrita. Se cliente também envia If-Match, ambos devem coincidir, senão 400. Não implementar dois caminhos diferentes de concorrência.
- Recibo único por `(actorUserId,key)`, hash canônico de método + rota + payload, incluindo expectedVersion. Mesma chave e corpo reproduz resultado aplicado sem repetir efeito; corpo/rota diferente → 409 `IDEMPOTENCY_KEY_REUSED`. Duas chamadas concorrentes esperam a primeira transação; se timeout, 409 `COMMAND_IN_PROGRESS`, mantendo a chave para retry.
- Replay revalida acesso atual antes de devolver resultado. O recibo conserva `commandId`, `appliedVersion`, IDs de resultado/evento e status original; resposta pode incluir projeção atual em `resource` e `currentVersion`, sem afirmar que ela é o estado histórico. Se acesso foi revogado: 404/403, sem DTO antigo. Recibos de comandos críticos não expiram neste ciclo; limpeza futura exige política explícita.
- Estado/versão mudou: 409 `VERSION_CONFLICT` com currentVersion apenas se ator pode ler. Recarregar antes de reexecutar; não fazer overwrite automático. Falta de expectedVersion/key → 400 `COMMAND_METADATA_REQUIRED`.
- Listas: `{items,nextCursor}`; cursor opaco sobre `(createdAt,id)` ou `(openedAt,id)` com filtros/sort vinculados; limit default 25, máximo 100; filtros tipados, unknown → 400. Sem `includeAll` ou acesso global por query.
- `allowedActions: [{code,label,activityId?,requiresReason?,payloadSchema?}]` é filtrado por ator. Campos retornam modo/validação e valores legíveis. O servidor revalida comando mesmo que ação tenha sido listada.
- `GET /bpm/capabilities` lista recursos realmente habilitados, limites e permissões atuais. Recurso não entregue é omitido da UI, não simulado.

## Administração e catálogo

| Método e caminho (após `/bpm`) | Entrada | Resultado / regra | Pacote |
|---|---|---|---|
| GET `/capabilities` | — | formatos/nós/handlers disponíveis e ações de configuração permitidas | P01 |
| GET `/catalog` | q, sectorId, cursor, limit | Categorias BPM habilitadas que ator pode abrir; só versões publicadas, descrição/requisitos | P01 |
| GET `/processes` | filtros e paginação | Configurações no escopo dos grants e RBAC; não lista instâncias | P01 |
| POST `/processes` | code, name, description, sectorId, ownerQueueId, publisherUserIds | Categoria de teste desabilitada e versão 1 draft; criador recebe modeler; publicadores precisam permissão atual. Código global único; filas de cada nó ficam no definition | P01 |
| GET `/processes/:id` | — | Metadados, ponteiro atual e versões acessíveis | P01 |
| POST `/processes/:id/versions` | expectedVersion da categoria, cloneVersionId? | Novo draft copiado ou vazio, sob lock categoria | P01 |
| GET `/versions/:id` | — | Snapshot editável/imutável, revision/hash, report, allowedActions | P01 |
| PATCH `/versions/:id` | expectedVersion, definition | Salva draft, invalida validação/hash anterior; schema estrutural imediato | P01 |
| POST `/versions/:id/validate` | expectedVersion | Relatório tipado + validatedHash sobre conteúdo exato; sem publicar | P01 |
| POST `/versions/:id/simulate` | expectedVersion, scenario | Trilha sem efeitos/dados operacionais, erros/resoluções com projeção segura | P06 |
| POST `/versions/:id/publish` | expectedVersion, expectedCategoryVersion, validatedHash, acknowledgeEmptyHierarchy? | Tx valida novamente, publica imutável e aponta versão; concorrente perde com 409 | P01/P03 regra extra |
| POST `/versions/:id/retire` | expectedVersion, reason | Impede novas aberturas nessa versão; não muda instâncias. Descontinuar atual remove ponteiro; não elege versão anterior implicitamente | P06 |
| POST `/processes/:id/enable` ou `/disable` | expectedVersion, reason | Habilita catálogo interno no piloto/novas aberturas; exige versão publicada e configuração íntegra | P01 |
| GET `/queues` | sectorId | Somente filas legíveis para configurar/atuar, com membros mínimos | P01 |
| POST `/queues`; PATCH `/queues/:id` | name,sectorId,members,managers, expectedVersion no PATCH | Gerência de fila BPM; setor existente; sem alterar cadastro mestre de setor | P01 |
| GET/PATCH `/processes/:id/grants` | grants, expectedVersion da categoria | Configuração e escopo; não autoelevar acesso a registros restritos | P01 |
| GET `/sources/:key` | q,cursor,limit,selectedIds? | Select seguro por fonte cadastrada; nunca URL arbitrária | P01; material P04 |
| GET `/configuration/candidates` | purpose=queueMember/publisher/modeler,sectorId?,q,cursor,limit | Somente configurador autorizado; retorna id/nome e elegibilidade mínima (User.id e Collaborator.id diferenciados), sem dados pessoais sensíveis ou diretório inteiro | P01 |

Publicar e habilitar são ações distintas: publicar congela conteúdo; habilitar permite novas aberturas. Simulação completa vem em P06; P01 já tem validação estrutural e prévia de formulário executável, sem chamar isso de simulador do motor.

## Requisições e atividades

| Método/caminho | Payload específico além de metadados | Comportamento |
|---|---|---|
| POST `/requests` | categoryId, versionId, title?, description?, beneficiaryId?, representationReason?, priority?, criticalImpact?, fields?, projectId?, costCenterId?, estimatedValue? | Rascunho parcial; autor da sessão; versão exatamente publicada escolhida. Beneficiário diferente exige `request:represent` e política allowRepresentation |
| GET `/requests` | scope=mine/queue/participating, status,categoryId,queueId,q,cursor,limit | Projeção segura, paginação antes de DTO, sem formulário inteiro na lista |
| GET `/requests/:id` | — | Request + ciclo + tarefas legíveis + formulário contextual + prazos + allowedActions |
| PATCH `/requests/:id/draft` | patch de dados/fields editáveis | Save parcial; invariante tipada, sem required prematuro |
| POST `/requests/:id/submit` | — | Envio atômico, cria atividades/relógios/timeline |
| GET `/activities` | scope=assigned/candidate/delegated,processId,phase,due,cursor,limit | Inbox unificada; dedupe por activityId/slotId; delegação reavaliada |
| GET `/activities/:id` | — | Contexto/formulário/ações da atividade e versão Request atual |
| POST `/activities/:id/claim` ou `/release` | reason? | Exclusividade, claim concorrente gera 409 |
| POST `/activities/:id/complete` | fields?,resolution,evidenceAttachmentIds? | Campos da etapa, validados no servidor; avança grafo e pode concluir |
| POST `/activities/:id/return` | reason,editableFieldKeys | Apenas se nó aceita correção; lista deve ser subconjunto da política |
| PATCH `/activities/:id/correction` | fields/commonFields permitidos | Salva correção sem avançar |
| POST `/activities/:id/resubmit` | — | Valida e abre nova rodada |
| POST `/activities/:id/decision` | slotId,round,materialRevision,snapshotHash,decision=approve/reject/return,reason? | Quórum/delegação; não usa endpoint genérico de complete |
| POST `/activities/:id/question` | question,requestedFieldKeys?,dueAt? | Cria resposta do autor, congela execução retomável |
| POST `/activities/:id/respond` | answer,attachmentIds? | Retoma tarefa certa; não exige `request:update` do autor |
| POST `/activities/:id/reassign` | assigneeId ou queueId,reason | Gestor e destino elegíveis |
| POST `/requests/:id/accept` | deliveryRevision | Aceite ligado ao ciclo/entrega |
| POST `/requests/:id/close` | reason? | Concluída, aceite cumprido, efeitos resolvidos |
| POST `/requests/:id/reopen` | reason | Dentro da janela, cria ciclo; fora → 422 REOPEN_WINDOW_EXPIRED e ação createRelatedDraft |
| POST `/requests/:id/related-draft` | reason | Novo draft atual relacionado; resposta com novo ID |
| POST `/requests/:id/recategorize` | targetCategoryId,targetVersionId,fieldMapping,reason | Prévia/validação sem perda; troca atômica de ciclo/roteamento |
| POST `/requests/:id/cancel` | reason,impactAcknowledgement? | Pode retornar resultado `cancellation_pending`, sem afirmar cancelada até compensar |
| POST `/requests/:id/comments` | body,visibility=publico/interno | Mesmo acesso de registro, nota interna exige equipe |
| POST `/requests/:id/attachments` | filename,contentBase64,fieldKey?,replacesAttachmentId? | Reusa BYTEA e política real; 25MB/100MB; não tem falso scan |
| GET `/requests/:id/attachments/:attachmentId` | — | Binário autenticado, Content-Disposition seguro, Cache-Control private/no-store |
| GET `/requests/:id/timeline` | cursor,limit | Eventos mascarados por campo/visibilidade |
| GET `/incidents` | categoryId,state,cursor,limit | Operadores no escopo; detalhes seguros |
| POST `/incidents/:id/resolve` | strategy,reason,resolverOverride? | Estratégias registradas, versão Request; não aceita SQL/JSON de estado livre |

Payloads ausentes da capability do pacote retornam 404 de rota ou 422 `UNSUPPORTED_CAPABILITY`, nunca success vazio. P01 expõe somente draft/submit, atividades simples claim/release/complete/reassign, close/cancel sem efeitos, comentários/anexos/timeline e incidentes de responsável.

## DTO de definição mínimo (P01)

```json
{
  "format": "axis-bpm/1",
  "capabilities": ["human_tasks"],
  "nodes": [
    {"id":"start","type":"start"},
    {"id":"triage","type":"human","phase":"triage","label":"Conferir solicitação","resolver":{"type":"queueMembers","queueId":"<queue-uuid>"},"requiresResolution":true,"formAccess":{"details":"read"}},
    {"id":"execute","type":"human","phase":"execution","label":"Atender solicitação","resolver":{"type":"queueMembers","queueId":"<queue-uuid>"},"requiresResolution":true,"formAccess":{"details":"read"}},
    {"id":"done","type":"end","terminalOutcome":"completed"}
  ],
  "edges": [
    {"id":"e1","from":"start","to":"triage","outcome":"complete"},
    {"id":"e2","from":"triage","to":"execute","outcome":"complete"},
    {"id":"e3","from":"execute","to":"done","outcome":"complete"}
  ],
  "form": {"sections":[{"id":"main","title":"Solicitação","fields":[{"key":"details","label":"O que você precisa?","type":"textarea","maxLength":4000,"requiredOn":["submit"]}]}]},
  "policy": {"confidentiality":"interna","requiresAcceptance":false,"allowRepresentation":false,"beneficiaryCanRead":true,"executorMayBeRequester":false,"closure":{"mode":"manual"},"reopenBusinessDays":5},
  "calendar": {"timezone":"America/Sao_Paulo","weekIntervals":{"1":[["08:00","18:00"]],"2":[["08:00","18:00"]],"3":[["08:00","18:00"]],"4":[["08:00","18:00"]],"5":[["08:00","18:00"]]},"exceptions":[]},
  "sla": {"firstResponseMinutes":240,"resolutionMinutes":2880}
}
```

`<queue-uuid>` é placeholder documental, nunca fixture operacional fixa. P01 tem assistente visual para criar esse grafo a partir de filas escolhidas; não requer usuário escrever JSON. P01 fixa política interna/manual e o expediente acima na UI, exibindo claramente; metas em minutos configuráveis. Publicação copia feriados selecionados, sem alteração retroativa. Versões com acceptance/reopen/correção ainda não suportadas não são publicáveis como capabilities ativas; `reopenBusinessDays` apenas parâmetro reservado até P05. `returnPolicy` de approval em P03 é configuração de comando de correção (restartNodeId/editableFieldKeys), não aresta de retorno no DAG.

### Validação exata do subconjunto de formulário P01

Todo campo tem `key` no padrão `[a-z][a-z0-9_]{0,63}`, label de 1–120 caracteres, type conhecido e requiredOn (vazio ou `["submit"]` em P01). Chaves são únicas no form. P01 permite até 200 campos; builder limita e API recusa acima disso. Properties não suportadas são erro estrutural; não ignorar configuração desconhecida.

| type | Valor JSON | Configuração / validação |
|---|---|---|
| text | string | minLength default0/maxLength default255, máximo4.000; trim para teste de presença, texto preservado sem HTML |
| textarea | string | maxLength default4.000, máximo20.000; sem rich text neste ciclo |
| integer | number inteiro seguro | min/max opcionais dentro de Number.MIN_SAFE_INTEGER/MAX_SAFE_INTEGER; rejeitar string/NaN/fração |
| decimal | string decimal sem máscara | Formato opcionalmente negativo, dígitos e ponto com até4 casas; máximo15 dígitos inteiros e4 fracionários após remover zeros iniciais, min/max em string; normalizado em4 casas; nunca converter para Number |
| date | string YYYY-MM-DD | Data civil existente, minDate/maxDate opcionais; sem conversão automática de fuso |
| select | string ID de opção | `options:[{id,label}]` OU `source:{key}`; id único, fonte permitida/referência elegível; uma seleção |
| boolean | boolean | false é presente; `mustBeTrue` opcional para declaração; string “false” é inválida |
| attachment | array de UUIDs | minItems/maxItems, default max10; IDs do mesmo Request, validados e legíveis para a atividade; required exige pelo menos1 |

Dados comuns têm suas próprias constraints de DTO; não duplicá-los em fields. Decimal não financeiro pode ser negativo se min não impedir; estimatedValue financeiro é não negativo. Cálculos usam Prisma.Decimal disponível no projeto. Regras de formAccess P01 são mapa por key com `hidden/read/write`; obrigatório de abertura não concede write à execução. Quando não especificado: autor escreve no draft; triagem/execução lê campos de abertura; valor oculto jamais sai no DTO. Campos comuns de autoria/status/financeiro gerado são sempre de controle do servidor.

Metas P01 são inteiros de 1 a 120.000 minutos, e publicação verifica que o calendário consegue atingir ambas dentro do horizonte de cálculo. Campo/commonField excedendo tamanho máximo/escala ou com tipo/data inválida é rejeitado também no draft. Obrigatoriedade e comprimento mínimo de título/descrição/texto só são exigidos no submit ou complete correspondente; isso permite autosave enquanto o usuário ainda digita um título curto. Campo numérico opcional presente continua sujeito a min/max de domínio.

## Exemplo de comando e resposta

```http
POST /api/v1/bpm/activities/<uuid>/complete
Authorization: Bearer <token>
Idempotency-Key: <uuid>
Content-Type: application/json

{"expectedVersion":3,"resolution":"Acesso conferido e atendimento registrado.","fields":{}}
```

```json
{
  "commandId":"<uuid>",
  "replayed":false,
  "appliedVersion":4,
  "currentVersion":4,
  "resource":{"id":"<request-uuid>","code":"REQ-2026-000001","status":"concluida","cycle":1,"version":4,"allowedActions":[{"code":"close","label":"Encerrar"}]}
}
```

No replay, `appliedVersion` permanece 4; `currentVersion` pode ser maior. Antes de salvar/enviar novamente, a tela lê o detalhe atual.

## Erros

Formato BPM local, sem alterar filtro global dos outros módulos:

```json
{"status":422,"code":"VALIDATION_ERROR","title":"Revise os dados da atividade.","correlationId":"<uuid>","errors":[{"path":"fields.details","code":"required","message":"Informe o que você precisa."}]}
```

| HTTP | Códigos mínimos | UI / efeito |
|---|---|---|
| 400 | INVALID_JSON, COMMAND_METADATA_REQUIRED, INVALID_FILTER | Corrigir sintaxe; zero escrita |
| 401 | UNAUTHENTICATED | Cliente existente tenta refresh uma vez; chave/body preservados |
| 403 | ACTION_FORBIDDEN, FIELD_SCOPE_FORBIDDEN | Só quando registro é legível; atualizar ações e preservar formulário |
| 404 | NOT_FOUND | Ausente/oculto indistinguíveis; não revelar proprietário |
| 409 | VERSION_CONFLICT, ACTIVITY_CLOSED, ALREADY_CLAIMED, IDEMPOTENCY_KEY_REUSED, WRONG_EXECUTOR, DEFINITION_CHANGED | Oferecer recarregar, sem repetir com versão nova automaticamente |
| 422 | VALIDATION_ERROR, INVALID_TRANSITION, APPROVAL_SNAPSHOT_CHANGED, MISSING_APPROVER, MISSING_AUTHORITY_RULE, DEPENDENCY_PENDING, UNSUPPORTED_CAPABILITY, REOPEN_WINDOW_EXPIRED | Erro de negócio localizado; não aplicar parcialmente |
| 413 | ATTACHMENT_TOO_LARGE | Preservar campos, selecionar arquivo menor |
| 429 | RATE_LIMITED | Mensagem e retry após intervalo; sem trocar chave |
| 503 | SOURCE_UNAVAILABLE, INTEGRATION_UNAVAILABLE | Seleção/envio externo indisponível; draft continua salvo |

Se comando válido avança e encontra configuração operacional quebrada, persiste atividade/incident e retorna `200` com `blockedByIncident`, sem dizer que processo avançou com sucesso comercial. Se pré-condição da própria ação falha (dados inválidos/versão/ator), erro sem escrita. Não misturar incidente persistido com 422 que sugira rollback completo.

## Permissões e provisionamento

Reusar `request:create/read/update/assign/approve/comment`, `request_category:read/create` e acrescentar `request_process:model/publish/operate/audit`, `request_queue:manage`, `request:represent` e `request:export` quando usados. Ler permissões atuais no BPM, sem depender de nome `admin`/`analista_suprimentos`. Recurso inexistente em pacote não requer permissão provisionada antecipadamente.

Migration de P01 cadastra apenas os códigos de permissão novos idempotentemente, sem conceder a todos os papéis. Administrador que já possui permissão de gerenciar papéis usa a tela local `RolesPage` para concedê-los aos usuários de homologação; não reescrever essa tela nem remover mudanças locais. Criação de processo demanda model + request_category:create; autor recebe grant modeler. Publicar exige publish + grant publisher; em P01 a mesma pessoa pode ter ambos (não há separação obrigatória de duas pessoas). Concessão de grants exige model + grant modeler/owner; só pode conceder papel que destinatário já tenha em RBAC, sem autoelevação de permissões. Configuração inicial deve ser demonstrada no roteiro de P01.

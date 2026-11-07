# Requisições — regras normativas do motor de processos

> **Propósito:** consolidar as regras que a reescrita do motor de processos de Requisições deve obedecer, com IDs estáveis (`RM-<área>-NN`) para referência em código, testes e revisões.
> **Data:** 2026-11-07. O motor BPM P01–P04 foi removido em 2026-11-02 (commit `98dfce5`); o código antigo está no checkpoint `629044d`.
> **Fontes:** [02-regras-autorizacao.md](../arquivo/bpm-2026-11/02-regras-autorizacao.md) (R01–R07), [06-sla-logistica.md](../arquivo/bpm-2026-11/06-sla-logistica.md), [01-arquitetura.md](../arquivo/bpm-2026-11/01-arquitetura.md), [planejamento §6.2](../arquivo/planejamento-requisicoes-bpm-2026-11-01.md). Decisões de negócio em [decisoes-negocio.md](decisoes-negocio.md); estado atual em [requisicoes-estado-atual.md](requisicoes-estado-atual.md).

**Como ler.** "Deve"/"não deve" são obrigatórios. Cada regra cita a origem entre colchetes (`[02 R04]`, `[06 SLA]`, `[01 Exec]`, `[Plan 6.2]`). Uma regra só pode ser mudada por decisão registrada; IDs nunca são reaproveitados — regra revogada fica marcada como tal.

---

## 1. Arquitetura (RM-ARQ)

| ID | Regra | Origem |
|---|---|---|
| RM-ARQ-01 | O motor é um interpretador determinístico de grafo declarativo (`axis-bpm/1` ou sucessor), executado no NestJS do Core e persistido no mesmo PostgreSQL. Nenhum serviço de workflow, Redis ou broker é requisito do núcleo. | [01 ADR-001] |
| RM-ARQ-02 | `Request` continua a identidade comercial (código, dados comuns); `RequestCategory` a identidade do catálogo; `CategoryVersion` guarda o snapshot completo da definição. Não criar tabelas paralelas para os mesmos conceitos. | [01 Fronteiras] |
| RM-ARQ-03 | O motor conhece apenas `handlerKey` registrados; nunca código ou nome de categoria. Lógica de domínio (compras, logística) fica em módulos de domínio que registram handlers. | [01 Fronteiras], [02 R03] |
| RM-ARQ-04 | Processo publicado é imutável. Nova publicação afeta só novas instâncias; migração de instância aberta exige plano explícito, validação e auditoria. | [Plan 6.2 #3], [01 Substituição] |
| RM-ARQ-05 | O snapshot inclui toda regra hoje guardada na categoria mutável: `requiresAcceptance`, confidencialidade, modo de alçada, política, calendário, SLA, autoridade, handlers. Mudança na categoria não altera instância em curso. | [Plan 6.2 #4], [01 Contrato] |
| RM-ARQ-06 | O snapshot contém `format`, `capabilities`, `nodes`, `edges`, `form`, `policy`, `calendar`, `sla`, `authority`, `handlers`, `tests`. IDs de nós/campos/arestas são estáveis dentro da versão. Layout do editor (`editorLayout`) não influencia execução. | [01 Contrato] |
| RM-ARQ-07 | Publicação rejeita capacidades que o backend não suporta. Nós fechados: `start`, `human`, `end`, `approval`, `exclusive`, `parallelSplit`/`parallelJoin`, `service`, `timer`, `acceptance`. | [01 Contrato], [Plan 6.2 #7] |
| RM-ARQ-08 | Um registro tem um único executor. Comando de um motor sobre registro de outro responde `409 WRONG_EXECUTOR`; jobs de um motor excluem explicitamente registros do outro. | [01 Substituição] |
| RM-ARQ-09 | Não alterar login, refresh, JWT, papéis globais ou cadastros para acomodar um processo. A política local lê o estado atual de `User`, `RolePermission` e `Collaborator` a cada comando (claims do JWT podem estar desatualizados). | [01 Fronteiras] |
| RM-ARQ-10 | Organização única: não inventar `companyId`/`unitId` livres no JSON nem prometer isolamento multiempresa. | [01 Fronteiras] |
| RM-ARQ-11 | Reversão desabilita novas aberturas da versão defeituosa, preserva instâncias e efeitos externos; nunca restaura banco por cima de compras/entregas feitas. | [01 Substituição] |

## 2. Grafo, validação e limites (RM-GRF)

| ID | Regra | Origem |
|---|---|---|
| RM-GRF-01 | Limites v1: 100 nós, 200 arestas, 200 campos, 200 linhas por tabela de formulário, 20 ramos paralelos, 100 slots de aprovação por atividade, 64 níveis de hierarquia, 50 transições automáticas por comando. Limites são validados e documentados, nunca truncados silenciosamente. | [01 Limites] |
| RM-GRF-02 | Grafo acíclico dentro de um ciclo; fork/join estruturados com aninhamento máximo 3. Devolução e reabertura são comandos que abrem novas rodadas/ciclos, não arestas de retorno. | [01 Limites] |
| RM-GRF-03 | Fora do escopo v1: gateway inclusivo, eventos de borda, multi-instância dinâmica, subprocesso recursivo, scripts, HTTP arbitrário, execução por e-mail, migração de instância aberta. | [01 Limites] |
| RM-GRF-04 | O validador prova: um `start`; exatamente um `end` de sucesso; `end` reprovados opcionais; todos os nós alcançáveis; nenhum nó sem saída exceto `end`; IDs únicos; todo caminho normal chega a um `end`; resolutores compatíveis; condições e bindings tipados; joins correspondem a splits e nenhum ramo escapa da barreira; todo `approval` tem destinos e `returnPolicy`; regras financeiras sem lacuna nem sobreposição. O resultado lista erros por nó/campo/aresta. | [01 Limites] |
| RM-GRF-05 | `returnPolicy` define `restartNodeId` anterior válido no mesmo bloco e os campos corrigíveis; devolução/rejeição em paralelo afeta o ciclo inteiro (cancela ramos sem efeito, retém barreira de compensação para efeitos confirmados). | [01 Limites] |
| RM-GRF-06 | `parallelSplit` cria TODOS os ramos; `parallelJoin` aguarda todos pela correlação do fork. `exclusive` avalia condições ordenadas, primeira verdadeira vence, saída default obrigatória. | [01 Contrato] |
| RM-GRF-07 | Se a UI usar notação BPMN, declara o subconjunto suportado e recusa elementos sem semântica; importação/exportação ampla fica fora. | [Plan 6.2 #9], [01 ADR-001] |

## 3. Condições e formulários (RM-CND / RM-FRM)

| ID | Regra | Origem |
|---|---|---|
| RM-CND-01 | Condições são AST: operadores `and`, `or`, `not`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `exists`; operandos `{path}` e `{literal}`. | [01 Condições] |
| RM-CND-02 | Caminhos permitidos: `request.*`, `fields.<key>`, `procurement.*`, `context.*` (fornecido pelo servidor). Proibidos: JS, `eval`, SQL, regex livre, funções, acesso a ambiente. | [01 Condições], [Plan 6.2 #6] |
| RM-CND-03 | Profundidade máxima 10 e 100 operações por expressão; tipo incorreto é erro de validação/publicação. Valor ausente não equivale a zero; só `exists` o aceita sem erro. | [01 Condições] |
| RM-CND-04 | Uso de campo oculto numa condição não devolve seu valor ao cliente. | [01 Condições] |
| RM-FRM-01 | O mesmo snapshot tipado alimenta validação no servidor e apresentação no React. Validação do navegador nunca é confiável. | [01 Condições] |
| RM-FRM-02 | Fontes de dados são registradas por chave (`projects`, `cost_centers`, `collaborators`, `clients`, `job_titles`, depois `logistics.materials`); o servidor filtra projeção e permissão. Fonte ausente fica indisponível e impede o envio quando obrigatória. | [01 Condições] |
| RM-FRM-03 | Campos têm `hidden`/`read`/`write`/`required` por nó e vínculo. Oculto não é enviado; `read` não aceita patch; campo material não é editável fora de correção formal. Chave desconhecida ou não liberada → `422 FIELD_NOT_WRITABLE`, sem aplicar o restante do patch. | [02 R05] |
| RM-FRM-04 | Patch aplica merge sobre os dados persistidos: chaves omitidas (em especial `hidden`/`read`) são preservadas; remoção é explícita e autorizada. | Lição P01 (E02), [evidência](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-5/REVISAO.md) |
| RM-FRM-05 | Nunca aceitar do cliente campos de domínio calculados pelo servidor (análise, cotação, totais, status, `requesterId`, `executionMode`, `assigneeId`, `lockVersion`). | [02 cabeçalho], [06 Segurança] |

## 4. Execução transacional e concorrência (RM-CMD)

| ID | Regra | Origem |
|---|---|---|
| RM-CMD-01 | Ordem de todo comando: (1) autenticar e resolver permissões atuais e escopo, com preflight de autorização antes de qualquer replay; (2) abrir transação curta, consultar recibo idempotente, `SELECT ... FOR UPDATE` na linha `Request`, reler versão/acesso/estado dentro da transação; (3) comparar `expectedVersion`, validar, gravar e consumir token; (4) avançar nós automáticos até aguardar humano/job/timer/fim, respeitando o limite; (5) atualizar resumo de `Request`, incrementar `lockVersion` uma vez, gravar eventos com sequência, outbox e recibo na MESMA transação; (6) commit e DTO filtrado. | [01 Exec] |
| RM-CMD-02 | Mudança de estado, decisão, evento e outbox são confirmados na mesma transação; qualquer erro desfaz tudo. Nada de HTTP, scanner ou e-mail com o lock aberto. | [01 Exec], [Plan 6.2 #2] |
| RM-CMD-03 | Todo comando tem chave de idempotência (header UUID). O hash do recibo inclui método, rota, IDs de recurso (request, activity) e payload canônico; mesma chave com corpo diferente → `409`. A mesma composição é usada para consultar e gravar o recibo. | [Plan 6.2 #2], lições P01 (C03, S08) |
| RM-CMD-04 | `lockVersion` de `Request` é a única versão de concorrência da instância; não criar segundo contador em `ProcessInstance`. Colisão de versão esperada → `409`, sem retry automático com dados novos. | [01 Estado], [01 Exec] |
| RM-CMD-05 | Todos os escritores (comentário, anexo, worker, aprovação, SLA, cancelamento, reabertura) bloqueiam `Request` antes dos filhos; com mais de um `Request`, em ordem lexical de ID. Deadlock: até três tentativas internas com jitter. | [01 Exec] |
| RM-CMD-06 | Workers selecionam jobs com `FOR UPDATE SKIP LOCKED`, apenas na seleção de fila; nunca em consultas de negócio. Job tem estado, lease/owner, tentativa e próxima data; retoma após restart; chave de efeito impede duplicidade. | [01 Exec] |
| RM-CMD-07 | Falha automática vira incidente tratável, nunca aprovação/conclusão fictícia. Reprocessamento reusa o efeito e exige autorização. | [01 Exec] |
| RM-CMD-08 | `Request.status` é projeção persistida, não API de escrita. Proibido `PATCH` livre de `status`, `requesterId`, `executionMode`, `assigneeId`, `lockVersion`. | [02 cabeçalho], [01 Estado] |
| RM-CMD-09 | Replay de criação consulta o recibo sem exigir que a versão usada originalmente ainda seja a publicada vigente. | Lição P01, [revisão contratos](../arquivo/bpm-2026-11/evidencias/P01/revisao-contratos/REVISAO.md) |

## 5. Ciclo de vida e estados (RM-EST)

| ID | Regra | Origem |
|---|---|---|
| RM-EST-01 | Comandos mínimos: `createDraft`, `saveDraft`, `submit`, `claim`, `release`, `completeActivity`, `returnForCorrection`, `saveCorrection`/`resubmit`, `decideApproval`, `requestInformation`, `respondInformation`, `waitThirdParty`/`resumeThirdParty`, `reassign`, `completeProcess`, `acceptDelivery`, `close`, `reopen`, `createRelatedDraft`, `recategorize`, `cancel`, `resolveIncident`. Pré-condições e destinos conforme a tabela R01 da fonte. | [02 R01] |
| RM-EST-02 | Não manter estados sem saída. `planejada`, `suspensa`, `expirada` não têm comando no primeiro ciclo e a publicação que os exija é recusada; `reaberta` é evento, não estado. | [02 R01] |
| RM-EST-03 | Rascunho não cria atividade nem SLA; `submit` cria o ciclo 1, a instância e a primeira atividade atomicamente. | [02 R01] |
| RM-EST-04 | Devolução não é reprovação; abre tarefa de correção com campos liberados; `resubmit` valida o formulário inteiro e abre nova rodada. | [02 R01] |
| RM-EST-05 | Cancelamento em `concluida`/`encerrada` é inválido (usar reabertura/registro relacionado). Autor cancela antes de execução/efeito; depois, só gestor da fila, com motivo; com efeito externo, abre pedido de cancelamento com compensação; `cancelada` só sem impacto pendente. | [02 R01], [08 B04] |
| RM-EST-06 | Reabertura dentro da janela cria novo ciclo a partir do ponto de reentrada publicado (`enviada`), sem reutilizar decisões, aceite ou SLA; fora da janela ou de `reprovada`, cria rascunho relacionado (`origina`) sem reenvio automático. | [02 R01], [06 SLA] |
| RM-EST-07 | Encerrar por falta de resposta do solicitante não é automático: fim do prazo retoma a contagem e notifica o gestor, preservando a pendência. | [02 R01], [06 SLA] |
| RM-EST-08 | Recategorização só na triagem, antes de aprovação/efeito, com motivo e mapa explícito de campos; cria ciclo da definição nova na mesma `Request`; setor, fila e participantes mudam na mesma transação; SLA mantém consumo desde o primeiro envio. | [02 R07] |
| RM-EST-09 | Projeção de status em paralelismo, em ordem: incidente bloqueante (badge separado, status conserva a fase); terminal do ciclo; execução disponível/em curso → `em_atendimento`; aprovação ativa → `aguardando_aprovacao`; triagem disponível → `enviada`, assumida → `em_triagem`; só correções → `devolvida_ajuste`; só respostas → `aguardando_solicitante`; só terceiro → `aguardando_terceiro`; acceptance/end → `concluida`. | [02 R02] |
| RM-EST-10 | Invariante: instância ativa sempre tem token, tarefa, job, timer ou incidente explicando a espera. | [02 R02] |
| RM-EST-11 | `completedAt` é gravado explicitamente em `completeProcess`; nada usa `updatedAt` como conclusão. | [02 R01], [06 SLA] |
| RM-EST-12 | Prioridade crítica exige impacto/justificativa; gestor altera com motivo; auditoria mantém prioridade solicitada, calculada e efetiva; alteração não muda meta retroativamente. | [02 R07] |
| RM-EST-13 | Relações não admitem autociclo nem ciclo de dependência. Filha `concluida`/`encerrada` satisfaz barreira; `cancelada`/`reprovada` exige dispensa motivada do gestor do pai. Leitor do pai sem acesso à filha vê só "dependência pendente". | [02 R07] |

## 6. Responsáveis e conflitos (RM-AUT)

| ID | Regra | Origem |
|---|---|---|
| RM-AUT-01 | Resolutores registrados: `queueMembers(queueId)`, `explicitCollaborators(ids)`, `requester`, `directManager(subject)`, `managementLevels(subject, levels)`, `costCenterResponsible`, `roleInSector(roleId, sectorId)`. Cada nó declara tipo, escopo, fallback e comportamento quando vazio. Proibido string de papel fixa no código. | [02 R03], [Plan 6.2 #5] |
| RM-AUT-02 | Pessoas operacionais usam `Collaborator.id`; segurança usa `User.id` ativo vinculado. Sem usuário ativo vinculado não há candidato executável. | [02 R03] |
| RM-AUT-03 | Fila tem membros e gestores explícitos. Pertencer ao setor ou ter `request:update` não torna alguém membro de fila. Configuração incompleta gera incidente. | [02 R03] |
| RM-AUT-04 | Hierarquia é lida ao ativar a tarefa, com trilha de resolução; decisões preservam os IDs resolvidos. Ao decidir, revalidar atividade, conta ativa, conflito e delegação. | [02 R03] |
| RM-AUT-05 | Ciclo ou limite na hierarquia → incidente `INVALID_HIERARCHY`. Ciclo, usuário desligado ou consulta falha nunca valem como topo válido. | [02 R03] |
| RM-AUT-06 | Triador, aprovador e delegado nunca são solicitante/beneficiário. Executor só pode ser o autor se a política do processo permitir (default: não). Conflitos explícitos prevalecem sobre papel, admin e delegação. | [02 R03] |
| RM-AUT-07 | Responsável de centro de custo igual ao autor/beneficiário: procurar gestor independente acima, registrando o salto; sem substituto → incidente. A exceção de cadeia vazia (RM-AUT-09) não se aplica a centro de custo obrigatório. | [02 R03] |
| RM-AUT-08 | Denúncia: envolvidos e toda a cadeia superior ficam excluídos de triagem, aprovação e gestão; a configuração exige grupo independente; publicação do template bloqueada até homologação própria. | [02 R03], [08 B05] |
| RM-AUT-09 | **Exceção U04.** Em `directManager`/`managementLevels`, níveis inexistentes são pulados. `onEmptyHierarchy: "skip_with_audit"` é explícito no snapshot: se a cadeia alcança topo válido sem candidato, registrar `approval.skipped_empty_hierarchy` com motivo e avançar; a UI mostra aviso permanente no histórico; o editor exige ciência ao publicar e não inventa aprovador. Novos processos podem escolher `onEmptyHierarchy: "incident"`. | [02 R03], [08 U04] |
| RM-AUT-10 | Matriz sem faixa, fila vazia, lista de IDs inválida e responsável obrigatório ausente SEMPRE são incidentes, nunca a exceção U04. Não autoaprovar falha de matriz. | [02 R03], [06 Compras] |
| RM-AUT-11 | Fila publicada sem membro elegível é erro de publicação; se depois todos ficarem indisponíveis, o comando cria incidente `NO_ELIGIBLE_ASSIGNEE`, mantém token e fase, não pula tarefa nem aprova. Gestor corrige e "resolve responsáveis" com motivo, sem duplicar tarefa. | [P01 pacote] |

## 7. Aprovação (RM-APR)

| ID | Regra | Origem |
|---|---|---|
| RM-APR-01 | Cada atividade de aprovação tem rodada, `M` slots únicos de titulares elegíveis, regra e `N` quando aplicável. `M` é congelado na ativação, após deduplicação, conflitos e saltos; não é recalculado pela lista de pendentes. | [02 R04] |
| RM-APR-02 | `N_DE_M` exige `1 ≤ N ≤ M`; se a resolução reduzir `M` abaixo de `N`, incidente — nunca reduzir `N` silenciosamente. | [02 R04] |
| RM-APR-03 | Quórum lê TODAS as decisões da rodada (grupo inteiro): `TODOS` aprova com `M` votos, `QUALQUER_UM` com 1, `N_DE_M` com `N`. | [02 R04] |
| RM-APR-04 | Veto: qualquer `reject` encerra a atividade na saída `reject`, mesmo antes do quórum. `return` fecha a rodada e pede correção. Ao vencer quórum/reject/return, slots restantes recebem fechamento `superseded`/`not_required`, sem fabricar voto. | [02 R04] |
| RM-APR-05 | Corrida approve/reject é serializada pelo lock de `Request`: a primeira conclusão válida vence; o segundo comando recebe `409` se a atividade já fechou. | [02 R04] |
| RM-APR-06 | Um ator real conta no máximo um voto por atividade/rodada, mesmo sendo delegado de vários titulares ou titular e delegado. Se elegível a mais de um slot, escolhe o slot; o servidor não adivinha. Constraint de voto por ator e por slot. | [02 R04] |
| RM-APR-07 | Delegação: um salto, sem transitividade; válida em `[startsAt, endsAt)`; escopo de setor e de processo/categoria quando disponível; revogação e inatividade reavaliadas a cada decisão. Inbox inclui delegação válida; expiração retira a ação, nunca apaga decisão passada. Delegar não concede acesso geral à fila. | [02 R04] |
| RM-APR-08 | Snapshot aprovado inclui dados materiais canônicos, revisão e hashes dos documentos. Diferença em itens, quantidade, fornecedor/proposta, valor, beneficiário, projeto, centro de custo, escopo, datas ou anexo de proposta invalida a rodada afetada inteira. v1 reinicia todas as aprovações financeiras do ciclo. | [02 R04] |
| RM-APR-09 | Decisões são imutáveis; superadas por evento, nunca editadas/apagadas. Comentário/pergunta sem mudança material não invalida a rodada. | [02 R04] |
| RM-APR-10 | Mesma pessoa em dois papéis sequenciais: registrar ambos os papéis e duas atividades; não somar voto duplicado no mesmo grupo. | [06 Compras #7] |

## 8. Política de acesso (RM-ACE)

| ID | Regra | Origem |
|---|---|---|
| RM-ACE-01 | Acesso = permissão atual de recurso E escopo do processo/fila/registro E atividade correspondente E campo liberado E ausência de conflito. Permissão de catálogo não implica leitura de instâncias. Admin não tem bypass de conteúdo restrito. Auditor só lê com concessão de escopo, sem mutação. | [02 R05] |
| RM-ACE-02 | Matriz por vínculo: **autor** — próprio rascunho e conteúdo público do registro; editar/enviar/corrigir/responder/aceitar/contestar/cancelar conforme fase. **Beneficiário** — após envio, se `beneficiaryCanRead=true`; não herda decisões do autor. **Candidato de fila** — registros enviados da fila, se a classificação e a política permitirem; assume atividade elegível; não edita antes do claim. **Executor/triador atribuído** — dados/documentos da atividade. **Titular/delegado atual** — pacote de decisão; vota só no slot elegível. **Gestor explícito de fila** — registros do escopo (restritos exigem grant); atribuir, prioridade, incidentes, cancelamentos com motivo. **Observador concedido** — campos públicos autorizados durante a concessão. **Auditor com grant** — histórico e leitura mascarada. **Modelador/publicador/admin sem vínculo** — só configuração. **Outro setor / ID conhecido** — nenhuma informação. | [02 R05] |
| RM-ACE-03 | Registro oculto responde `404` (nunca `403`), sem contagem, título ou código. Zero resultados não distingue oculto de inexistente. | [02 R05] |
| RM-ACE-04 | Rascunho é privado ao autor; beneficiário, fila e aprovador não o veem. | [02 R05] |
| RM-ACE-05 | Em `restrita`/`confidencial`, membresia de fila não basta: exige atribuição, candidatura provisionada para a tarefa, participação direta ou grant restrito com campos e validade. `interna` não é leitura global. Hierarquia não concede leitura implícita. Grants gerenciais não podem incluir pessoas em conflito. | [02 R05] |
| RM-ACE-06 | O predicado de visibilidade compõe a consulta SQL ANTES de paginação, contagem e agregação; nunca carregar tudo e filtrar em JS. Busca, ordenação, exportação e métricas usam o mesmo escopo; campo oculto não serve de oráculo. | [02 R05] |
| RM-ACE-07 | DTOs são projetados por allowlist; proibido devolver o modelo Prisma (`...PrismaModel`). | [02 R05] |
| RM-ACE-08 | `allowedActions` vem do servidor por registro/atividade e é só ajuda de UI: o comando sempre recalcula a autorização. | [02 R05], [Plan 6.2 #1] |
| RM-ACE-09 | Autorização por pares coerentes vínculo × permissão: ex. `(autor ∧ request:create ∧ fase do autor) ∨ (gestor da fila ∧ permissão de gestão ∧ fase do gestor)`. Nunca avaliar "tem alguma permissão" e "tem algum vínculo" separadamente. | Lição P01 (E04), [evidência](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-5/REVISAO.md) |
| RM-ACE-10 | Revogação de papel/conta/membresia vale imediatamente, inclusive para replay e leitura com JWT antigo. | [P01 A16], [01 Fronteiras] |

## 9. Comentários, documentos e identidade (RM-DOC)

| ID | Regra | Origem |
|---|---|---|
| RM-DOC-01 | Comentário público é visível aos participantes autorizados do registro, não à organização. Nota interna só para a equipe explicitamente autorizada do ciclo; aprovar não libera todas as notas internas. Comentar em estado terminal é permitido com permissão e acesso, sem reabrir. | [02 R06] |
| RM-DOC-02 | Anexo tem classificação e vínculo opcional a campo/atividade; download exige acesso ao registro E ao documento. Associação por ID de outro registro é inválida. | [02 R06] |
| RM-DOC-03 | Nova versão de anexo cria linha/hash novos; substituição nunca altera bytes já aprovados. | [02 R06] |
| RM-DOC-04 | Anonimato oculta autoria em todos os DTOs, eventos, comentários do autor, nomes de upload, notificações, exports e diagrama. Ver identidade exige permissão atual `request:view_whistleblower_identity` E grant restrito no processo. Não é canal anônimo sem login; não prometer anonimização do conteúdo de arquivos. | [02 R06] |
| RM-DOC-05 | Logs operacionais só com IDs técnicos, códigos de erro e correlação; nunca formulário sensível, token ou base64. Timeline é resumo filtrado; auditoria técnica não revela campo oculto. | [02 R06] |
| RM-DOC-06 | Armazenamento BYTEA com validação de MIME por magic bytes, bloqueio de executáveis e limites, sem antimalware, até decisão em contrário (U03). | [08 U03] |

## 10. SLA (RM-SLA)

### 10.1 Métricas

| ID | Métrica | Começa | Para | Pausa |
|---|---|---|---|---|
| RM-SLA-01 | Primeira resposta | Primeiro submit do ciclo | Primeira resposta humana válida: concluir triagem, devolver com motivo ou pergunta objetiva | Nunca; claim automático ou comentário genérico não encerram |
| RM-SLA-02 | Triagem | Ativação da tarefa de triagem | Decisão da triagem | Não pausa |
| RM-SLA-03 | Aprovação | Ativação da rodada | Resultado válido da rodada | Não pausa |
| RM-SLA-04 | Solução | Submit do ciclo | `end` de sucesso; cancel/reject param com outcome separado | Só espera objetiva do autor, quando toda execução bloqueante aguarda o autor |
| RM-SLA-05 | Atividade | Ativação | complete/supersede/cancel | Conforme política do nó |
| RM-SLA-06 | Encerramento | `completedAt` | `closedAt` | Não é SLA de solução; inclui espera de aceite |

Origem: [06 SLA autoritativo].

### 10.2 Regras

| ID | Regra | Origem |
|---|---|---|
| RM-SLA-07 | Relógio único autoritativo (`clock` + intervalos). Consultas calculam a mesma projeção que os jobs. Edição/comentário não substituem `submittedAt`/`completedAt` nem reiniciam prazo. | [06 SLA] |
| RM-SLA-08 | Paralelismo: espera de resposta em um ramo não pausa solução enquanto outro ramo interno segue ativo. Devolução conta como espera do autor só após motivo formal; aprovação, fila, gestor ausente, terceiro e integração não pausam no default. | [06 SLA] |
| RM-SLA-09 | Calendário snapshot: timezone IANA `America/Sao_Paulo`, intervalos semanais locais, exceções por data, plantões opcionais. Proibido offset fixo UTC−3. Default seg–sex 08h–18h (600 min/dia), feriados copiados de `Holiday` na publicação. 2.880 minutos são 4,8 expedientes, não "dois dias". | [06 SLA] |
| RM-SLA-10 | Consumo em segundos inteiros; orçamento em minutos convertido uma vez. `businessSecondsBetween(a,b,snapshot)` soma as interseções dos intervalos úteis com `[a,b)` menos pausas; `advanceBusinessSeconds(a,n)` percorre os mesmos intervalos. | [06 Algoritmo] |
| RM-SLA-11 | Intervalos sobrepostos, timezone inválido, duração negativa ou calendário sem abertura em 366 dias → erro de validação/incidente, sem laço infinito. | [06 Algoritmo] |
| RM-SLA-12 | Clock em curso: `elapsed = persistedElapsed + businessSecondsBetween(checkpointAt, now)`; checkpoint e intervalo mudam na mesma transação. Percentual = `elapsed/budget`, nunca proporção corrida entre `startedAt` e `targetAt`. | [06 Algoritmo] |
| RM-SLA-13 | Clock ativo: `targetAt = advanceBusinessSeconds(now, max(0, budget − elapsed))`. Pausado: mantém `originalTargetAt`, mostra alvo suspenso e recalcula ao retomar. Pausa não adiciona duração corrida ao prazo. | [06 Algoritmo] |
| RM-SLA-14 | `breachedAt` é o instante exato em que o orçamento se esgotou, não o horário do cron nem o da parada. | [06 Algoritmo], lição P01 (E05) |
| RM-SLA-15 | Prazo manual exige comando com motivo e gestor; grava meta original, nova e autorização sem apagar violação. Reatribuição mantém relógio. Recategorização preserva consumo. | [06 Algoritmo] |
| RM-SLA-16 | Alertas 50/80/100%, sinal único por clock/limiar mesmo com dois workers; limiares perdidos são registrados uma vez e a notificação agrupa o mais grave. Worker consulta no máximo a cada minuto; testes usam relógio injetado. | [06 Algoritmo] |
| RM-SLA-17 | Escalonamento padrão notifica executor → gestor da fila em 100% → gestor do setor após 600 min úteis; sem reatribuição automática. Responsável ausente vira incidente. | [06 Algoritmo] |
| RM-SLA-18 | Espera do autor: limite padrão 5 dias úteis; ao vencer, solução volta a correr e o gestor é alertado; não cancela. | [06 Algoritmo] |
| RM-SLA-19 | Auto-close: 3 dias úteis desde a conclusão quando `requiresAcceptance=false`; se `true`, só após aceite e sem contestação — o timer é lembrete/incidente, nunca aceite presumido. | [06 Algoritmo] |
| RM-SLA-20 | Janelas de reabertura/auto-close usam `addBusinessDaysLocal(t,N)`: N próximas datas locais com expediente, excluindo a data de `t`, mantendo hora/minuto local; hora inexistente → próximo instante válido. Não converter dias em minutos. Reabertura até o deadline inclusive. Reabertura cria ciclo e clocks novos; métricas mantêm ambos os ciclos. | [06 Algoritmo] |

### 10.3 Vetores de teste obrigatórios (RM-SLA-T)

Calendário sintético seg–sex 08h–18h, feriado sintético segunda 09/11/2026; datas locais no texto, instantes UTC no teste [06 Vetores].

| ID | Entrada | Resultado esperado |
|---|---|---|
| RM-SLA-T01 | Sex 06/11/2026 17:30 + 120 min úteis | Ter 10/11/2026 09:30 (UTC 12:30) |
| RM-SLA-T02 | Sex 06/11 19:00 + 60 min | Ter 10/11 09:00 |
| RM-SLA-T03 | Ter 10/11 17:00, meta 120 min; pausa de 17:30 até qua 11/11 09:00 | Saldo 90 min, vence qua 10:30 |
| RM-SLA-T04 | Clock 240 min iniciado sex 06/11 17:00; consulta ter 10/11 09:00 | Consumiu 120 min = 50% |
| RM-SLA-T05 | Conclusão sex 06/11 15:00 + 3 dias úteis | Qui 12/11 15:00 (auto-close) |
| RM-SLA-T06 | Reabertura + 5 dias úteis da mesma conclusão | Seg 16/11 15:00, limite inclusivo |
| RM-SLA-T07 | Alerta executado duas vezes / por dois workers | Um sinal e uma notificação por destinatário |
| RM-SLA-T08 | Mudança de TZ do host, virada de ano, DST sintético em outro fuso | Mesmos instantes por IANA |
| RM-SLA-T09 | Sex 06/11/2026 17:59:45 + 1 min (sem feriado) | Seg 09/11 08:00:45 — não 18:00:45 de sexta (lição P01, [rodada 2](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-2/REVISAO.md)) |
| RM-SLA-T10 | Meta 60 min iniciada seg 02/11/2026 08:00, parada às 10:00 | `elapsed` 7.200 s; `breachedAt` 09:00 (lição P01 E05) |

## 11. Compras (RM-CMP)

Proposta para homologação; operação depende das decisões B01/B02 ([decisoes-negocio.md](decisoes-negocio.md)). Fonte: [06 Compras piloto].

| ID | Passo / regra |
|---|---|
| RM-CMP-01 | Autor seleciona material validado no catálogo Logística, quantidade/unidade, data/local, projeto e centro de custo. Servidor monta o título por template configurado, sem condicional de categoria. |
| RM-CMP-02 | Triagem de Suprimentos por membros elegíveis; autor/beneficiário não triam. Sem CC ou responsável válido, pendência explícita. |
| RM-CMP-03 | Aprovação gerencial da necessidade pelo responsável independente do CC. Consulta/reserva no Almoxarifado após essa aprovação; análise preliminar não cria movimento. |
| RM-CMP-04 | Ordem de material aprovada vai à Logística (autoridade de reserva/estoque). Reserva completa → separação/entrega. Parcial ou falha → cotar SOMENTE o saldo não reservado, mantendo o já reservado. |
| RM-CMP-05 | Suprimentos registra cotações completas para o saldo (mínimo uma, sem impor três sem decisão): linhas, impostos, frete, desconto, validade, documentos; valores em decimal no servidor. Autor pode validar aderência técnica sem aprovação financeira própria. |
| RM-CMP-06 | Responsável independente do CC escolhe a proposta em comando separado, que gera revisão/hash e sincroniza o total comprometido. Não escolhe cotação inexistente, expirada ou de outro registro. |
| RM-CMP-07 | Executar a alçada financeira configurada sobre o total comprometido (default de teste: matriz §9.2 da spec, não os níveis do seed). |
| RM-CMP-08 | Aprovação autoriza emitir pedido; não prova emissão, compra, pagamento ou recebimento. Pedido vira registro de domínio rastreável e evento de previsão para a Logística. Pagamento fora do ciclo. |
| RM-CMP-09 | Recebimento confirmado na Logística libera saldo; só então `material_request.reserve_remaining` na MESMA ordem/versão. Recebimento parcial, rejeição ou divergência mantém a atividade aberta. Entrega e aceite são etapas distintas. |
| RM-CMP-10 | Concluir após todas as quantidades entregues ou dispensas formais com impacto documentado. Negativa financeira cancela/compensa reservas pendentes sem apagar movimentos. |
| RM-CMP-11 | Proposta alterada reinicia a rodada financeira inteira; pedido emitido exige mudança/cancelamento autorizado antes de nova versão externa. Sem compra emergencial, orçamento online ou parcelamento recorrente no piloto. |
| RM-CMP-12 | Fracionamento: soma por solicitante + fornecedor selecionado + CC + objeto tipado (`procurementObjectKey`) em janela móvel de 30 dias corridos, serializada por bucket; inclui compromissos enviados/aprovados, exclui rascunhos/cancelados/reprovados e a própria linha; decimal; reavaliada na seleção e na pré-emissão. Objeto sem classificação é erro. Política e janela versionadas. |
| RM-CMP-13 | Faixas de alçada são intervalos contínuos `(lowerExclusive, upperInclusive]`, a primeira incluindo zero: `[0, 1000]`, `(1000, 10000]`, `(10000, 50000]`, `(50000, 100000]`, `(100000, ∞)`. Quatro casas decimais não criam buracos. Arredondamento antes do cálculo da faixa. Matriz por setor com fallback global só se a versão definir; sem faixa → incidente. |
| RM-CMP-14 | Catálogo consultado no navegador é só conveniência: o servidor revalida material/unidade/ativo por adaptador confiável; preço do cliente não é autoritativo. Sem reutilizar JWT de admin nem URL escolhida pelo modelador. Catálogo fora do ar permite salvar rascunho; envio/cotação/efeito falham explicitamente. |
| RM-CMP-15 | Sem integração fechada, a UI mostra "Pedido ainda não emitido — integração pendente"; nenhuma "análise de estoque" manual vale como reserva/baixa; nenhum estoque, pagamento ou fornecedor fictício. |

## 12. Integração Core ↔ Logística, contrato v1 (RM-INT)

| ID | Regra | Origem |
|---|---|---|
| RM-INT-01 | Envelope `snake_case` com `event_id` estável, `event_type`, `occurred_at` e `payload` contendo `schema_version`, `correlation_id`, `request_id`, `cycle`, `version`, `operation_id`, `sequence`, `snapshot_hash`, IDs de projeto/CC/solicitante/destinatário, `warehouse_code`, `needed_by`, `items[{line_id, material_id, material_code, quantity}]`. HMAC do corpo bruto: `X-Axis-Signature` (Core→Logística), `X-Logistica-Signature` (retorno), segredos distintos fora da definição. | [06 Contrato] |
| RM-INT-02 | `version` é a versão monotônica da operação externa por `Request` (não `CategoryVersion.version`, `lockVersion` nem ciclo); novo ciclo nunca reutiliza versão. `line_id` estável por linha; material duplicado no mesmo pedido é recusado no piloto. | [06 Contrato] |
| RM-INT-03 | Eventos Core: `material_request.approved`, `.changed` (só antes de efeito físico ou após compensação), `.cancel_requested` (versão exata), `.reserve_remaining` (novo, idempotente, só saldo), `purchase_order.approved/changed`. | [06 Contrato] |
| RM-INT-04 | Eventos Logística: `fulfillment.created`, `reservation.confirmed/partial/failed`, `receipt.confirmed/divergent`, `shipment.dispatched`, `delivery.confirmed/partial/refused`, `material_request.cancelled/cancel_pending/cancel_refused` (novos), cada um com quantidades por `line_id`. | [06 Contrato] |
| RM-INT-05 | Quantidades de retorno são acumulados monotônicos por linha/versão; devolução exige evento de correção. Entregue > solicitado, recebido sem pedido ou ID divergente → inbox em quarentena/incidente. Mesmo `event_id` com hash diferente é conflito de segurança. | [06 Contrato] |
| RM-INT-06 | Saída ordenada por operação/versão: não despachar N+1 antes da entrega durável de N. Consumidor guarda `sequence` e tombstone de cancelamento. | [06 Contrato] |
| RM-INT-07 | Endpoint de retorno com corpo bruto preservado, HMAC obrigatório comparado em tempo constante, schema validado, dedupe inbox/efeito na mesma transação. `200` só após commit; `202` só após inbox recuperável persistido. Erros: assinatura `401`, payload `400/422`, falha transitória `503`. Fonte não vem livre do body. | [06 Contrato] |
| RM-INT-08 | Retries: timeout 10 s, cinco tentativas (1 min, 5 min, 30 min, 2 h), depois incidente/dead-letter; mesmo `event_id` e `effectKey`. At-least-once no transporte, efeito idempotente por constraint. Replay além de 72 h é reprocessamento explícito e auditado. | [06 Contrato] |
| RM-INT-09 | Evento obrigatório sem assinatura/subscrição/configuração → incidente `INTEGRATION_NOT_CONFIGURED`; nunca marcar sucesso por falta de assinante. Entrega por destinatário com lease curto, HTTP fora da transação. | [06 Contrato] |
| RM-INT-10 | Reconciliação: `GET /api/v1/axis-operations/:operationId` na Logística com credencial de serviço, consultado só após falha/lacuna; o Core nunca acessa o banco do satélite. | [06 Contrato] |
| RM-INT-11 | Handlers de espera usam referências duráveis, sem polling: `logistics.requestMaterial`, `procurement.issueOrder`, `procurement.awaitAcceptedReceipt`, `logistics.reserveRemaining`, `logistics.awaitFullDelivery` (barreira para estoque inicial e saldo comprado). Eventos parciais atualizam o agregado sem reexecutar o nó. | [06 Contrato] |

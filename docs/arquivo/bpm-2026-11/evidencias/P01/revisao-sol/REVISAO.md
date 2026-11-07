# Revisão Sol — P01 / rodada 1

Data: 01/11/2026 (America/Sao_Paulo). Resultado: **AJUSTES NECESSÁRIOS; P01 NÃO ACEITO. P02 NÃO LIBERADO.**

A entrega acrescenta estrutura, schema e telas iniciais, mas não cumpre a jornada nem os controles obrigatórios de P01. Há defeitos reproduzidos sem banco, além da ausência de validação integrada. Não classificar o pacote como “implementação concluída, faltando apenas homologação”. A falta de PostgreSQL/navegador explica os testes de integração não executados; não explica recursos ausentes nem falhas dos métodos já escritos.

Sol não alterou aplicação, migrations ou dados nesta revisão. O diff inclui alterações anteriores do usuário; achados abaixo apontam o código novo e as fronteiras que P01 deveria proteger. Não corrigir removendo o trabalho local anterior.

## Evidência executada nesta revisão

Comando: `node docs/requisicoes-bpm/evidencias/P01/revisao-sol/checks.cjs`.

O [script](checks.cjs) lê os serviços TypeScript e os transpila em memória, substitui somente dependências externas/armazenamento por fixtures sintéticas e chama métodos reais. O [resultado registrado](results.json) contém nove reproduções. Não abre rede, não inicializa Prisma/Nest, não grava na aplicação e não valida transações de PostgreSQL. São evidências isoladas de defeitos, não aceite A01–A24.

| Reprodução | Resultado observado |
|---|---|
| S01 | Payload de submit com form vazio rejeita title e description como campos desconhecidos |
| S02 | Grafo com tipos unsupported e três autoarestas é considerado valid=true |
| S03 | Autor recebe uma nota interna no DTO de detalhe |
| S04 | Retry de submit já enviado é recusado antes de consultar recibo |
| S05 | Prazo do vetor com feriado segunda vence na segunda, em vez de terça |
| S06 | Data impossível, decimal fora da precisão, obrigatório só com espaços e ID de anexo inexistente são aceitos |
| S07 | Modelador global consegue editar versão de outro processo sem consultar grant |
| S08 | Consulta de recibo para claim aceita recibo de submit de outro Request com corpo igual |
| S09 | Beneficiário consegue acessar rascunho privado de outro autor |

Não repeti builds/typechecks relatados por Luna: não verificariam esses comportamentos e o backend build já tinha impedimento de filesystem informado. Ausência de novos testes P01/fixtures/configuração de runner foi verificada no checkout. PostgreSQL16 e navegador continuam necessários para o gate integrado.

## R01 — P1: enviar o processo padrão é impossível

Local: `backend/src/request-runtime/request-runtime.service.ts:23` e `:29`.

`submit` junta title/description a formData e passa tudo a `validateFields`, cujo conjunto allowed contém apenas definition.form. O processo criado pelo próprio serviço tem form vazio. Assim toda tentativa comum de envio falha com “Campo desconhecido” para title/description antes de criar ciclo/atividade. S01 executou esse caminho de validação.

Correção: validar dados comuns no DTO/regra própria e somente fields no schema; não transformar título/descrição em campos dinâmicos para contornar o erro. Critério: processo vazio e processo com um campo configurado chegam ambos à triagem pela API e UI, com obrigatórios de abertura corretos. A05/A07/A09 precisam de evidência real.

## R02 — P1: autorização usa claims antigos e permite controle fora do processo

Locais: `request-processes.service.ts:12`, `:63–70`; `request-runtime.service.ts:13`, `:24`, `:31`; guards dos novos controllers.

Não há consulta a User/status/RolePermission atuais nos comandos. Claims do JWT são a única permissão global; revogar papel/desabilitar conta não é revalidado no BPM. patch/validate/publish/enable/createVersion/grants não exigem grant do processo. `version` permite qualquer modelador global pelo OR da condição. `grants` pode substituir concessões de qualquer categoria sem revisão, expiração ou elegibilidade do destinatário. A candidatura é materializada, mas não revalida conta/hierarquia/membro ao decidir. S07 demonstra a edição sem grant.

Correção: política BPM local única sobre identidade/permissões atuais + grant de configuração/fila + atividade/registro, dentro da transação para mutações. Não mudar autenticação global nem conceder poderes pelo nome admin. Publicador/modelador tem escopo de configuração, não acesso a conteúdo de instâncias. Critério: ator com mesmo papel global mas sem grant não lê/edita/publica categoria de outro dono; JWT antigo é negado após revogação/desligamento; grant expirado é negado; read-only não vira write. A14–A16.

## R03 — P1: rascunho, nota interna e campos não têm isolamento previsto

Locais: `request-runtime.service.ts:24`, `:36–41`.

`requestAccess` trata beneficiário como autor inclusive no draft; dá leitura a grant modeler e bypass global request_process:audit. `list` também inclui drafts por beneficiário. `detail` inclui notas internas para isRequester, retorna formData inteiro sem field projection e allowedActions sem checar permissões atuais. Todos os anexos são retornados/baixados sem política de campo/documento. S03/S09 reproduzem duas exposições.

Correção: predicado de leitura por fase/participação antes de paginação, grant específico de auditoria, projeção allowlist de campo/nota/anexo e ações calculadas pela política. Autor só lê notas públicas salvo vínculo operacional separado explicitamente autorizado. Critério: draft só do autor; configuração não abre instância; campos hidden, notas internas e anexos vinculados a campos ocultos não saem em detalhe/lista/timeline/download. A04/A14/A15/A21.

## R04 — P1: BPM ainda pode ser executado e criado pelo legado

Locais: `backend/src/requests/requests.service.ts:677`, `:730`, `:832–834`, `:909–916`; `backend/src/request-categories/request-categories.service.ts:36–59`.

Não existe referência a executionMode/bpmStatus em Requests ou no catálogo legado. Categoria BPM é criada active=true com versão que já recebe publishedAt pelo default legado. Aparece no portal antigo, inclusive draft/desabilitada, e pode criar Request legacy com JSON BPM. IDs BPM também chegam a mutações antigas; auto-close antigo consulta concluídas sem excluir BPM e pode encerrar fora do contrato novo, sem fechar instância/eventos/versão novos. O uso de executionMode no schema não estabelece separação sozinho.

Correção: catálogo/latestVersion legados só versões legadas; mutations/readers antigos reconhecem o executor e respondem WRONG_EXECUTOR/rota segura; todos os jobs/listas/métricas antigos excluem BPM. Mudanças cirúrgicas em RequestsService estão expressamente no escopo de P01 e devem preservar o diff de compras do usuário. Critério: testes A22 demonstram comandos e crons de um motor incapazes de alterar registro do outro, e nenhuma categoria BPM no portal legado.

## R05 — P1: recibos e controle de concorrência não cobrem o contrato

Locais: `request-runtime.service.ts:25–30`, `:32–39`; `request-runtime/dto.ts:2–8`; controllers novos.

Submit/claim/complete verificam estado antes de procurar recibo; após o primeiro sucesso o replay falha (S04). O hash não inclui método/rota/ID do recurso e routeScope é ignorado (S08). O replay não fornece appliedVersion/currentVersion válidos. Criação/saveDraft/close/cancel/comment/attachment e administração não têm dedupe completo; comentários/upload nem expectedVersion ou incremento de versão. Event sequence usa max+1 sem serialização para esses escritores. O cliente mantém commandKey determinístico, mas cria commandId diferente a cada retry: mesmo clique lógico muda o hash. O header Idempotency-Key exigido pelo contrato não é usado.

Correção: executor comum de comandos, chave UUID em header, hash canônico incluindo método/rota/payload, recibo antes das pré-condições mutáveis (após autenticação/escopo atual), lock Request e releitura em tx, versão única por comando; todos os escritores seguem a mesma ordem. Retorno de replay referencia recurso autorizado correto, sem DTO antigo. Critério: A07/A08/A10–A12/A16, incluindo retry após resposta perdida, chave reutilizada em outro ID/rota, comentários/uploads simultâneos e sem eventos/bytes parciais. Não basta adicionar unique e deixar Prisma P2002 virar 500.

## R06 — P1: troca de fila, status, atribuição e tokens ficam incoerentes

Locais: `request-runtime.service.ts:12`, `:31–35`.

Claim de triagem mantém status enviada; deveria em_triagem. Ao abrir execução, Request.queueId continua na triagem; o executor membro apenas da fila de execução é candidato da atividade, mas requestAccess o rejeita pela fila antiga. Gestor correto também não consegue close. Request.assigneeId e histórico ActivityAssignment não são atualizados. Tokens são criados, mas nunca consumidos/cancelados, inclusive após conclusão/cancelamento. Release é anunciado em allowedActions sem endpoint; reassign não existe.

Correção: uma transição atualiza atividade/token/assignment/participantes e resumo Request atomicamente, usando fila atual e assignee correto, consumindo tokens ao avançar e cancelando-os ao cancelar. Implementar release/reassign P01. Critério: A09 usa filas de triagem e execução distintas com pessoas distintas; status e gestão acompanham destino; terminal não mantém tokens ativos; A10/A13/A20 verificam persistência e concorrência.

## R07 — P1: validação e publicação não garantem definição executável/imutável

Locais: `request-processes.service.ts:64–69`; migration P01.

Validador verifica IDs/contagem, mas ignora tipos de nós, conteúdo das arestas/ciclos, phases/resolvers, capabilities, filas elegíveis, policies e metas. S02 aceita explicitamente tipos não suportados e autoarestas. Patch de versão verifica estado/revisão fora da tx, depois atualiza apenas por id: pode sobrescrever edição concorrente e escrever após publicação concorrente. Validate não usa expectedVersion. Publicação não compara hash atual ao validado no cenário de validação concorrente, não bloqueia categoria/ponteiro e não revalida configuração operacional. Não há proteção de imutabilidade no banco. Draft recebe publishedAt, e a versão vigente é inferida pelo maior número publicado.

Correção: adotar o snapshot normativo dos documentos ou apresentar proposta equivalente explícita para revisão, não um segundo formato silencioso (form array/policy.internal/queueId solto). Validador P01 prova exatamente o grafo linear, tipos, constraints de form, filas elegíveis no setor e metas. CAS/locks de categoria/versão e hash da revisão atual; publishedAt null no draft; ponteiro publicado explícito; versão publicada imutável no serviço e banco. Critério: A02/A03/A17, com patch↔patch, patch↔publish, validate↔patch↔publish e duas publicações concorrentes reais.

## R08 — P1: editar uma fila mantendo membros existentes viola unique

Local: `request-processes.service.ts:49`; unique `queueId,collaboratorId,role` no schema/migration.

Update desativa linhas antigas e faz createMany dos membros selecionados. O índice único também inclui linhas inativas. Qualquer membro mantido gera a mesma tupla e falha P2002, revertendo a edição inteira; cenário comum de apenas renomear a fila ou acrescentar alguém. Não há UI de edição de membros/gestores para resolver incidente.

Correção: reconciliar/upsert a identidade do membro, preservando histórico por evento/intervalo quando necessário, sem inserir a mesma tupla duas vezes; verificar revision dentro da tx. Critério: renomear mantendo membros, acrescentar/remover, reativar pessoa e dois saves concorrentes funcionam conforme versão e sem apagar trilha. Depois executar recuperação de NO_ELIGIBLE_ASSIGNEE em A18.

## R09 — P1: validação de campos/anexos não protege o conteúdo publicado

Locais: `request-runtime.service.ts:23`, `:27`, `:39`; `request-processes.service.ts:65`.

Decimal aceita number/escala ilimitada, Date.parse normaliza datas impossíveis, select não implementa IDs/labels/fontes, required não considera whitespace, attachment aceita qualquer string sem comprovar posse/validação. Limites/tipos/formAccess do snapshot não são aplicados. S06 demonstra exemplos aceitos. Representation consulta só claim e não a política desabilitada. Upload soma tamanho fora da tx, não versiona substituição e calcula SHA-256 da string JSON do base64, em vez dos bytes. A consulta de acesso carrega todos os conteúdos BYTEA até para detalhe/ação sem download.

Correção: schema tipado compartilhado e validação de presença/tipo/escala/limites/opção/referência/documento no servidor; campo oculto/read não aceita escrita. Upload serializado no agregado, hash dos bytes e substituição com linha/hash anteriores preservados. Selects usam fontes seguras, sem UUID livre. Critério: A05/A06/A12/A21, teste de upload concorrente contra limite total e de anexo pertencente a outro registro; nenhum conteúdo BYTEA em consultas comuns. Não adicionar antimalware/object storage: U03 continua válido.

## R10 — P1: clocks não implementam o SLA básico contratado

Locais: `request-runtime.service.ts:11`, `:15`, `:29`, `:33`, `:37`; `request-processes.service.ts:59–60`, `:67–68`.

Avanço usa UTC11–21 fixo, ignora timezone IANA, feriados e calendário publicado. S05 obtém segunda 09/11 quando o vetor com feriado vence terça 10/11. Não existem consumo útil/checkpoint/intervalos nem cálculo de breach; elapsedSeconds continua zero, breachedAt null e a UI não mostra SLA. Alterar sla no JSON não atualiza as colunas de meta efetivamente usadas pelo runtime, portanto a configuração aparente pode não mudar os prazos. P01 já exige esses dois clocks corretos; P05 não autoriza adiar essa base.

Correção: funções úteis determinísticas com snapshot/IANA/feriados e metas do snapshot publicado; persistir consumo ao parar e projetar consumo/violação corrente consistentemente. Sem alertas/timers avançados antes de P05. Critério: vetores básicos de 06-sla-logistica, primeira resposta na triagem (não no claim), stoppedAt/elapsed exatos, host timezone diferente e meta v2 sem mudar v1. A19.

## R11 — P1: não há jornada administrativa/operacional completa na interface

Locais: `frontend/src/features/requisicoes-bpm/BpmPages.tsx:12–18`; `frontend/src/App.tsx:106–110`.

Configuração exige UUIDs digitados e edição do JSON bruto, contrariando o assistente P01 (canvas completo realmente é P06 e não está sendo exigido agora). Não há seleção de gestor/publicador, botão habilitar, editar fila, clone v2, prévia, resolver incidente ou configurar formulário/metas sem JSON. Processo criado pela UI fica runtimeEnabled=false e não há ação UI para habilitar. Nova requisição renderiza inputs de campo mas envia fields:{}; não tem tipos/upload, draft editável/retomável ou autosave. Detalhe não mostra dados dinâmicos, SLA, anexos/comentários/timeline; inbox/fila e cancel/release/reassign faltam. Rotas administrativas exigem request:read em vez da permissão de configuração. Links não dependem das capacidades/permissões e ações não têm proteção de chamada em voo/retry coerente.

Correção: completar as superfícies P01 do pacote usando componentes/padrões existentes e seletores seguros. Não reduzir o aceite para caber nas telas atuais. Critério: A01/A04/A06/A09/A17/A18/A20/A23 executáveis por usuário sem SQL, UUID manual ou edição de JSON. Demonstração com teclado/390px, conflito e recuperação sem perder dados.

## R12 — P2: contrato de identificação, erros, paginação e migration incompleto

Locais: `request-runtime.service.ts:27`, `:36`, `:41`; controllers/DTOs; migration P01.

Código foi trocado por BPM-ano-UUID aleatório; P01 exige reutilizar REQ-AAAA-sequencial/contador transacional com ano em America/Sao_Paulo. Listagens/timeline não paginam, retorno difere do envelope/ETag/command response e erros de negócio usam 400 genérico sem correlationId. A migration não tem os novos índices de Request declarados no schema nem todos os índices/FKs/checks/índices parciais e proteções de histórico previstos; operações têm ON DELETE CASCADE onde o modelo normativo determina preservação. Schema válido não prova que SQL aplique o mesmo modelo.

Correção: alinhar contratos P01, preparar migration aditiva equivalente (sem modificar migrations locais anteriores) e registrar plano de rollback sem DROP de operações. Conferir diff migration↔schema em Postgres dedicado. Critério: códigos sequenciais únicos inclusive virada de ano/concorrência, cursores/limites, erro localizado/409, nenhuma remoção de histórico por cascade operacional e migração ensaiada/restauração documentada.

## R13 — P1: faltam testes escritos e evidências dos gates

Locais: `docs/requisicoes-bpm/evidencias/P01/README.md`; ausência dos arquivos de testes e helper/runner previstos no pacote.

Não há suite nova P01 nem helper BPM_TEST_DATABASE_URL/fixture/Playwright no checkout. Os itens “parciais” da tabela são descrições de intenção/código, não resultados de testes de comportamento. Os defeitos S01/S02/S04/S06 eram testáveis sem banco; ausência de Postgres não impede escrever/executar esses testes. Nenhum gate prova rollback, duas conexões, replay, restart, isolamento, v1/v2 ou UI completa.

Correção: escrever testes necessários enquanto corrige; preservar as reproduções como regressões na suite da aplicação com asserções corretas. Executar unitários e testes de UI sem DB onde possível; depois Postgres16 descartável nome *_bpm_test com proteção de host/URL, integração de API/constraints/concorrência e jornada real. Não usar DATABASE_URL como fallback/compose principal/seed operacional. Se infra persistir indisponível após preparar tudo, registrar apenas esse impedimento remanescente e manter aceite pendente.

Critério: tabela A01–A24 atualizada com resultado real, fixture, comando/log/captura e limitações; sem declarar concluído por typecheck/build. Smoke dos demais módulos precisa de evidência, não da afirmação “não toquei nos arquivos”.

## Ordem de correção no mesmo P01

1. Segurança e isolamento: R02/R03/R04; executar negativas isoladas desde o início.
2. Contrato/runtime: R01/R05/R06/R07/R08/R09/R10/R12, consolidando política/executor/schema e testes de regressão. Separar arquivos por responsabilidade para que revisão e evolução P02 não dependam de métodos inteiros em uma linha; organização equivalente à lista prevista é aceita.
3. Jornada UI: R11, incluindo configuração por seletores/assistente, habilitação, inbox/fila, draft/upload/retomada, ações e evidências.
4. Validar migração/API/concorrência/restart/jornada em ambiente dedicado e fechar R13. Entregar novamente para revisão de Sol. Não avançar a P02 nem reduzir os critérios A01–A24.

Não há nova dúvida de negócio impeditiva para essas correções. A impossibilidade de alterar RequestsService não procede: a separação cirúrgica do legado consta expressamente do P01; deve preservar o trabalho local, não evitá-la. A aprovação deste relatório não é autorização para apagar dados ou modificar autenticação/cadastros.

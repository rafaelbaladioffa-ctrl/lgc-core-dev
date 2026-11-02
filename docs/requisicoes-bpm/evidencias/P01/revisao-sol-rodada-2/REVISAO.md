# Revisão Sol — P01 / rodada 2

Data: 01/11/2026 (America/Sao_Paulo). Resultado: **AJUSTES NECESSÁRIOS; P01 NÃO ACEITO; P02 NÃO LIBERADO.**

Houve correções reais, mas a reentrega continua incompleta e introduziu uma regressão na permissão do solicitante. A falta de PostgreSQL não é o único impedimento. Este relatório avalia o código atual, preservando o relatório, reproduções e hashes da rodada 1 como histórico.

## Verificações desta rodada

- Executei a suite `src/request-runtime/p01-regression.spec.ts`: **4/4 passaram**. A primeira tentativa encontrou EPERM de rename na pasta temporária do sandbox; redirecionar TEMP/TMP para diretório de revisão gravável resolveu, sem instalar dependências ou elevar permissões. [Comando e resultado](verificacoes.md).
- Executei [dez verificações isoladas novas](checks.cjs), com fixtures explícitas para os métodos atuais; [resultados](results.json). Não usam PostgreSQL/HTTP/navegador. Incluem falhas atuais e confirmações de correções; não são o harness da versão anterior.
- Conferi os controllers, DTOs, runtime, configuração, fronteira legada, UI, helper de DB e migration. Nenhum código de aplicação ou dado foi modificado por Sol.
- Não houve evidência de integração PostgreSQL, concorrência real/restart, testes de componentes ou Playwright. A01–A24 ainda não foi reentregue com resultados por cenário.

Os quatro testes da implementação não comprovam o resumo inteiro da reentrega: o teste de submit chama validateFields com objeto vazio, sem executar submit; o de validação combina três entradas inválidas em uma única asserção (basta uma falhar); o de grafo tem apenas dois nós (não testa um grafo de quatro nós estruturalmente plausível mas não executável). Devem ser ampliados por comportamento/negativa, sem reduzir o gate de integração.

## Situação de cada achado anterior

| Achado | Situação atual |
|---|---|
| R01 envio / campos comuns | Corrigida a separação no método por inspeção; replay agora chega ao recibo com fixture válida. Jornada real continua não validada |
| R02 autorização | Parcial: consultas atuais adicionadas a alguns métodos e grants de edição/publicação. Leituras/submit ainda não revalidam conta/permissões; permissões de autor foram trocadas por executor indevidamente |
| R03 privacidade | Nota interna deixou de sair para autor sem vínculo e detalhe nega beneficiário no draft; listagem ainda inclui esse draft e fields não têm projeção |
| R04 legado | Listas/crons e getOrThrow passaram a filtrar/recusar BPM; create legado ainda escolhe versão BPM por ID e getPendingApproval não confere executor |
| R05 comandos/recibos | Parcial: route/request entraram no hash e replay mudou de posição em três comandos. Falta target de atividade, todos os escritores, retry estável no cliente e resposta correta |
| R06 estados/fila/tokens | Parcial: em_triagem, consumo/cancelamento de tokens e mudança de fila na execução foram acrescentados. Gestão exige indevidamente candidatura; atribuição/retomada ainda têm lacunas |
| R07 publicação | CAS de patch e validate melhoraram; tipos/arestas lineares são verificados. Phase/capabilities/políticas/metas continuam sem validação; proteção/pointer/atomicidade completos ausentes |
| R08 fila | Reinsert foi substituído por upsert, corrigindo a causa por inspeção. Falta teste real de edição/reativação e recuperação de incidente pela UI |
| R09 campos/anexos | Data/whitespace/escala de string e hash de bytes melhoraram; ownership no save/submit acrescentado. Precisão de decimal number/inteiro, limites, fontes, field access, substituição/limite concorrente continuam abertos |
| R10 SLA | Feriados passaram a ser copiados/usados; vetor básico confirmou correção. Segundos na borda de expediente, consumo/breach, IANA e meta configurada continuam incorretos/incompletos |
| R11 UI | Adicionado habilitar e envio do objeto fields; rota admin usa model. A interface ainda exige UUID/JSON, não possui tipos/seletores prometidos nem jornada completa |
| R12 contratos/migration | Código REQ e ano São Paulo foram corrigidos por inspeção. Paginação/header/erros/envelope e migration compatível/proteções continuam pendentes |
| R13 validação | Acrescentados quatro testes e helper, sem suite integrada/UI. Gate permanece aberto; helper não cumpre o sufixo aceito no pacote |

## B01 — P1: o solicitante comum não consegue mais salvar, anexar, comentar ou cancelar

Locais: `backend/src/request-runtime/request-runtime.service.ts:399–401`, `:1039–1041`, `:1212–1214`, `:1243–1245`; decorators dos respectivos endpoints no controller.

A consulta de permissão atual foi copiada com `request:update` para saveDraft/cancel/comment/attachment. O controller de draft/cancel exige create e o de comment/attachment exige comment. O perfil solicitante com create/read/comment passa pelo guard e é negado no serviço, embora seja autor e tenha direito a essas operações. T02 reproduz a falha de save antes de qualquer consulta ao draft.

Correção: uma política central distingue ação do autor, gestão e execução; saveDraft/cancel do autor usam create, comentários/anexos usam comment e acesso ao registro/documento, gestor usa a permissão/escopo da ação. Não conceder update a todos os solicitantes como contorno. Ações exibidas devem usar essa política. Testar cada operação com autor sem update e negar ator estranho. A04/A06/A15/A20.

## B02 — P1: revogação e confidencialidade continuam incompletas

Locais: `request-runtime.service.ts:426`, `:1110–1147`, `:1148–1211`, `:1288–1313`; `request-processes.service.ts:364–399`.

Submit/list/detail/download/timeline não chamam assertCurrentPermission; requestAccess não verifica conta ativa nem vínculo atual User↔Collaborator. Claims antigos ainda abrem conteúdo/submit e replay após revogação. Auditor grant expirado é filtrado no detalhe, porém permissões atuais de auditor/leitura não são conferidas. Listagem continua com OR beneficiaryId sem status diferente de rascunho, expondo código/título de draft que o detalhe corretamente nega. Detail retorna formData inteiro e anexos sem formAccess/document scope. T01/T08/T09 documentam esses caminhos.

Correção: revalidar identidade/permissões atuais para TODAS as superfícies e replay, usando contexto local BPM sem reescrever auth global. Compartilhar o predicado SQL e projeção de campo/documento; beneficiário só após envio. Testes com JWT antigo/conta desabilitada, draft na lista e campo hidden são obrigatórios. A14–A16/A21.

## B03 — P1: idempotência ainda falha no cliente e em parte dos comandos

Locais: `request-runtime.service.ts:272–293`, `:351–425`, `:611–617`, `:630–705`, `:873–1109`, `:1212–1287`; `frontend/src/features/requisicoes-bpm/BpmPages.tsx:18`.

O hash de claim/complete inclui só o Request.id, não activityId/método/rota completos. Mesma chave/corpo em outra atividade do mesmo Request pode receber recibo da atividade anterior (T04). Release/reassign consultam recibo mas não o criam após sucesso; close/cancel/create/save/comment/upload ainda não têm o protocolo completo. currentVersion do replay é a versão guardada (ou undefined em submit), não a atual (T01). A tela mantém commandKey fixo e sorteia commandId a cada clique; portanto o retry muda o hash e retorna IDEMPOTENCY_KEY_REUSED. Não há header Idempotency-Key.

Correção: executor único obrigatório para TODOS os comandos P01, hash canônico da rota completa e payload, chaves/resultados/versões corretos e persistidos na mesma tx. Preflight com acesso atual, depois replay, depois estado/versão sob lock; revalidar no tx em vez de usar registro de fora. Cliente conserva payload e key enquanto resultado da tentativa é desconhecido e só troca após nova intenção. Escrever regressões de replay para cada comando, dois IDs de atividade no mesmo Request, resposta perdida e concorrência. A07/A08/A10–A12/A16.

## B04 — P1: gestor não consegue gerir atividade e reatribuição aceita estados inválidos

Locais: `request-runtime.service.ts:619–629`, `:873–995`.

Release/reassign chamam activity antes de verificar gestão; activity exige que o ator esteja em candidates. Gestor exclusivo, que não deve executar a tarefa, é barrado antes de alcançar a checagem de manager (T03). Destino de reassign só é confrontado com membresia ativa, sem conta/colaborador/conflito, e candidatura não é atualizada. Depois o novo assignee pode ser recusado pelo mesmo activity. Reassign não valida estado e pode voltar atividade completed a claimed; Request/ProcessInstance podem continuar concluídos. Claim ainda não grava Request.assigneeId; cancel não termina atribuições abertas.

Correção: carregar atividade sem antecipar a decisão de autorização, autorizar comando por gestor/assignee/candidato conforme ação e validar origem/destino/status do ciclo dentro da tx. Terminal não reatribui/reabre por esse comando. Atualizar resumo, assignment e candidatura coerentemente. A09/A10/A13/A20 com gestor que não é executor e dois executores distintos.

## B05 — P1: uma categoria BPM ainda pode gerar requisição no executor antigo

Local: `backend/src/requests/requests.service.ts:85–91`, `:916–921`.

Filtrar o catálogo não fecha a criação por API. `RequestsService.create` consulta a categoria ativa e a última CategoryVersion sem filtro bpmStatus/format e cria execução legacy. Um cliente com categoryId BPM conhecido ignora runtimeEnabled/publicação pelo endpoint antigo. O helper de approvals também não recusa executor. A categoria BPM nasce active=true antes de habilitar.

Correção: validar formato/executor no ponto de criação/recategorização/importação e em TODOS os acessos diretos do legado; não depender apenas do portal. Manter categorias/versões legadas disponíveis, inclusive se futuramente houver versões de ambos os formatos na categoria. Testar API antiga com ID de processo BPM draft/desabilitado/publicado, e preservar criação legada normal. A22.

## B06 — P1: publicar ainda aceita definição que o runtime não executa

Locais: `request-processes.service.ts:445–509`, `:574–720`.

Tipos e arestas inválidos antigos passaram a ser negados, mas phase, capabilities, required policies, metas e configuração de campos não são validados. T06 usa quatro nós/tipos/arestas válidos, mas remove phase triage e exige capability não suportada com orçamento negativo; ainda retorna valid=true. assertOperational confere fila por type human, sem detectar a ausência da phase que submit procura. SLA alterado em definition não sincroniza os valores reais nas colunas usadas pelo runtime. Draft ainda tem publishedAt pelo default; ponteiro explícito e imutabilidade de banco continuam ausentes. createVersion continua fora de lock/incremento de categoria.

Correção: um contrato canônico aplicado no editor/validador/runtime. Validar todas as capacidades/form/policies/metas, e as duas phases únicas em P01. Snapshot publicado deve ser a fonte efetiva de regras/metas, imutável e selecionado por ponteiro. Completar proteções/CAS/lock de categoria e testes de publicação/clone simultâneos. A02/A03/A17. Não reduzir a regra a contagem de nós.

## B07 — P1: campos e SLA permanecem parcialmente validados

Locais: `request-runtime.service.ts:53–81`, `:149–213`, `:1148–1211`, `:1243–1287`.

T07 confirma que decimal como number com mais de quatro casas, decimal com mais de 15 inteiros, inteiro inseguro e texto acima de maxLength são aceitos. Select ainda não implementa `{id,label}`/fontes do contrato; campo oculto/read não é aplicado. Upload continua sem versionar substituição, soma limite fora da tx e não exige versão esperada.

Feriado básico foi corrigido (T10). Porém ao somar 1 minuto a sexta 06/11/2026 17:59:45 local, o cálculo vence 18:00:45 na sexta, fora do expediente; deveria segunda 09/11 08:00:45 (T05, calendário sem feriado). O algoritmo usa só hora/minuto, offset fixo, não consumo em segundos/intervalos. elapsedSeconds/breachedAt continuam sem atualização/projeção útil. P01 exige essa base; não transferir ao P05.

Correção: validação estrita por tipo/limite e política de campo/documento, upload no executor comum; relógio com IANA/snapshot, segundos e projeção de consumo/violação. Testar limites individualmente e os vetores de calendário, inclusive segundos/virada de expediente. A05/A06/A19/A21.

## B08 — P1: as superfícies obrigatórias continuam ausentes, apesar do resumo de entrega

Local: `frontend/src/features/requisicoes-bpm/BpmPages.tsx:12–18`, `api.ts`.

O código ainda contém inputs “Setor (UUID)” e “Membros (UUID separados por vírgula)”, campos de triageQueueId/executionQueueId digitáveis e textarea JSON para versão. Não há editor estruturado de campos/formulário nem seletores seguros de setor/membros/gestor/publicador. O botão habilitar foi acrescentado, mas criar processo pela UI não seleciona publisherUserIds e criar fila não seleciona managers; não se fecha a jornada de publicar e encerrar por UI.

Campos novos são todos inputs de texto e enviam strings, de modo que boolean/integer/attachment não têm valor válido pelo próprio validador. Não há editar/retomar/autosave do draft, upload visual, prévia, clone v2, inbox/fila completas, recuperação de incidente, comentários/anexos/timeline/SLA no detalhe nem cancel/release/reassign visíveis. O payload fields é enviado agora, mas isso não entrega os tipos e a jornada. Também faltam estado em voo, retry consistente, acessibilidade e erro de conflito com dados preservados.

Correção: entregar a jornada P01 especificada, com formulários e seletores, sem canvas de P06. Use uma checklist de tela/ação, confira o código efetivamente escrito antes de declarar o recurso entregue e demonstre com personas. Nada disso depende de banco para escrever componentes e testes. A01/A04/A06/A09/A17/A18/A20/A23.

## B09 — P2: helper, migration e evidências não fecham o gate

Local: `backend/test/support/bpm-test-database.ts`; migration P01; documentos de evidência.

O helper exige nome exatamente `_bpm_test`, enquanto o pacote exige sufixo `_bpm_test` em banco dedicado; rejeita, por exemplo, `review_bpm_test`. Também não valida protocolo postgresql/postgres e o IPv6 hostname normalizado merece teste explícito. Não há ainda suite de API/Postgres/failpoint/restart ou frontend/Playwright/configuração correspondente. A migration continua com cascades operacionais, sem proteções/checks e índices declarados no schema. Não foi ensaiada em banco dedicado.

Correção: completar guard e suites com fixtures próprias, validar migration↔schema e produzir A01–A24 por cenário. Registrar integração “não executada por infraestrutura” separadamente de “recurso não implementado” ou “teste não escrito”. R12 da rodada anterior (paginação/erro/header/envelope) permanece obrigatório. Não pedir permissão para reduzir pacote; concluir todo o trabalho independente e só então indicar eventual necessidade concreta de ambiente.

## Próxima execução: marcos internos do mesmo P01

Não são pacotes novos e não liberam P02:

1. **Política e comandos:** B01–B05 com testes de cada operação do autor/gestor, revogação em leitura/escrita e replay completo. Eliminar cópias inconsistentes de permissão/receipt. Entrega parcial é checkpoint de implementação, não “P01 concluído”.
2. **Definição, dados e SLA:** B06/B07/B09, preservando correções já confirmadas e o trabalho local do usuário.
3. **Jornada completa:** B08, componentes/testes e evidências visuais; depois validar Postgres/restart/concorrência e A01–A24 em ambiente dedicado.

Na resposta ao relatório, classificar cada B01–B09 como corrigido com evidência, ainda em implementação ou impedido por causa concreta. Não afirmar “seletores/edição estruturada entregues” enquanto o código pede UUID e JSON. Sol não fará alterações concorrentes na aplicação. Não houve nova decisão de negócio impeditiva.

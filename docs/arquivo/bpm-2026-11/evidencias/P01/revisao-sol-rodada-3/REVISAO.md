# Revisão Sol — checkpoint 3 de P01

Data: 02/11/2026 (America/Sao_Paulo). Resultado: **checkpoint revisado; continuar implementação de P01. Sem aceite do pacote e sem liberação de P02.**

O relato desta rodada distingue corretamente checkpoint de conclusão. Há avanços confirmados, mas a jornada padrão de configuração ainda não funciona e permanecem controles de backend incompletos. Este relatório é incremental: os critérios do pacote e os itens ainda abertos das rodadas anteriores continuam valendo.

## O que foi verificado

- Suite da implementação executada por Sol, com TEMP/TMP em pasta gravável de revisão: **9/9 testes passaram**, 1 arquivo, exit code 0. [Saída real](vitest-output.txt). A pasta temporária gerada foi removida após verificar seu caminho absoluto dentro deste diretório.
- [Oito verificações novas](checks.cjs), com fixtures atuais incluindo User.collaboratorId e permissões efetivas. [Resultados](results.json). São chamadas de métodos reais com armazenamento sintético; não são integração HTTP/PostgreSQL. C02/C08 incluem inspeção da projeção/contrato de fonte e do SQL.
- Inspeção de serviços, DTOs/controllers, UI, fronteira legada, schema e migration. Sol não alterou aplicação ou dados, não executou migration/seed nem iniciou servidor.

Os scripts antigos permanecem históricos. Não uso erro de mock desatualizado como prova de defeito atual. Igualmente, nove testes de validação sem cenários de User/grant/comando não provam os fluxos de autorização/replay. Os novos casos abaixo isolam o código atual.

## Correções confirmadas, sem equivaler a homologação integrada

- saveDraft usa create e comentário/anexo usam comment; leituras/submit agora consultam conta, vínculo e permissões atuais. C07 confirmou leitura recusada para conta desabilitada. As permissões do gestor e conflitos de atribuição ainda precisam da matriz completa.
- Beneficiário deixou de entrar no OR de drafts na listagem; o bypass antigo de modelador sobre instâncias não foi reintroduzido. O filtro hidden passou a remover valores do DTO, mas ainda sem contexto por ator/etapa/documento.
- Métodos de gestão carregam atividade sem exigir candidatura; claim atualiza assignee resumido; reassign faz verificação de terminal e cria candidatura. Ainda falta aplicar elegibilidade/conflitos do destinatário.
- Criação legada passou a filtrar bpmStatus=null e helper de aprovação recusa BPM. Falta a evidência API/job e casos mistos exigidos por A22.
- Claim/complete passaram a incluir activityId no hash; replay consulta versão atual. Release/reassign receberam persistência de recibo, mas consulta e gravação usam payloads diferentes (C03).
- Negativas de precisão/inteiro seguro/maxLength e metadata de definição foram ampliadas. O vetor de segundos da borda de expediente foi corrigido: C07 obteve segunda 09/11/2026 08:00:45 local.
- UI passou a ter seletores e editor de campos em vez do textarea JSON; o backend gerador e o contrato do seletor de publicador ainda impedem publicar um processo novo por esse caminho.

## C01 — P1: definição criada pela aplicação é rejeitada pelo próprio validador

Local: `backend/src/request-processes/request-processes.service.ts:294–332`, `:457–469`; editor em `frontend/src/features/requisicoes-bpm/BpmPages.tsx:22–24`.

O gerador `definition()` ainda produz `policy: {internal:true}`. `validateDefinition()` agora exige confidentiality=interna, requiresAcceptance=false, allowRepresentation=false e closure.mode=manual. Chamar o gerador real e validar sua saída retorna `valid:false`, `policy: Política P01 inválida` (C01). O editor só altera form e não oferece como reparar essa política. Portanto o processo recém-criado pela UI não pode ser validado/publicado.

Correção: gerar o snapshot P01 completo e canônico desde createProcess/createVersion/template. Não afrouxar o validador para aceitar configuração antiga incompleta. Acrescentar teste POSITIVO “definição padrão gerada passa no validador”, depois create → editar campo → validate → publish → enable. Manter drafts já existentes legíveis e tratar eventual normalização explicitamente, sem escrever em versões publicadas.

## C02 — P1: publicador selecionado tem ID de colaborador no campo de usuário

Locais: `request-processes.service.ts:142–145`, `:248–292`; `BpmPages.tsx:13–20`; FK ProcessConfigGrant.userId no schema.

`listCollaborators` retorna `{id,fullName,sectorId}` de Collaborator, sem User.id. O select Publicador usa p.id como valor e envia para publisherUserIds. Quando User.id difere de Collaborator.id, a criação do grant aponta para chave inválida em users. A categoria/versão é criada ANTES de createMany dos grants e fora da mesma transação; a falha deixa configuração parcial sem o grant esperado e o retry pode bater em código duplicado.

Correção: fonte segura de candidatos com `userId` e `collaboratorId` explicitamente distintos; o seletor de membro usa collaboratorId, o de publicador usa userId e verifica a permissão atual de publicação. Setor deve ter nome/código de negócio, não UUID como rótulo. Criar categoria/versão/grants/evento/receipt na mesma tx. Testar pessoas com IDs distintos e falha de grant sem categoria órfã. Não solucionar fazendo os IDs artificiosamente iguais nem concedendo leitura geral de usuários.

## C03 — P1: recibo de release/reassign continua incompatível com seu replay

Locais: `request-runtime.service.ts:930–1006`, `:1007–1096`.

Os dois métodos consultam receipt com `{...dto,requestId}` e gravam requestHash de `{...dto,requestId,activityId}`. O retry legítimo encontra um hash diferente e gera IDEMPOTENCY_KEY_REUSED. C03 chama reassign com recibo no exato formato persistido e reproduz o conflito. Em release a pré-condição de claimed também continua antes da consulta, impedindo replay após a primeira liberação.

Correção: construir contexto canônico uma única vez e usar o MESMO valor para consultar/gravar; incluir método/rota/IDs. Preflight de acesso atual, depois lookup de recibo, depois estado mutável sob lock. Não manter essa regra duplicada em cada método: o executor comum do pacote resolve a classe de inconsistência. Completar ainda create/saveDraft/close/cancel/comment/upload/admin, header UUID, appliedVersion e retorno conforme contrato. Testar cada replay após resposta perdida, com IDs de atividade diferentes e após alterações posteriores autorizadas.

## C04 — P1: gestão permite atribuir ao próprio solicitante em conflito

Local: `request-runtime.service.ts:1007–1096`.

Reassign aceita qualquer membro ativo da fila, sem excluir requester/beneficiary, conferir conta/colaborador ativo ou reavaliar a política de conflito. C04 usa gestor autorizado, solicitante que também é membro da fila e política P01 de executor independente: a atribuição ao solicitante é persistida. Como o método cria ActivityCandidate, o atalho também abre o caminho para o autor executar uma tarefa da qual o resolvedor normal o excluiria.

Correção: usar o MESMO resolvedor de elegibilidade/conflito em ativação, claim e reassign; papel de gestor não supera segregação. Permissão de assign e escopo devem corresponder à ação. Testes: autor, beneficiário, desligado/afastado, usuário desabilitado, membro removido e membro elegível; negar destinos inválidos sem mudar assignment/candidato/versão. Não basta a conta do gestor estar ativa.

## C05 — P1: metas validadas no snapshot não definem os clocks reais

Locais: `request-processes.service.ts:694–752`; `request-runtime.service.ts:574–610`, `:1253–1320`.

Patch/validação aceitam definition.sla, mas publicação não sincroniza a representação efetivamente usada e submit lê CategoryVersion.slaFirstResponseMinutes/slaResolutionMinutes. C05 configura 10/20 minutos no snapshot e cria clocks de 240/2.880 minutos. Os prazos exibidos não correspondem à regra publicada. Consumo/checkpoints/intervalos/violação também continuam sem implementação completa: elapsedSeconds e breachedAt são apenas retornados das colunas sem consumo útil atualizado.

Correção: snapshot publicado é a fonte de verdade do runtime; se colunas forem mantidas para legado/índice, derivá-las na mesma publicação e comprovar consistência. O builder P01 precisa permitir editar as duas metas. Completar consumo/stop/projeção de breach em segundos usando calendário/IANA/snapshot conforme pacote. Testar meta não padrão em instâncias v1/v2, sem modificar clocks anteriores. Não transferir o SLA básico ao P05.

## C06 — P1: ocultar campo ainda não protege seu documento

Locais: `request-runtime.service.ts:154–172`, `:1253–1320`, `:1397–1405`.

`projectFields` junta todos os hidden de todos os nós e oculta para todos os atores, sem saber qual atividade/papel está sendo projetado. Isso pode retirar do autor/executor um dado que só deveria ser oculto na triagem. Mais grave: anexos continuam listados/baixados apenas pelo acesso ao registro. C06 usa triador ativo, tarefa de triagem e documento cujo fieldKey está hidden nessa etapa; download retorna o conteúdo mesmo assim.

Correção: projeção contextual por ator/atividade e política de campo/documento compartilhada por leitura, escrita, anexos, timeline e allowedActions. Hidden não sai nem por nome/ID/conteúdo de arquivo; read não aceita patch. Testar autor e duas etapas com permissões diferentes, incluindo URL direta de download e troca de documento. Não resolver ocultando tudo para todos nem confiando na UI.

## C07 — P1: publishedAt difere entre schema, SQL e caminho de criação

Locais: `backend/prisma/schema.prisma:567`; migration P01; createProcess/createVersion.

Schema foi alterado para nullable e perdeu default, mas a migration não altera published_at do banco, originalmente NOT NULL com default now. O caminho BPM não escreve publishedAt:null. Assim a alteração de schema não representa a migration nem garante draft sem publicação. C08 registra essa divergência; não foi necessário aplicar migration para identificá-la.

Correção compatível já definida em 03-modelo-dados: `DateTime? @default(now())` preserva os produtores legados; migration torna a coluna nullable preservando o default; criação BPM escreve explicitamente null; publish define data/autor. Completar ponteiro e imutabilidade de versão/histórico/constraints sem cascades operacionais já solicitados. Ensaiar migration↔schema em Postgres dedicado antes de usar no ambiente de desenvolvimento. Sol não aplicará migrations nesta revisão.

## Trabalho que permanece aberto, sem nova decisão de negócio

O próprio checkpoint reconhece inbox/fila, upload, autosave/retomada, comentários/timeline/SLA, incidentes e comandos visuais pendentes. Acrescentar também: tipos corretos dos inputs (novo pedido ainda envia todos como strings), opções/fontes/limites no editor, preview/clone v2, close/aceite manual conforme política, estados em voo/retry consistente e dados preservados em conflito. Esses itens são implementação autorizada de P01.

Harness de UI, testes de componentes e suites API/DB são trabalho do pacote, não infraestrutura externa ausente. Escrever e executar o que independe de Postgres; preparar o restante com fixture/helper/configuração. Somente disponibilidade real do servidor/navegador pode permanecer como impedimento externo após isso. A01–A24 não foi dispensado.

## Próximo marco de implementação

1. Corrigir C01/C02 primeiro e adicionar o teste positivo de configuração padrão com User.id diferente de Collaborator.id. Comprovar que o que a UI gera é aceito pelo backend.
2. Consolidar comandos/política para C03/C04/C06 e os escritores ainda fora do protocolo. Testar sucesso e negação, não só validação de formato.
3. Fechar C05/C07 e continuar as telas/suites pendentes do mesmo P01. Não avançar P02, não chamar checkpoint de pacote concluído e não reduzir aceite.

Enviar checkpoint por marco com lista explícita de implementado/testado/não executado, ou reentrega completa quando a jornada estiver pronta. Este relatório não reinicia o trabalho nem desfaz as correções confirmadas. Sol mantém apenas documentação/evidências e não edita aplicação em paralelo.

# Revisão Sol — checkpoint 4 de P01

Data: 02/11/2026 (America/Sao_Paulo). Resultado: **avanço de C01/C02 confirmado em código e testes isolados; continuar P01. Sem aceite final e sem liberação de P02.**

## Evidência executada

Executei a suite da implementação com o mesmo ajuste local de TEMP/TMP usado nas revisões anteriores: **12/12 testes passaram**, 1 arquivo, exit code 0. [Saída real](vitest-output.txt). O teste chamado “configures a process atomically” confirma uso do cliente transacional com mock e IDs distintos; rollback/constraints reais ainda exigem PostgreSQL.

Executei [cinco verificações independentes](checks.cjs), usando métodos atuais e fixtures com vínculo/permissão atual válidos; [resultados](results.json). D01/D02 confirmam os dois avanços centrais, D03–D05 demonstram inconsistências ainda existentes. Não usei falhas de mocks de versões anteriores como prova atual.

Sol só escreveu documentação/evidências. Não alterou aplicação, não aplicou migrations/seeds e não iniciou servidor/banco/navegador.

## O que pode ser encerrado neste marco de correção

- **C01:** gerador passou a produzir política P01 canônica; a definição gerada é aceita pelo próprio validador. Teste positivo confirmado em Vitest e D01. Não precisa reabrir esse conserto.
- **C02:** o caminho real do diretório retorna userId e collaboratorId distintos, a UI usa o ID correto para cada seleção, createProcess valida publicador e grava categoria/versão/grants dentro da mesma transação. Testes com IDs diferentes confirmados e D02 confere o DTO atual. Atomicidade em banco, UX do seletor e criação/publicação pela UI continuam dentro de A01/A12.
- **C03:** inspeção confirma contexto com activityId igual na consulta/gravação de release/reassign e replay antes das pré-condições desses comandos. Protocolos dos demais escritores ainda não foram entregues; não fechar R05 inteiro.
- **C04:** reassign agora exclui requester/beneficiary e consulta conta/colaborador ativo. Isso corrige o vetor de atribuição conhecido; a matriz de claim/remoção/revogação ainda exige testes de serviço/API.
- **C05:** submit usa definition.sla para criar os budgets, eliminando a divergência 10/20 versus 240/2.880. Consumo/intervalos/checkpoints/breach e exibição ainda estão abertos.
- **C07:** schema preserva default now e aceita null; migration altera a coluna; criação BPM grava null. Conferido por inspeção, sem ensaio do SQL em banco.
- **C06:** filtro de anexo para hidden no nó corrente foi acrescentado. Não equivale ao fechamento da política de campo/documento, pelos casos abaixo.

## D03 — P1: resposta de salvar rascunho ignora a projeção de campos

Local: `backend/src/request-runtime/request-runtime.service.ts:452–484`.

Detail aplica projectFields, mas saveDraft devolve o modelo bruto de `request.findUniqueOrThrow`. D03 usa um campo que a própria projeção atual esconde, modifica apenas título e recebe esse valor em formData na resposta do save. Além disso, validateFields verifica tipo, não o modo write/read/hidden do ator; um campo conhecido continua editável por patch mesmo se a configuração o torna somente leitura.

Correção: respostas de comandos usam o mesmo DTO autorizado da leitura; nenhuma resposta retorna o modelo Prisma bruto. Aplicar política de escrita antes de persistir o patch e rejeitar campos não editáveis, sem mutação parcial. Testar o mesmo ator em GET, PATCH de outro campo e PATCH do campo protegido. Não substituir isso por ocultação apenas no React.

## D04 — P1: cancelamento do gestor ainda depende da permissão de solicitante

Locais: `request-runtime.service.ts:1203–1205` e controller de cancel.

Foi corrigido o lado do autor, mas cancel exige create globalmente, no controller e no serviço. Um gestor de fila com read/update/assign e sem create é recusado antes de conferir gestão, embora P01 permita cancelar execução simples sem efeito externo. D04 reproduz a negativa.

Correção: uma política de ação permite cancelamento pelo autor com create no seu recorte OU pelo gestor com permissão de gestão no escopo. Não exigir que todo gestor também seja solicitante, nem conceder update a todos os autores. Decorator/controller e serviço precisam da mesma regra; allowedActions deve refletir a decisão. Testar autor, gestor, executor sem gestão e estranho, com/sem motivo e em cada fase.

## D05 — P1: os dois mascaramentos discordam sobre campo e documento

Locais: `request-runtime.service.ts:154–183`, `:1470–1480`.

ProjectFields considera formAccess global e a união de hidden de todos os nós; attachmentVisible considera apenas o primeiro nó ativo. D05 usa uma regra global que o sistema já aceita/interpreta e obtém campo oculto, mas documento visível. Em outras fases a união também pode ocultar de todos um dado que só era protegido numa etapa.

Correção: uma única função de política recebe ator, participação, atividade e campo/documento e é reutilizada por projeção, escrita, anexos, timeline e ações. Sem atividade ativa, usar política explícita de leitura terminal/draft, não liberar documentos por ausência de nó. Se uma configuração de acesso não for suportada, negar publicação explicitamente; não aceitá-la em um ponto e ignorá-la em outro. Testar campo/anexo no draft, triagem, execução e terminal, com autor e equipe.

## Limpeza necessária: não adaptar aplicação para um mock antigo

Local: `backend/src/request-processes/request-processes.service.ts:144–155`.

Foi acrescentado um fallback `typeof prisma.user.findMany !== 'function'` para listar colaboradores sem userId. PrismaService real tem esse método; esse ramo não é um contrato de produção suportado e deixa o diretório variar conforme a completude de uma dependência/mocked client. Remover o fallback e manter mocks atuais na suite. Os arquivos de revisão históricos não precisam passar em todas as versões e não justificam alterar comportamento da aplicação.

## Próximo marco: jornada completa de P01 e protocolo comum

Não basta uma nova rodada de correções isoladas seguida de relato de “implementação concluída”. O próximo marco deve continuar os pontos já autorizados abaixo, sem recomeçar C01/C02:

1. **Política e comandos:** fechar D03–D05; protocolo único também para criar/salvar/fechar/cancelar/comentar/anexar/configurar, com Idempotency-Key, versão esperada, replay, locks e eventos. Escrever testes de cada comando antes de relatar fechamento. As suites continuam sem demonstrar esses cenários.
2. **Rascunho e formulário por UI:** tipos corretos, campos/valores/erros, upload/download/substituição, salvar/retomar/editar/autosave, revisão/envio e retry com payload preservado. O novo pedido ainda renderiza todos os tipos como input string; o detalhe não permite editar draft.
3. **Atividades e detalhe por UI:** inbox/fila, assumir/executar/liberar/reatribuir, cancelar/encerrar, comentários/timeline/SLA e incidente resolvível. O close manual não está disponível na tela atual; não fechar P01 sem o percurso completo.
4. **Administração e versões:** nomes de setores, filas filtradas e membros/gestores editáveis; opções/fontes/limites e metas; prévia, clone v2 e leitura imutável; ações conforme permissões. Validação deve mostrar erros por campo/nó.
5. **Validação executável:** acrescentar suites de componentes/jornada e preparar a suite PostgreSQL protegida, incluindo duas conexões, rollback/restart, fronteira legacy e v1/v2. Helper não equivale a harness pronto. Harness/UI/suites são trabalho de implementação, não dependência externa. Só execução contra PostgreSQL realmente indisponível pode ficar impedida após prepará-los.

A migration ainda precisa de imutabilidade/constraints/preservação de histórico e ensaio; métricas de SLA ainda não têm consumo/breach. Paginação, contrato de erro/ETag e A01–A24 continuam obrigatórios. Não foi criada nova dúvida de negócio. Nenhuma mudança de produção/dados foi autorizada por esta revisão.

Próximo retorno deve trazer uma checklist de jornada realmente entregue e testes da política/comandos, ou checkpoint explicitamente parcial. P01 segue em implementação; P02 não começa.

# Reconstrução de Requisições do Axis

Data do projeto: 01/11/2026 (America/Sao_Paulo). Revisão: projeto 1. Status em 02/11/2026: piloto P01 atualizado no ambiente existente após backup e ensaio em cópia. Processo P01-PILOTO v2 disponível; menu e formulário conferidos na sessão existente. Validações registradas: 20 testes DOM, 48 de backend e 4 PostgreSQL. Aceite integral A01–A24 permanece aberto; P02 não liberado. [Implantação](evidencias/P01/DEPLOY-PILOTO-EXISTENTE.md).

Este diretório é a especificação executável de trabalho para substituir o módulo de Requisições. Não é evidência de funcionalidade implementada. Na etapa inicial de projeto, aplicação, migrations, seeds e dados não foram modificados por Sol; as entregas posteriores de Luna e suas revisões estão registradas em evidencias/.

## Ordem de leitura

1. [Coordenação e limites](COORDENACAO.md).
2. [Arquitetura e decisão do motor](01-arquitetura.md).
3. [Regras, transições e autorização](02-regras-autorizacao.md).
4. [Modelo de dados e preservação](03-modelo-dados.md).
5. [Contratos HTTP e comandos](04-contratos-api.md).
6. [Telas, formulários e publicação](05-telas-publicacao.md).
7. [SLA e Logística](06-sla-logistica.md).
8. [Backlog e validação](07-backlog-validacao.md).
9. [P01 pronto para Luna](pacotes/P01-processo-simples.md).
10. [Decisões e questões de negócio](08-decisoes-negocio.md).

## Resultado pretendido

Um administrador configura formulário, responsáveis, condições e prazos; testa e publica. Usuários recebem atividades executáveis com ações determinadas pelo servidor. Gestores identificam pendências e gargalos. Publicar outra versão não altera instâncias anteriores. Compras e os demais processos usam o mesmo motor, com ações de domínio registradas, sem comparação por nome de categoria.

O primeiro ciclo de entrega é P01–P08. P09 amplia o catálogo e P10 cuida de extensões explicitamente adiadas. Cada pacote inclui persistência, backend, frontend e verificações do comportamento entregue. Build isolado não conclui pacote.

## Precedência e conflitos resolvidos

- A instrução atual permite substituir Requisições e preserva autenticação, cadastros e outros módulos; não autoriza apagar dados existentes.
- Decisões explícitas de usuário em `REQUISICOES_SPEC.md`, §27, prevalecem sobre recomendações conflitantes do diagnóstico: BYTEA sem antimalware real por ora; níveis hierárquicos ausentes pulam, inclusive cadeia vazia no topo. A arquitetura delimita e audita essa exceção; não a transforma em permissão para ignorar centro de custo ausente, erro de integração ou matriz inexistente.
- `PLANEJAMENTO_REQUISICOES_BPM.md` é diagnóstico estático e proposta anterior. Substituímos sua sequência de reparar todo o motor legado antes do novo por substituição aditiva e piloto isolado. Nenhum dado ou execução antiga é descartado.
- Este pacote fecha escolhas técnicas; propostas de negócio ainda não homologadas estão identificadas em `08-decisoes-negocio.md`. Não são apresentadas como decisões já tomadas pela LGC.

## Evidências locais consideradas

`backend/AGENTS.md`, os dois documentos raiz, schema Prisma, módulos Requests/RequestCategories/Auth/RBAC/Integration, páginas e cliente HTTP, diferenças locais e adaptadores de Logística. Stack observada: NestJS/Prisma 5.22, PostgreSQL 16 no compose, React/Vite. Não houve conexão a banco, inspeção de dados reais ou execução de testes da aplicação. Os seeds descrevem configuração proposta, não comprovam dados carregados.

Baseline inicial: 32 arquivos rastreados modificados (634 inserções/51 remoções no diff resumido), além de arquivos não rastreados. Entre eles estão schema, compras, papéis, centro de custo, formulário compartilhado, proxies e catálogo Logística. Antes de qualquer implementação, Luna deve atualizar esse inventário; contagem não é mecanismo de proteção. Não usar reset/checkout para limpar o trabalho.

## Encaminhamento do primeiro pacote

Após a entrega do projeto, o usuário autorizou o envio direto ao Luna. A orientação para iniciar somente P01 foi enviada ao chat de implementação; isso confirma o encaminhamento, não a conclusão ou validação do pacote. Questões de alçada, compra e grupos restritos não impedem o processo simples interno de P01. Identificadores dos chats e protocolo de revisão estão em `COORDENACAO.md`.

Luna entregou estrutura inicial e relato de limitações. A [primeira revisão de Sol](evidencias/P01/revisao-sol/REVISAO.md) identificou defeitos de execução/autorização e recursos obrigatórios ausentes, com nove reproduções isoladas. P01 precisa de correção e nova entrega; a indisponibilidade de banco não é o único impedimento.

A [segunda revisão de Sol](evidencias/P01/revisao-sol-rodada-2/REVISAO.md) confirmou avanços e executou os quatro testes fornecidos (passaram), mas dez verificações independentes da versão atual e a inspeção da jornada mantiveram o pacote sem aceite. A resposta deve tratar B01–B09 com evidências; funcionalidades ausentes não devem ser declaradas concluídas.

A [revisão do checkpoint 3](evidencias/P01/revisao-sol-rodada-3/REVISAO.md), em 02/11/2026, confirmou os nove testes fornecidos e correções adicionais. Permanecem bloqueios de configuração padrão, identidade do publicador, replay/segregação, SLA e documentos, além das telas/suites reconhecidamente pendentes. Continuar no mesmo P01.

Na [revisão do checkpoint 4](evidencias/P01/revisao-sol-rodada-4/REVISAO.md), os 12 testes fornecidos passaram e os vetores específicos de C01/C02 foram encerrados em código/testes isolados. Continuam inconsistências da política/respostas de comandos, documentos e cancelamento gerencial, além da jornada visual/protocolo/suites. O próximo marco deve completar esses percursos, sem reiniciar correções já verificadas.

A [revisão do checkpoint 5](evidencias/P01/revisao-sol-rodada-5/REVISAO.md) confirmou melhorias de projeção/download e cancelamento gerencial, mas encontrou perda de campo protegido no patch, combinação incorreta de papel/permissão e data de breach incorreta. BpmPages.tsx permaneceu igual ao checkpoint anterior; o próximo marco exigido é o percurso real de rascunho com componentes e testes.

Na [revisão do checkpoint 6](evidencias/P01/revisao-sol-rodada-6/REVISAO.md), 14 testes backend e sete asserções auxiliares frontend passaram. DynamicForm foi integrado à abertura; o hook de autosave ainda não está ligado à edição e permite saves concorrentes. O próximo marco continua sendo o percurso utilizável de draft e testes reais de componentes, sem substituir jornada por helpers.

## Verificação da entrega documental inicial

- Conferidos links locais, pares de blocos de código e sintaxe dos exemplos JSON dos 11 documentos; sem falhas nessas verificações.
- Comparados hashes SHA-256 dos 545 arquivos preexistentes capturados antes da escrita: nenhum alterado ou removido. Somente documentos neste diretório foram acrescentados.
- Nenhum teste/build da aplicação foi executado; nenhuma migration/seed foi gerada ou aplicada; nenhum container foi iniciado. Gates do motor e testes A01–A24 são trabalho futuro de P01, não resultados desta revisão.

# Revisão Sol — checkpoint 6 de P01

Data: 02/11/2026 (America/Sao_Paulo). Resultado: **scaffolding do formulário avançou; percurso de rascunho continua incompleto. P01 sem aceite; P02 não liberado.**

## Evidência confirmada

- Suite backend executada por Sol: **14/14 passaram**, incluindo regressões de merge protegido e deadline de breach. [Saída real](vitest-output.txt). A consulta de cancelamento usa agora os pares autor/create e gestor/update por inspeção; a matriz completa de serviço/API ainda precisa de testes.
- `npm run test:journey` executado por Sol: **sete asserções passaram**. [Saída](frontend-contract-output.txt). O arquivo chama somente coerceBpmValue/mergeDraftFields: são contratos unitários auxiliares, **não teste de jornada/componente**. Não há DOM, hook, interação, API, persistência, erro de rede, 409, upload ou retomada sendo exercitados.
- DynamicForm passou a ser usado na abertura e apresenta checkbox/select/date/textarea/number. O campo attachment ainda chama um callback que só exibe “Upload pendente”; não faz upload nem guarda IDs.
- useDraftAutosave foi declarado em DynamicForm.tsx, mas não é utilizado na página de edição/detalhe, que continua sem editor de draft. Não existe arquivo separado useDraftAutosave.ts; organização no mesmo arquivo é possível, mas a integração funcional não pode ser substituída pela declaração do hook.
- Sol só escreveu revisão/evidências e executou verificações isoladas. Nenhuma migration/seed/banco/servidor foi acionado.

## F01 — P1 antes de integrar: autosave não serializa chamadas

Local: `frontend/src/features/requisicoes-bpm/DynamicForm.tsx`, função useDraftAutosave.

O hook tem debounce, mas não tem controle de requisição em voo. Uma segunda edição agenda outro timer enquanto o primeiro save aguarda a rede. Quando o segundo timer vence, dispara outro save com a mesma version.current; ambas as chamadas só incrementam a versão após suas respostas. A primeira resposta também pode marcar saved enquanto ainda existem alterações/gravações pendentes.

[Reprodução do agendamento](autosave-check.cjs), com o código atual e primitivas React/timers controlados: [resultado](autosave-result.json) mostra duas chamadas simultâneas com version=0; o máximo permitido é uma. Este harness não é teste de React DOM e não substitui o teste do hook integrado. O caso corresponde a uma rede mais lenta que o intervalo entre duas edições.

Correção: fila serial/coalescida, snapshot da tentativa em voo, alterações novas retidas para o próximo envio, versão retornada pelo servidor e estado salvo somente quando nada ficou pendente. Em 409, interromper a fila e preservar os valores para resolução; em resposta perdida, repetir a mesma intenção com key/payload estáveis. Não resolver simplesmente ignorando schedule durante saving, pois isso perderia edições. Prever troca de requestId/versão inicial e desmontagem.

Teste obrigatório com React/hook e timers controlados: manter primeira resposta pendente, editar novamente e avançar debounce; verificar uma chamada até a primeira terminar, segunda chamada com versão atual e valores mais recentes, nenhuma indicação saved prematura. Cobrir 409, falha de rede, retry, troca de draft e edição durante resposta.

## Próxima entrega do marco: tela utilizável, não mais apenas scaffolding

Continuar no mesmo P01 e completar antes do próximo relato de percurso entregue:

1. **Schema de draft acessível ao autor**, vinculado à versão fixa e filtrado por permissão, no DTO normal do registro. Não carregar schema pela API administrativa nem trocar v1 pelo catálogo v2.
2. **Editor de retomada/detalhe** usando DynamicForm e dados reais, title/description, PATCH com merge protegido, salvar manual e autosave serializado corrigido. Tela mostra pendente/salvando/salvo/erro/conflito e preserva o que foi digitado.
3. **Upload real** após criar draft: persistir BYTEA, guardar IDs no campo, mostrar arquivos/versões, baixar autenticado e substituir preservando versão anterior. Remover callback de placeholder quando integrar; obrigatório não é satisfeito só por selecionar arquivo.
4. **Revisar/enviar uma vez**, com key/payload estáveis no retry e formulário bloqueado/confirmado conforme estado. Corrigir retorno de 409 sem sobrescrever automaticamente.
5. **Runner de componentes e DOM configurado**, com testes de renderização/interação e API simulada. Os sete asserts auxiliares podem permanecer como unitários, mas não contam como essa entrega. Testar false/zero/decimal/date/select, retomar v1, campos protegidos, uploads, primeira resposta pendente, 409 e resposta perdida. Listar os comandos e o que realmente executou.

Este trabalho está autorizado pelo P01 e independe de servidor PostgreSQL para ser escrito e testado com API simulada. Não registrar “harness pendente por infraestrutura” quando a configuração/suite ainda não foi implementada. API simulada comprova UI; a integração real continuará sendo um gate posterior obrigatório.

## Escopo que permanece intacto

Após o marco de rascunho, continuar inbox/fila, gestão e detalhe completos, comentários/timeline/SLA/incidentes/close, administração de campos/opções/fontes/metas/preview/clone, protocolo de TODOS os escritores/header/locks/contratos/paginação, proteção/ensaio de migration, Postgres/restart/concorrência, jornada visual real e A01–A24. Não avançar P02 nem declarar P01 concluído por build ou por testes auxiliares.

As correções anteriores confirmadas não precisam ser reiniciadas. Próximo checkpoint deve apontar telas/componentes/testes executáveis e o roteiro efetivamente utilizável. Sol mantém apenas documentação/evidências, sem editar aplicação em paralelo.

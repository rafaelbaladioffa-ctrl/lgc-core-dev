# P01 — checkpoint após revisão Sol rodada 2

Checkpoint revisado por Sol: **continuar P01, sem aceite do pacote**, conforme [revisão com verificações da versão atual](revisao-sol-rodada-3/REVISAO.md). Nove testes confirmados; achados incrementais C01–C07 e itens reconhecidamente pendentes continuam abertos. Relato original preservado abaixo.

Data: 2026-11-02

Não é aceite final do P01 e não libera P02. Esta entrega responde aos achados B01–B09 sem alterar os relatórios de revisão.

## B01–B05 — política e comandos

- Autor usa `request:create` para draft/submit/cancel e `request:comment` para comentário/anexo; executor continua usando `request:update`.
- Leituras, download, timeline, submit e replay revalidam conta ativa, vínculo User↔Collaborator e permissão atual.
- Beneficiário não aparece em draft na lista; projeção de campos remove campos marcados como hidden; nota interna não aparece para autor sem vínculo operacional.
- Gestor pode release/reassign sem ser candidato; reassign rejeita atividade terminal, registra candidate/assignment e claim atualiza o resumo do Request.
- Criação legacy exige `CategoryVersion.bpmStatus = null`; approvals também rejeitam BPM.
- Receipts de claim/complete/release/reassign incluem request, rota e activity; replay consulta a versão atual do Request. A tela mantém command IDs estáveis durante a tentativa.

## B06–B07 — contrato, campos e SLA

- Validador agora exige capabilities, policy P01, metas SLA válidas, fases triage/execution, options de select e limites de campo.
- Decimal, inteiro seguro, maxLength, data estrita, whitespace obrigatório e escala foram cobertos por negativas independentes.
- Cálculo de calendário preserva segundos e cruza corretamente o fim do expediente, fins de semana e feriados.
- Publicação usa `publishedAt` nulo em draft no schema e migration recebeu índices de execução.

## B08 — UI

Checkpoint implementado: administração passou a usar colaboradores carregados e seletores de setor/fila/membro/gestor/publicador; editor de versão usa campos estruturados; novo pedido envia valores do formulário; publicar/habilitar permanecem disponíveis; command IDs de submit/claim/complete são estáveis no retry.

Ainda faltam, para o aceite visual completo A01–A24: inbox/fila dedicada, upload visual, autosave/retomada, comentários/timeline/SLA, incidentes e controles visuais de release/reassign/cancel. Não são declarados como entregues.

## B09 e verificações

- Helper aceita PostgreSQL local dedicado cujo nome termina em `_bpm_test` e rejeita bancos Axis compartilhados.
- `npx prisma validate`: passou.
- `npx tsc -p tsconfig.build.json --noEmit --pretty false`: passou.
- `npm run build` em frontend: passou.
- `npm test -- --run src/request-runtime/p01-regression.spec.ts`: 9 testes passaram.
- Checks novos da rodada 2 foram executados somente em leitura. T05, T06, T07 e T10 agora confirmam os vetores corrigidos; T01/T02/T03/T09 usam fixtures sem vínculo collaboratorId no mock e são evidência de que a revalidação atual bloqueia contexto incompleto, não evidência de integração HTTP.

Integração PostgreSQL, concorrência/restart e Playwright continuam pendentes por ausência de PostgreSQL local e de harness UI configurado. Nenhum compose, seed ou banco compartilhado foi usado.

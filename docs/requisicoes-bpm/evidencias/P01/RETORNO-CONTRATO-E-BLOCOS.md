# P01 — contrato HTTP e blocos consolidados

02/11/2026. P01 em revisão; sem liberação de P02.

## Bloqueadores da revisão de jornada

`commands.ts` produz payload discriminado por ação e é usado pelo detalhe. Submit/claim enviam somente metadados; complete acrescenta resolution; release/close/cancel acrescentam reason explícito; reassign acrescenta assigneeId. O dispatch é explícito. O teste backend importa esse produtor e os produtores create/draft/attachment efetivamente usados pelo cliente e os passa pelo ValidationPipe real com whitelist/forbidNonWhitelisted.

A tela libera intenções rejeitadas definitivamente para correção com nova chave; 409 suspende ações até reconciliação; erro de rede/5xx mantém exclusivamente a mesma ação/payload/key para retry. Outras ações e edição ficam bloqueadas durante a tentativa ambígua. Removido o motivo inventado de encerramento/cancelamento.

## Blocos adicionais entregues

- Runtime: receipts de cancel/comment, CAS de comentários, cabeçalho UUID obrigatório nas escritas HTTP e locks por registro/ator/chave. Configuração: interceptor, unidade de trabalho com AsyncLocalStorage, transação/receipt para os escritores e verificação atual de permissão/grant antes de replay. DTO de grants contém revisão esperada e lista validada.
- Política: allowedActions deriva de permissões atuais; projeção de campo/schema/documento por autor/atividade; IDs de arquivos/notas ocultos filtrados da timeline; destino de reatribuição exige assign/update e exclui autor/beneficiário/inativos. Reatribuir resolve o incidente NO_ELIGIBLE_ASSIGNEE na mesma transação.
- Superfícies: inbox/fila com cursor, edição de membresia, responsável elegível/reatribuição/incidente, comentários e SLA; editor de versão com opções, limites, metas, prévia e clone; nomes de setores e publicadores elegíveis.
- Publicação: ponteiro explícito vigente; clone com lock/CAS e publishedAt nulo; metas derivadas na publicação; catálogo lê o ponteiro e retorna somente formulário autorizado. Migration recebeu guards de imutabilidade, executor/vínculo de versão, preservação de histórico, constraints e índices. SQL escrito, **não aplicado nem ensaiado em PostgreSQL**.
- SLA: calendário IANA, segundos, feriados, intervalos, consumo ativo/parado e breach no instante da meta; teste inclui offset histórico de São Paulo.
- Respostas BPM têm ETag/revisão, cache privado e envelope de erro/fields localizados; download já enviado é preservado.

## Evidências executadas

- Frontend: `npm run build` passou (aviso de bundle acima de 500 kB); `npm run test:journey` — **19 testes DOM passaram**.
- Backend: `npx tsc -p tsconfig.build.json --noEmit --pretty false`, `npx tsc -p tsconfig.bpm-tests.json --pretty false`, `npx prisma validate` — passaram.
- `npm test -- --run src/request-runtime src/request-processes/config-command.spec.ts` — **47 testes passaram**, incluindo contrato cliente/DTO real, política de cancelamento, reatribuição, campos/etapas, replay, envelope e calendário.
- `npm run test:e2e -- test/bpm-journey.e2e-spec.ts test/bpm-persistence.e2e-spec.ts` — **4 testes não executados**: BPM_TEST_DATABASE_URL ausente; conexão 127.0.0.1:5432 recusada.

O harness PostgreSQL ampliado compila e prepara fixtures próprias, dois clientes, submit/claim concorrentes, rollback após efeitos de Activity/Clock, reconexão, encerramento, imutabilidade e revogação de conta. Os registros de histórico ficam no banco descartável por desenho. Isso é preparação executável, não prova de persistência: nenhum teste com PostgreSQL rodou e nenhuma migration/seed/compose/dado existente foi usado.

## Limites de aceite

Pendente homologação HTTP/Playwright com personas, ensaio migration↔schema em banco dedicado, execução dos testes PostgreSQL e fechamento integral A01–A24. A configuração de grants tem API e protocolo, mas ainda precisa da superfície visual dedicada; os testes da unidade de trabalho de configuração usam persistência simulada. A cobertura atual não é apresentada como prova exaustiva de toda a matriz de autorização/concorrência.

Arquivos principais: frontend `commands.ts`, `BpmDraftEditorPage.tsx`, `BpmPages.tsx`, `api.ts`, `useDraftAutosave.ts`, `tests/draft.test.tsx`; backend serviços/controllers/DTOs BPM, interceptors de protocolo/configuração, `field-policy.ts`, `business-calendar.ts`, `bpm-http.ts`, respectivas suites, schema/migration P01 e harness `test/bpm-journey.e2e-spec.ts`/`tsconfig.bpm-tests.json`. Relatórios/reprodutores do Sol foram preservados.

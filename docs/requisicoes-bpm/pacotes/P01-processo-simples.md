# P01 — Publicar e executar um processo simples

Status em 02/11/2026: **piloto P01-PILOTO v2 disponível no ambiente existente; A01–A24 fechados tecnicamente com 26 testes DOM, 36 backend focados, Playwright 390×844 e 24 verificações PostgreSQL; P02 ainda não iniciado**. Responsável por implementar: grupo Luna 5.6/médio coordenado pelo chat principal. Responsável por arquitetura/revisão: Sol. Dependências de negócio: nenhuma para este processo interno de teste. [Implantação e roteiro](../evidencias/P01/DEPLOY-PILOTO-EXISTENTE.md). Revisões anteriores preservadas como histórico. Todos os critérios abaixo continuam obrigatórios.

## Objetivo verificável

Um administrador configura filas, formulário e metas, publica e habilita um processo simples pela interface. Um solicitante salva um rascunho incompleto, retoma, anexa arquivo real e envia uma vez. Outro usuário assume triagem e encaminha à execução; executor assume, registra resolução e conclui. Gestor encerra. Todos veem somente seus dados/ações permitidos, com prazos e histórico persistidos. Publicar v2 não muda a instância v1.

Este pacote é a primeira prova do motor próprio: atividade durável após restart, transação sem efeitos parciais, concorrência com 409, idempotência e publicação imutável. Não é o piloto de compras, nem a troca do portal atual.

## Leitura normativa

Ler `../README.md`, `../COORDENACAO.md`, `../01-arquitetura.md`, `../02-regras-autorizacao.md`, `../03-modelo-dados.md`, `../04-contratos-api.md`, `../05-telas-publicacao.md`, seção SLA de `../06-sla-logistica.md` e `../08-decisoes-negocio.md`. Ler `backend/AGENTS.md` antes de editar backend. Atualizar git status/diff antes do primeiro patch.

## Recorte fechado

### Administração

- Flag de servidor `REQUEST_BPM_ENABLED` default false, e flag por categoria runtimeEnabled. Ambiente de teste pode ligá-las explicitamente. Endpoint capabilities informa disponibilidade real; menu de piloto só aparece quando ligado e autorizado.
- Provisionar códigos de permissão necessários em migration aditiva idempotente. Não alterar atribuições dos papéis existentes por seed. Demonstrar concessão a contas sintéticas na tela de papéis existente ou na fixture exclusiva de teste.
- UI para criar fila BPM em setor existente, adicionar membros e gestores por seleção segura e editar com revisão esperada. Permissão `request_queue:manage`; membros precisam colaborador e User ativos. Não editar entidade de setor/CC.
- UI para criar processo interno de teste com código/nome/descrição, setor e filas de triagem/execução; escolher publicador elegível. Criador é modeler. Publicador tem grant e permissão distintos, podendo ser o mesmo usuário neste pacote.
- Assistente de definição: formulário com tipos P01, labels/limites/obrigatórios/opções/fonte; ordem simples de campos; filas de triagem e execução; metas de resposta/solução em minutos. Gera grafo **exatamente start → human triage → human execution → end**. Usuário não escreve JSON. Calendar semanal fixo exibido e feriados copiados ao publicar. Política interna, sem representação, aceite obrigatório ou close automático.
- Salvar draft de versão, validar com erros localizados, prévia de formulário, publicar e habilitar. Clonar versão publicada para novo draft e publicar v2. Uma versão publicada nunca é alterada. Outras capabilities são recusadas no backend, mesmo se enviadas por API.

### Execução

- Criar Request BPM em rascunho parcial; CategoryVersion exata fixada no momento da criação. Nenhuma Activity/ProcessInstance/SLA antes de submit; Request.currentCycle=0. Submit cria cycle=1, ProcessInstance e primeira atividade atomicamente.
- `title/description/fields` podem estar incompletos no draft; valores presentes devem ter tipo válido. Título completo 10–120 e descrição não vazia no submit. Chaves desconhecidas e campos não editáveis são erros. Categoria/versão inativa ou retired não envia. A mesma publicação ainda utilizável continua válida para draft v1 após v2.
- Formulário dinâmico com text/textarea/integer/decimal/date/select/boolean/attachment; fontes Core permitidas de leitura mínima; upload BYTEA real e download autenticado. Draft primeiro, anexo depois. Reusar as funções de `attachment-security.ts` sem refatorá-las globalmente.
- Autosave com debounce, uma chamada em voo, optimistic version e retomada por URL. Revisão antes do submit, uma chave por tentativa lógica; falha de rede reusa chave. Pedido de submit não deve criar outro Request.
- Submit cria tarefa de triagem disponível e prazos. Candidatos excluem autor/beneficiário. Claim a torna em_triagem. Concluir triagem exige resolução (“Conferido e encaminhado”, texto mínimo 3) e abre execução disponível; isso encerra primeira resposta. Claim sozinho não encerra SLA resposta.
- Executor assume, preenche resolução mínima 3 e evidências obrigatórias configuradas na etapa (P01 exige resolução, anexo de execução é opcional). Complete consome token e chega a end, marcando concluded/completedAt e parando clock solução. Gestor da fila de execução tem close manual, com closedAt. Autor vê conclusão, sem botão de aceite nesta política.
- `release` e `reassign` com motivo para gestor, conferindo destino e acesso. Reassign em P01 muda apenas assignee dentro da fila atual, não troca setor/processo.
- Autor pode cancelar rascunho/enviada/em_triagem se nenhuma tarefa de execução foi aberta; gestor da fila atual pode cancelar até em_atendimento porque este processo simples não possui efeitos externos. Campo de motivo obrigatório. Cancelar conclui atividades como cancelled, fecha clocks com outcome cancelled e preserva histórico. Não aceitar cancel em concluida/encerrada.
- Comentários público/interno e anexos no detalhe seguem escopo. Operações que gravam no agregado também exigem expectedVersion e key; incrementam lockVersion uma vez. Em rascunho somente autor; depois envio, apenas participante com permissão correspondente. Campo tipo attachment aponta IDs do mesmo Request e valida arquivo antes do submit.
- Persistir eventos de criação/edição/submissão/claim/release/reatribuição/conclusão/close/cancel/upload/comment/publicação e incidente, com ator/correlação e resumo seguro. Nenhum evento ou byte de upload de outro registro aparece por ID conhecido.

### Relógios e pendência

- Dois clocks básicos desde submit: primeira resposta e solução. Calendar snapshot 08–18 seg–sex/feriados e operações de tempo útil corretas desde P01. Sem cron de alertas/timers nesta entrega; detalhe/lista exibem vencimento, minutos úteis consumidos e violação calculada; eventos futuros de alerta entram em P05. Nada usa `updatedAt` como conclusão.
- Ao publicar, fila sem membro elegível é erro. Se depois todos os candidatos ficam indisponíveis/conflitantes, submit/comando válido cria incidente `NO_ELIGIBLE_ASSIGNEE`, mantém token e fase explicáveis. Não pula tarefa nem aprova. Autor recebe “aguardando definição de responsável”; gestor vê causa segura.
- Gestor corrige membros pela UI e usa “Resolver responsáveis” com motivo no incidente. Servidor reexecuta resolver e fecha incidente somente com candidato válido; nova tentativa não duplica tarefa. Não há botão de “forçar concluído”.

### Preservação do legado

- Novas rotas HTTP `/api/v1/bpm`, novas telas `/requests/bpm/...`; nenhuma requisição antiga é convertida. Catálogo legado exclui versões format BPM e processos exclusivos de teste. Não impedir uso das categorias legadas existentes.
- Endpoints antigos de mutação recusam BPM com 409 WRONG_EXECUTOR; endpoints novos recusam legacy. Colocar validação comum no acesso do serviço legado, incluindo métodos que consultam Request diretamente (approval, anexos e cron), sem reimplementar suas regras.
- Jobs/SLA/auto-close legados excluem executionMode bpm_v1 em todas as buscas. Leitura antiga de ID BPM retorna referência segura para rota BPM ou WRONG_EXECUTOR sem conteúdo bruto; não aplicar serializer legado.
- Nada muda em autenticação, papéis já atribuídos, cadastros ou operações Logística. Não iniciar compose principal; startup atual executa migrate + seed.

## Fora de P01

Sem approvals/delegação/exclusive/paralelo, compras, service nodes, timers, pause/resume/correção/reabertura/recategorização, aceite obrigatório, notification center, painel agregado, fluxo restrito/denúncia, importação das 27 categorias ou editor gráfico. Nenhum desses recursos é anunciado como entregue. Não migrar instâncias nem limpar banco existente. As decisões U03/U04 permanecem registradas; U04 será implementada em P03, sem autoaprovação fictícia em P01.

## Arquivos previstos e ownership

Lista de caminhos esperados, permitindo subdivisão interna equivalente se documentada antes do diff. Não é autorização para alterar arquivos externos sem necessidade. Sol não edita estes arquivos durante implementação.

| Caminho | Trabalho |
|---|---|
| `backend/prisma/schema.prisma` | Extensões/modelos P01 de 03-modelo-dados; preservar campos e relações locais de CC/approvalSource |
| `backend/prisma/migrations/<novo_id>_request_bpm_p01/migration.sql` | Aditiva, defaults legacy, índices/constraints, imutabilidade BPM, permissões sem atribuição em massa; não renomear migrations existentes |
| `backend/src/request-processes/request-processes.module.ts` | Módulo novo |
| `backend/src/request-processes/{processes.controller,processes.service,publication.service,definition-validator,process-access.service,capabilities}.ts` | CRUD de configuração/drafts, validar/publicar/clone/habilitar, grants e capabilities |
| `backend/src/request-processes/{queues.controller,queues.service,sources.controller,sources.service}.ts` | Filas/membros e projeções mínimas das fontes Core |
| `backend/src/request-processes/dto/*.ts` | DTOs estritos dos contratos P01 |
| `backend/src/request-processes/forms/{form-schema,form-validator,field-projection}.ts` | Tipos, validação de draft/submit/atividade e DTO seguro |
| `backend/src/request-runtime/request-runtime.module.ts` | Runtime novo |
| `backend/src/request-runtime/{requests.controller,activities.controller,request-queries.service,request-projection.service,request-policy.service}.ts` | Rotas, listas com escopo SQL, DTOs/allowedActions e autorização |
| `backend/src/request-runtime/commands/{command-executor,command-receipts,request-commands,activity-commands}.ts` | Lock, versão, dedupe e transições |
| `backend/src/request-runtime/engine/{definition-types,interpreter,participant-resolver,status-projector}.ts` | Interpretador linear do subconjunto P01, candidatos/participantes e resumo |
| `backend/src/request-runtime/{runtime-events.service,runtime-incidents.service,bpm-error.filter}.ts` | Timeline, resolução de ausência e erros locais de API |
| `backend/src/request-runtime/sla/{business-calendar,sla-clocks.service}.ts` | Funções úteis determinísticas e clocks persistidos |
| `backend/src/request-runtime/{attachments.controller,attachments.service,comments.service}.ts` | Upload/download/comentário BPM com política; reutilizar validador seguro existente |
| `backend/src/request-runtime/dto/*.ts` | Comandos e filtros tipados; key/expectedVersion |
| `backend/src/app.module.ts` | Registrar módulos novos sem remover imports existentes |
| `backend/src/requests/{requests.service,requests.controller}.ts` e `backend/src/request-categories/request-categories.service.ts` | Apenas separação de executor/catálogo/cron legados; preservar mudanças locais de compra |
| `backend/.env.example` (se existir; caso contrário documentar no README) | Flag BPM sem segredos |
| `frontend/src/features/requisicoes-bpm/api/{client,types}.ts` | Adaptar cliente Axios existente, comandos/chaves/versões e DTOs |
| `frontend/src/features/requisicoes-bpm/pages/{PortalPage,MyRequestsPage,NewRequestPage,RequestDetailPage,ActivitiesPage,QueuePage,ProcessesAdminPage,ProcessVersionPage,QueuesAdminPage}.tsx` | Superfícies P01; criar draft/editar pode compartilhar página |
| `frontend/src/features/requisicoes-bpm/components/{DynamicForm,AttachmentField,ActionDialog,ActivityPanel,Timeline,IncidentPanel,ProcessWizard,SlaSummary}.tsx` | Componentes necessários, sem prompts de browser |
| `frontend/src/features/requisicoes-bpm/hooks/{useDraftAutosave,useBpmCommand}.ts` | Autosave serializado, estado de conflito e retry de mesma chave |
| `frontend/src/App.tsx`, `frontend/src/components/layout/AppLayout.tsx` | Rotas e acesso ao piloto por capability; manter as alterações de RolesPage locais |
| `frontend/package.json`, lockfile, configuração Vitest/Playwright nova | Apenas infraestrutura necessária de verificação; não atualizar React/Vite globalmente |
| `backend/test/bpm-p01/*.e2e-spec.ts`, `backend/src/request-{processes,runtime}/**/*.spec.ts` | Contratos, autorização, concorrência, relógio/definição |
| `backend/test/support/bpm-test-database.ts`, `backend/vitest.config.bpm-e2e.ts` | Fixture Postgres dedicada e proteção contra URL errada |
| `frontend/src/features/requisicoes-bpm/**/*.test.tsx`, `frontend/e2e/bpm-p01.spec.ts` | Campos/draft/conflito e jornada real por personas |
| `docs/requisicoes-bpm/evidencias/P01/README.md` e capturas/logs sanitizados | Evidência por aceite, decisões e limitações |

Não editar seed.ts/seed-requests, Dockerfiles/compose/proxy, AuthContext, auth/JWT, cadastros, RolesPage ou satélite para “facilitar” P01. Se houver necessidade real não prevista, registrar motivo concreto e ajustar escopo com Sol antes da edição; não é necessário interromper por organização rotineira de arquivos novos equivalentes.

## Sequência de execução quando o pacote for acionado

1. Registrar baseline novo (status, diff, arquivos não rastreados, instruções). Identificar alterações do usuário em todos os arquivos compartilhados. Não fazer stash/reset automático. Confirmar bibliotecas instaladas/lockfile sem adotar versões web diferentes.
2. Preparar migration aditiva e ambiente de teste PostgreSQL16 próprio. A URL de teste é explícita (`BPM_TEST_DATABASE_URL`) e banco deve terminar em `_bpm_test`; helper recusa nomes `axis`, `axis_logistica`, URL ausente e hosts fora de allowlist local de teste. Nunca usar DATABASE_URL como fallback. Cleanup limitado ao banco/fixtures de teste verificados.
3. Implementar definição/publicação + autoria/filas + executor/consulta/política/persistência como um conjunto. Seeds de teste somente em fixture do banco dedicado, não seed operacional.
4. Implementar UI administrativa e jornada de usuário; não entregar endpoints sem caminho visível de configuração/execução.
5. Integrar clocks/anexos/comentários/timeline/incidentes e separação de executor legado. Validar snapshots e constraints em DB real.
6. Executar cenários abaixo e smoke de preservação; capturar evidência. Não expor credenciais, dados pessoais ou body base64 nos logs.
7. Enviar para Sol o relato da coordenação e os diffs. Só declarar concluído com todos os critérios obrigatórios executados. Não iniciar P02 enquanto revisão/homologação de P01 estiver pendente.

## Cenários e aceite obrigatório

Personas sintéticas: A=autor, T=triador/executor elegível, G=gestor/publicador, X=outro setor sem participação. IDs gerados em fixture/selecionados em homologação, sem constantes de usuários reais. Pode haver segundo executor E para corrida. G tem permissões/grants de configuração e gestão explicitamente provisionados; ser admin sozinho não basta.

| ID | Cenário | Evidência / resultado esperado |
|---|---|---|
| A01 | G cria fila/membros, processo/form/2 metas, valida/publica/habilita pela UI | Processo aparece para abertura; versão publicada/hash/data/autor; sem SQL/seed para criar processo |
| A02 | Grafo com ciclo, nó desconhecido ou approval enviado via API | 422, sem publicação/ponteiro mudado; UI mostra erro relevante |
| A03 | G edita após validar ou dois publicadores publicam a mesma revisão | Hash antigo falha 409; apenas uma publicação/ponteiro; publicada não aceita PATCH |
| A04 | A salva draft incompleto, fecha/reabre página e retoma | Mesmo ID/código e valores; nada enviado; fila/X/beneficiário não veem draft |
| A05 | false, 0, data inválida, decimal fora da escala, unknown field e obrigatório ausente | false/0 aceitos quando válidos; erros por campo; draft parcial permitido; submit inválido sem Activity/Clock/evento de submit |
| A06 | Upload real PDF/PNG, download, troca; arquivo grande/MIME falso/ID de outro pedido | Bytes/hash corretos; versão nova preserva anterior; rejeições sem efeito; X não baixa pelo ID conhecido |
| A07 | A envia com duplo clique/retry de mesma chave | Um submit/ciclo/triagem e dois clocks; resposta replay sem duplicidade |
| A08 | Duas criações de draft com mesma chave; mesma chave/corpo alterado | Um Request/código; alteração da chave reutilizada →409 |
| A09 | T assume e conclui triagem, assume execução, conclui; G encerra | Status/atividades coerentes, resolução persistida, timestamps, SLA e timeline; A acompanha; nenhuma ação fora de fase |
| A10 | Dois candidatos tentam claim com versão igual | Exatamente um claim/atribuição; outro409; nada de duas atividades ativas para o mesmo token |
| A11 | Duas mutações sobre versão igual (save/complete/cancel) | Uma vence e outra409; sem overwrite; formulário do perdedor preservado na UI |
| A12 | Falha injetada após escrever Activity e antes do evento/receipt | Rollback de Request/Activity/Event/Clock/Receipt; retry íntegro com mesma chave |
| A13 | Restart do backend após envio/triagem assumida | Atividade/assignee/versão/prazos retomados do PostgreSQL; sem memória global necessária |
| A14 | X acessa detalhe, lista, busca por código, timeline, download e comando | Sem título/dado/contagem; 404 para registro oculto; nenhuma mutação |
| A15 | A tenta claim/complete próprio; T tenta publicar sem grant; G só modelador tenta ler registro fora de escopo | Negado; nenhuma permissão inferida de papel/nome/setor |
| A16 | Revogar membro/permissão com JWT antigo ainda válido, depois tentar ação/replay | Comando/replay revalida dados atuais e nega; nenhum DTO sensível em recibo |
| A17 | Publicar v2 com campo/meta novos, executar v1 aberta e criar v2 | V1 mantém regras/prazos; nova usa v2; draft v1 utilizável não muda por baixo do usuário |
| A18 | Fila publicada perde candidatos; envio e posterior resolução | Incidente visível, sem pular tarefa; G corrige membros e resolve sem duplicar atividade |
| A19 | Clock sexta/noite/feriado, resposta na triagem, solução na conclusão | Vetores básicos de 06 passam; claim não para resposta; updatedAt/comentário não muda meta |
| A20 | Cancelar antes de execução por A e em execução por G, com/sem motivo; close antes da conclusão | Regras do recorte respeitadas; sem motivo/ator/estado válidos não há efeito parcial |
| A21 | Nota interna vs pública, participante removido e link de anexo | Campo/nota/arquivo filtrados em todas as superfícies; participante antigo não conserva permissão indevida |
| A22 | Usar endpoint legado sobre BPM e novo sobre legado; executar jobs antigos |409 WRONG_EXECUTOR ou exclusão; nenhum motor escreve no outro; categoria legado original continua listada |
| A23 | Jornada por teclado, 390px, loading/vazio/offline/409/retry | Capturas e roteiro demonstram campos preservados, foco e mensagens pt-BR; sem prompt do browser |
| A24 | Smoke preservado | Login/refresh/troca senha, usuários/papéis, setor/CC/responsável, colaborador, cliente/projeto e tela de requisição antiga continuam acessíveis/íntegros |

Testes de concorrência usam conexões/requests reais contra PostgreSQL16, não Promise.all sobre mock de Prisma. Falha transacional usa injeção de dependência/failpoint só no teste, sem rota de produção para forçar erro. Execução de worker legado usa clock injetado/fixtures do banco de teste, sem iniciar cron no banco do usuário.

## Verificação e relato

Comandos previstos, a adaptar ao gerenciador/lockfile realmente encontrado e registrar os executados:

```powershell
# No diretório backend; somente banco dedicado explicitamente configurado
npx prisma validate
npm run build
npm run test -- --run
npx vitest run --config vitest.config.bpm-e2e.ts

# No diretório frontend
npm run build
npx vitest run src/features/requisicoes-bpm
npx playwright test e2e/bpm-p01.spec.ts
```

Preparar/aplicar migrations apenas no banco de teste identificado durante a implementação, nunca neste planejamento. Configurar lint focado nos arquivos alterados; se lint/build global já falhar por trabalho anterior, registrar baseline e demonstrar que pacote não introduziu o erro. Isso não dispensa executar a jornada nova.

Relato final inclui tabela A01–A24 com passou/falhou/não executado e evidências. Build sem erro não substitui A07/A10/A12/A13/A14/A17 nem demonstra UI. Se DB/navegador estiver indisponível, entregar trabalho com estado “aguardando validação”, especificar impedimento e não pedir para usuário adivinhar quais testes faltam.

## Mensagem pronta para encaminhar ao Luna (somente após fechar projeto)

> Implemente somente P01 de `docs/requisicoes-bpm/pacotes/P01-processo-simples.md`, lendo os documentos normativos indicados. Preserve alterações locais e autenticação/cadastros/demais módulos. Atualize status/diff e registre seu escopo antes de editar. Entregue a jornada administrativa e operacional completa do pacote, migrations aditivas, autorização, erros e evidências A01–A24. Use banco de teste explicitamente identificado; não use compose principal nem seeds operacionais para preparar ambiente. Não implemente compras, approvals ou P02 antecipadamente. Ao terminar, informe diffs, verificações reais, limitações e caminhos das evidências para revisão por Sol. Não declare concluído apenas pelo build.

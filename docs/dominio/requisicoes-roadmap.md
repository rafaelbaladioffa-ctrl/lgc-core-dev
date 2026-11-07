# Requisições — roadmap da reescrita do motor

> **Propósito:** ordenar a reescrita do motor de processos de Requisições (E0–E6), com pré-requisitos, situação reverificada das lacunas R01–R14, checklists de aceite reaproveitáveis e lições do P01.
> **Data:** 2026-11-07 · HEAD `115d5b9`. BPM P01–P04 removido em `98dfce5`; código antigo em `629044d`.
> **Fontes:** [planejamento §4 e §7](../arquivo/planejamento-requisicoes-bpm-2026-11-01.md), [P01-processo-simples.md](../arquivo/bpm-2026-11/pacotes/P01-processo-simples.md), [07-backlog-validacao.md](../arquivo/bpm-2026-11/07-backlog-validacao.md), [evidências P01](../arquivo/bpm-2026-11/evidencias/P01/), código atual. Regras em [requisicoes-regras-motor.md](requisicoes-regras-motor.md); comportamento atual em [requisicoes-estado-atual.md](requisicoes-estado-atual.md).

---

## 0. Pré-requisitos antes de E1

> **Situação em 2026-11-07:** PR-03, PR-04 e PR-05 concluídos na branch `rafaelbaladioffa-ctrl/correcoes-bloqueantes` (✅). Também corrigidos fora desta lista: reenvio de `devolvida_ajuste`, reabertura parada em `em_triagem` e resposta do solicitante a pedido de informação. PR-01 e PR-02 dependem de decisão sobre o banco existente.

Nenhum item abaixo altera regra de negócio; todos destravam ambiente, testes ou segurança.

| ID | Item | Evidência | Critério de pronto |
|---|---|---|---|
| PR-01 | **Corrigir a ordem das migrações.** `20261101000000_request_bpm_p01` faz `ALTER TABLE "request_categories"`, `"category_versions"`, `"queues"` e `"requests"`, mas essas tabelas só são criadas em `20261111000000_requisicoes_fase1`; `20261103000002_request_bpm_p02` adiciona valores ao enum `RequestStatus`, também criado só em `20261111`. `prisma migrate deploy` em banco vazio falha. | [p01 migration.sql:22-40](../../backend/prisma/migrations/20261101000000_request_bpm_p01/migration.sql), [p02 migration.sql:7-8](../../backend/prisma/migrations/20261103000002_request_bpm_p02/migration.sql), [fase1 migration.sql:28-81](../../backend/prisma/migrations/20261111000000_requisicoes_fase1/migration.sql) | `migrate deploy` em banco vazio passa; em cópia do banco atual, `migrate status` sem divergência. Não renomear migrações já aplicadas sem plano de baseline para os bancos existentes. |
| PR-02 | **Migração explícita de DROP dos objetos BPM órfãos.** O schema não declara mais: tabelas `bpm_process_instances`, `bpm_execution_tokens`, `bpm_activity_instances`, `bpm_activity_candidates`, `bpm_activity_assignments`, `bpm_request_participants`, `bpm_runtime_events`, `bpm_command_receipts`, `bpm_runtime_incidents`, `bpm_sla_clocks`, `bpm_sla_intervals`, `bpm_request_comments`, `bpm_request_attachments`, `request_queue_members`, `process_config_grants`; colunas `request_categories.runtime_enabled/config_revision/published_bpm_version_id`, `category_versions.bpm_*`; enums `Bpm*`; permissões `request_process:*` e `request_queue:manage`. | [p01 migration.sql](../../backend/prisma/migrations/20261101000000_request_bpm_p01/migration.sql), [schema.prisma](../../backend/prisma/schema.prisma) | Migração nova, revisada, ensaiada em cópia `*_test`, com backup prévio; `prisma migrate diff` do banco para o schema vazio. Avaliar antes se há dados do piloto P01 a preservar (o deploy de 2026-11-02 publicou `P01-PILOTO` no ambiente local). |
| PR-03 ✅ | **Remover testes BPM quebrados**: `backend/test/bpm-*.e2e-spec.ts` (8 arquivos), `backend/test/support/bpm-*.ts`, `frontend/tests/*` (5 arquivos, importam `features/requisicoes-bpm` ou `isBpmNavigationEnabled`), `frontend/e2e/a23-mobile.spec.ts`. `backend/test/a24-auth-refresh-password.e2e-spec.ts` depende de `support/bpm-test-database.js` — reaproveitar o helper renomeado ou reescrever. | `backend/test/`, `frontend/tests/`, `frontend/e2e/` | Suites backend e frontend rodam verdes sem referência a módulos removidos. |
| PR-04 ✅ | **Corrigir o vazamento da fila.** `GET /requests/queue` devolve `Request` cru sem confidencialidade/anonimato e com setor escolhido pelo cliente. | [requests.service.ts:760-772](../../backend/src/requests/requests.service.ts#L760-L772) | Lista com DTO allowlist, filtro de confidencialidade no SQL, máscara de anônimo; teste com usuário de outro setor e denúncia anônima. |
| PR-05 ✅ | (adicional) Remover ou reescrever `seed-requests-suprimentos.ts` e o script `seed:requests-suprimentos`: usa `bpmDefinition`, `requestQueueMember`, `publishedBpmVersionId`, inexistentes no schema. | `seed-requests-suprimentos.ts:98-113`, [package.json:30](../../backend/package.json) | `tsc` dos seeds passa. |
| PR-06 | (adicional) Fechar os furos de forja em `formData` antes de qualquer uso real de compras: rejeitar chaves `procurement*`/`selectedQuotationId` vindas do cliente. | [estado atual L02](requisicoes-estado-atual.md#15-limitações-conhecidas) | Teste que tenta criar/editar com `procurementAnalysis` recebe 400. |

## 1. Lacunas R01–R14 reverificadas (2026-11-07)

Situação: **aberta**, **parcial** (parte tratada, parte não) ou **resolvida**.

| ID | Prio. | Lacuna original (resumo) | Situação | Evidência atual |
|---|---|---|---|---|
| R01 | P0 | Fila, painel e listagens sem política de confidencialidade/anonimato; setor escolhido pelo cliente | **aberta** | Fila crua [requests.service.ts:760-772](../../backend/src/requests/requests.service.ts#L760-L772); painel global [:778-829](../../backend/src/requests/requests.service.ts#L778-L829); detalhe só bloqueia `restrita` [:729-731](../../backend/src/requests/requests.service.ts#L729-L731) |
| R02 | P0 | Cancelamento sem checar dono; comentário/upload sem participação; mutações por permissão ampla | **parcial** | Resolvido: cancelamento por dono/fase ou `request:update` [:634-641](../../backend/src/requests/requests.service.ts#L634-L641); `assertNotRequester` em triagem/compras/aprovação/start/info/complete/close [:1051-1059](../../backend/src/requests/requests.service.ts#L1051-L1059); travamento de UI do solicitante no commit `115d5b9`. Aberto: comentários/anexos [:650-661](../../backend/src/requests/requests.service.ts#L650-L661), `assign` [:330-335](../../backend/src/requests/requests.service.ts#L330-L335), `resume` e `selectPurchaseQuotation` sem escopo; ações de staff não exigem ser `assignee`/membro de fila |
| R03 | P0 | Quórum sobre o subconjunto pendente; N_DE_M trava; concorrência | **aberta** | [:418](../../backend/src/requests/requests.service.ts#L418), [:435-436](../../backend/src/requests/requests.service.ts#L435-L436), [:1071-1084](../../backend/src/requests/requests.service.ts#L1071-L1084) |
| R04 | P0 | Preço do cliente; cotação nova preserva aprovação antiga; seleção não sincroniza valor | **aberta** | [:161-175](../../backend/src/requests/requests.service.ts#L161-L175), [:377-379](../../backend/src/requests/requests.service.ts#L377-L379), [:403-404](../../backend/src/requests/requests.service.ts#L403-L404); agravada por forja de `formData` (L02) |
| R05 | P0 | Cadeia vazia aprova; conflito de delegado/CC não tratado ponta a ponta | **parcial** | Delegado que é solicitante é barrado (`assertNotRequester` antes de `findDecidableRow`, [:417-419](../../backend/src/requests/requests.service.ts#L417-L419)). Aberto: sem regra de alçada → aprovação automática [:1292-1293](../../backend/src/requests/requests.service.ts#L1292-L1293) e [:308-310](../../backend/src/requests/requests.service.ts#L308-L310); responsável do CC = solicitante trava sem substituto; exclusões de denúncia não se aplicam ao delegado. Auto-aprovação no topo é decisão U04 — falta distingui-la de falha de configuração |
| R06 | P1 | Devolução sem corrigir/reenviar; reabertura cai em estado sem saída | **aberta** | `update`/`submit` só em `rascunho` [:186](../../backend/src/requests/requests.service.ts#L186), [:208](../../backend/src/requests/requests.service.ts#L208); `reopen` → `em_triagem` [:623](../../backend/src/requests/requests.service.ts#L623), triagem exige `enviada` [:231](../../backend/src/requests/requests.service.ts#L231) |
| R07 | P1 | Recategorização sem setor/fila/validação | **aberta** | [:248-257](../../backend/src/requests/requests.service.ts#L248-L257) |
| R08 | P1 | `lockVersion` só incrementa; estado lido fora da transação | **aberta** | [:201](../../backend/src/requests/requests.service.ts#L201), [:1220-1226](../../backend/src/requests/requests.service.ts#L1220-L1226) |
| R09 | P1 | SLA mistura útil/corrido, prazo duplicado, `updatedAt`; compra com caminho distinto | **aberta** | Correção pontual de fuso documentada no código [:1127-1136](../../backend/src/requests/requests.service.ts#L1127-L1136) (offset fixo, não IANA); auto-close por `updatedAt` corrido [:968-969](../../backend/src/requests/requests.service.ts#L968-L969); compras sem relógio até a aprovação |
| R10 | P1 | Obrigatoriedade superficial; anexos de abertura são nomes; `purchaseItems` contorna validação | **aberta** | [:215-217](../../backend/src/requests/requests.service.ts#L215-L217), [:1245-1255](../../backend/src/requests/requests.service.ts#L1245-L1255) |
| R11 | P1 | Reabrir só para quem tem update; retomada exige update e não serve ao solicitante | **parcial** | Resolvido: botão Reabrir aparece ao solicitante [RequestDetailPage.tsx:376](../../frontend/src/pages/RequestDetailPage.tsx#L376). Aberto: `resume` exige `request:update` [requests.controller.ts:160-165](../../backend/src/requests/requests.controller.ts#L160-L165); sem `allowedActions` do servidor; ações na UI derivadas de permissão/papel no cliente [RequestDetailPage.tsx:109-123](../../frontend/src/pages/RequestDetailPage.tsx#L109-L123) |
| R12 | P1 | Minhas aprovações omite delegações; restrito nega delegado | **aberta** | [:831-840](../../backend/src/requests/requests.service.ts#L831-L840), [:728](../../backend/src/requests/requests.service.ts#L728) |
| R13 | P1 | Contratos Core/Logística divergentes para material | **aberta** | Core não emite nenhum `material_request.*`; outbox só `request.*`/`sla.*` ([estado atual §13](requisicoes-estado-atual.md#13-eventos-de-outbox)) |
| R14 | P2 | "SLA" do painel é tempo corrido; auditoria desigual; sem timeline | **aberta** | [:803-805](../../backend/src/requests/requests.service.ts#L803-L805); `start()`/`update()` sem `AuditEvent` [:476-486](../../backend/src/requests/requests.service.ts#L476-L486) |

## 2. Entregas E0–E6

Ordem obrigatória E0 → E6. Cada entrega inclui backend, frontend, migração quando necessária, testes, documentação e demonstração. Conclusão exige evidência do aceite, não só build.

### E0 — Baseline funcional e regras consolidadas
- Inventário do banco de desenvolvimento/homologação: categorias publicadas, versões, filas, alçadas, papéis e requisições por status.
- Confrontar as 27 categorias dos seeds com o catálogo real e a spec: matriz processo × campos × regra × implementação × teste × pendência.
- Homologar jornada com solicitante, triagem, executor, aprovador, delegado e gestor, em duas áreas e um caso restrito.
- Fixar regras de compras (B01/B02) e comportamento de ausência de aprovador, devolução, reabertura, cancelamento após execução e recategorização.

**Aceite:** inventário real; matriz de autorização e transições acordadas; exemplos executáveis de sucesso, exceção e negação.

### E1 — Correção da base atual
- Resolver R01–R13 por prioridade, começando por autorização, quórum, valores e integridade das decisões.
- Centralizar transições, política de acesso, validação dinâmica, comandos com versão esperada e eventos.
- Completar corrigir/reenviar, responder pedido de informação, reabertura e anexos reais.
- Corrigir relógios, campos de prazo, datas de conclusão e aceite por ciclo.

**Aceite:** jornadas atuais completas; nenhuma passagem indevida entre setores; quórum correto; compra com proposta alterada exige nova decisão; teste de concorrência; transição inválida retorna erro sem efeito parcial.

### E2 — Administração e versionamento sem código
- Administração de categorias, filas, responsáveis, grupos, formulários, alçadas, calendários e políticas.
- Construtor com seções, campos, tabelas de itens, dinheiro, documentos e fontes de cadastro; visibilidade/edição/obrigatoriedade por atividade.
- Ciclo rascunho → validar → simular → publicar → descontinuar; permissões distintas para modelar e publicar.
- Comparação entre versões, checklist automático, prévia como solicitante/executor/aprovador; campos financeiros ligados a propriedades de negócio.

**Aceite:** administrador cria pela interface uma categoria com formulário, aprovação e SLA; publica v2; instância v1 permanece coerente; sem seed nem alteração de código.

### E3 — Execução de processos e compras como piloto
- Prova técnica do motor registrada antes do editor definitivo (persistência após restart, concorrência, replay, troca de versão; junção e quórum).
- Conjunto limitado de atividades, gateways, timers, tarefas e incidentes; APIs atuais adaptadas a comandos.
- Compras como processo configurado com ações de domínio Suprimentos/Logística; tarefas simultâneas, quórum por rodada, reaprovação, responsável ausente, retorno para ajuste.

**Piloto:** abrir → triagem Suprimentos → verificar estoque → [suficiente: atendimento / parcial ou indisponível: cotação] → escolha e aprovação → compra/recebimento ou entrega → aceite → encerramento.

**Aceite:** compra com estoque, parcial, sem estoque, reprovação, alteração de proposta, delegado, cancelamento e recebimento parcial; nenhuma comparação por nome de categoria para escolher fluxo.

### E4 — Editor visual e área unificada de atividades
- Editor com arrastar, propriedades, conexões e validação antes de publicar; detecção de nós sem saída, tarefas sem responsável, condições inválidas, paralelismo sem junção e caminhos sem fim.
- Simulação por valor, papel, setor, estoque e dados, explicando o roteamento.
- Inbox com tarefas pessoais, candidatas e delegadas; detalhe com formulário da etapa, ações autorizadas, timeline/diagrama; formulários de decisão no lugar de `window.prompt`.

**Aceite:** modelador altera condição, responsável e etapa sem código; testes da definição aprovam; processo novo usa a nova versão e execução anterior continua na antiga.

### E5 — Integrações e operação confiável
- Eventos Core ↔ Logística com esquema, versão, correlação e ID de negócio (RM-INT); ordem única por requisição/versão; retry não duplica reserva, compra, recebimento ou baixa.
- Retorno parcial/completo e cancelamento com compensação; tarefas automáticas com timeout, retry, fila de falhas e reprocessamento auditado.
- Upload para armazenamento adequado com quarentena/scan real (revisita U03) e autorização no download; notificações persistentes, lembretes e escalonamento.

**Aceite:** integração correta após falha de rede, entrega duplicada e evento fora de ordem; operador identifica e resolve falha sem SQL manual.

### E6 — Expansão por modelos e gestão
- Modelos reutilizáveis: solicitação simples, aprovação financeira, atendimento com aceite, execução paralela, processo restrito.
- TI, reembolso e mobilização após compras; Compliance/RH restrito com homologação própria (B05).
- Catálogo em ondas com donos de processo; indicadores por processo/versão/etapa, tempo útil × corrido, exportação autorizada.

**Aceite:** ao menos três processos distintos configurados pela interface, sem condicional nova por categoria no frontend ou no orquestrador; donos mantêm mudanças usuais com rastreabilidade.

## 3. Checklist de aceite reaproveitável (A01–A24 do P01)

Os cenários foram escritos para o P01 (processo simples, sem aprovação). Valem como checklist do primeiro processo do novo motor; personas: A = autor, T = triador/executor, G = gestor/publicador, X = outro setor. Os testes de concorrência devem usar PostgreSQL real, não `Promise.all` sobre mock.

| ID | Cenário | Esperado |
|---|---|---|
| A01 | G cria fila/membros, processo, formulário e duas metas; valida, publica e habilita pela UI | Processo disponível; versão com hash/data/autor; sem SQL/seed |
| A02 | Grafo com ciclo, nó desconhecido ou capability não suportada via API | 422 localizado; nada publicado |
| A03 | Edição após validar; dois publicadores na mesma revisão | Hash antigo → 409; uma publicação; publicada não aceita PATCH |
| A04 | A salva rascunho incompleto, fecha e retoma | Mesmo ID/código e valores; fila/X/beneficiário não veem |
| A05 | `false`, `0`, data inválida, decimal fora de escala, chave desconhecida, obrigatório ausente | Válidos aceitos; erros por campo; submit inválido sem efeitos |
| A06 | Upload PDF/PNG, download, troca; arquivo grande, MIME falso, ID de outro pedido | Bytes/hash corretos; versão nova preserva anterior; rejeições sem efeito; X não baixa |
| A07 | Duplo clique/retry com mesma chave no envio | Um submit/ciclo/tarefa e dois clocks |
| A08 | Duas criações com mesma chave; mesma chave com corpo alterado | Um registro; corpo alterado → 409 |
| A09 | T assume e conclui triagem e execução; G encerra | Estados, resolução, timestamps, SLA e timeline coerentes |
| A10 | Dois candidatos fazem claim com a mesma versão | Um vence; outro 409 |
| A11 | Duas mutações na mesma versão | Uma vence, outra 409; UI preserva o formulário perdedor |
| A12 | Falha injetada após gravar atividade e antes do evento/recibo | Rollback total; retry íntegro |
| A13 | Restart do backend após envio/claim | Estado retomado do PostgreSQL |
| A14 | X acessa detalhe, lista, busca por código, timeline, download, comando | 404, sem título/contagem; nenhuma mutação |
| A15 | A tenta claim/complete próprio; T publica sem grant; modelador lê registro fora de escopo | Negado; nada inferido de papel/nome/setor |
| A16 | Revogar membro/permissão com JWT antigo; tentar ação/replay | Negado com base no estado atual |
| A17 | Publicar v2; executar v1 aberta e criar v2 | v1 mantém regras/prazos; nova usa v2 |
| A18 | Fila perde candidatos; envio; resolução | Incidente visível; resolve sem duplicar tarefa |
| A19 | Clock sexta/noite/feriado; resposta na triagem; solução na conclusão | Vetores RM-SLA-T passam; claim/comentário não param relógio |
| A20 | Cancelar por A antes da execução e por G durante; sem motivo; close antes da conclusão | Regras respeitadas; sem efeito parcial |
| A21 | Nota interna × pública; participante removido; link de anexo | Filtrado em todas as superfícies; acesso revogado |
| A22 | Comando legado sobre registro novo e vice-versa; jobs antigos | 409 `WRONG_EXECUTOR` ou exclusão |
| A23 | Teclado, 390 px, loading/vazio/offline/409/retry | Campos preservados, foco e mensagens pt-BR, sem `prompt` |
| A24 | Smoke | Login/refresh/troca de senha, usuários/papéis, setor/CC, colaborador, cliente/projeto e telas antigas íntegros |

### Critérios de aceite dos pacotes P01–P10 aproveitáveis

| Pacote | Critérios a reaproveitar | Entrega E correspondente |
|---|---|---|
| P01 | A01–A24 acima | E1/E3 |
| P02 | Autor corrige campo liberado e reenvia; executor pergunta e autor responde sem permissão de executor; UI e backend rejeitam os mesmos dados; campo oculto ausente de DTO/timeline/anexo; negativas: campo oculto enviado, seleção não elegível, referência retirada, tabela > 200, valor fora de escala, reenvio incompleto, resposta de outro usuário, dois reenvios concorrentes | E1/E2 |
| P03 | N=2/M=3 conta votos sucessivos; `qualquer_um` fecha pendentes sem falsificar voto; veto/reenvio criam rodada correta; duas decisões simultâneas não duplicam próximo nó; delegado de dois slots conta uma vez; delegação expirada perde ação/acesso; cadeia vazia avança com evento U04, erro de matriz/fila não; join encerra uma vez mesmo após restart/mensagem repetida; definição sem join ou com ciclo recusada | E1/E3 |
| P04 | Dois itens com referências validadas; preço adulterado não altera referência; CC escolhe proposta válida e total sincroniza; 0,01/limites/valores altos sem erro de float; mudança de item/preço/anexo invalida rodada; matriz sem cobertura → incidente; compras simultâneas não contornam alçada; v2 da matriz não muda v1; UI mostra "integração pendente" | E3 |
| P05 | Todos os vetores RM-SLA-T; alerta único com dois workers; pergunta num ramo não pausa outro; auto-close respeita aceite; comentário não adia fechamento; ciclo novo não reaproveita aprovação/SLA/aceite; deadline inclusivo; fora da janela cria rascunho relacionado; recategorização muda fila/versão/visibilidade sem zerar consumo; filha reprovada bloqueia pai sem dispensa; notificação não vaza título restrito | E1/E5 |
| P06 | Processo novo criado sem JSON/seed/código, com decisão e paralelo; v1/v2 coexistem; inválido mostra nó/campo; mudança após validar exige revalidar; simulador sem Request/outbox/job/rede; prévia respeita papel; editor operável por teclado; alterar template não altera derivados | E2/E4 |
| P07 | Estoque total, parcial e zero; proposta negada; mudança pós-aprovação; pedido emitido; recebimento/entrega parcial; cancelamento antes/depois de separação; timeout após commit remoto; evento repetido/fora de ordem/corpo divergente; crash entre inbox e efeito; retorno > 72 h por reconciliação; assinante com falha não duplica efeito em outro; nada entregue por ACK HTTP; Core e Logística reais em homologação | E5 |
| P08 | IDs/códigos/anexos/decisões antigos preservados; registro em um motor só; flag muda só novas aberturas; rollback impede novas instâncias sem desfazer efeitos; métricas úteis/corridas corretas e filtradas; smoke de cadastros; p95 medido em dataset sintético | E6 |
| P09 | Três processos distintos mantidos pela UI sem condicional nova; mobilização aguarda todas as áreas; restrito testa identidade em listas/busca/DTO/anexos/timeline/export/notificação e conflitos por cadeia/delegação | E6 |
| P10 | Lista do que fica fora do primeiro ciclo (BPMN amplo, motor comercial, RPA, assinatura eletrônica, canal anônimo sem login, multiempresa, e-mail/Teams/WhatsApp, MFA por decisão, IA de triagem, object storage/antimalware, migração de instâncias abertas, remoção física do legado) | Fora do roadmap |

## 4. Lições de defeitos reais (evidências P01)

Defeitos encontrados durante o P01 (2026-11-01/02), que devem virar teste de regressão no motor novo.

| ID | Defeito | Causa | Regra/teste que previne | Fonte |
|---|---|---|---|---|
| LI-01 | Autosave que recebia 409 não exibia aviso de conflito | Estado de conflito do hook não ligado à tela | Teste DOM: 409 no autosave mostra conflito, interrompe autosave e preserva a edição | [HANDOFF-CLAUDE.md](../arquivo/bpm-2026-11/evidencias/P01/HANDOFF-CLAUDE.md) |
| LI-02 | Replay de criação falhava após publicar v2 | Replay exigia que v1 ainda fosse o ponteiro vigente | RM-CMD-09: replay consulta recibo sem depender da versão vigente | [revisao-contratos](../arquivo/bpm-2026-11/evidencias/P01/revisao-contratos/REVISAO.md) |
| LI-03 | Patch de campo visível apagava campo protegido; máscara de leitura perdida após o fim da atividade | `dto.fields ?? formData` substituía o objeto inteiro | RM-FRM-04: merge sobre persistido; testar título, um campo, dois campos, `null` e tentativa sobre protegido | [rodada 5 E02](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-5/REVISAO.md), [revisao-contratos](../arquivo/bpm-2026-11/evidencias/P01/revisao-contratos/REVISAO.md) |
| LI-04 | `breachedAt` gravado com o instante da parada, não do esgotamento | Uso de `now` para violação passada | RM-SLA-14 e vetor RM-SLA-T10 | [rodada 5 E05](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-5/REVISAO.md) |
| LI-05 | Gestor com `create` cancelava pedido alheio | `(canCreate ∨ canManage) ∧ (isRequester ∨ manager)` avaliados separadamente | RM-ACE-09: pares vínculo × permissão; matriz autor/gestor/executor/estranho × create/update | [rodada 5 E04](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-5/REVISAO.md) |
| LI-06 | Solicitante sem `request:update` era negado ao salvar o próprio rascunho | Permissão de executor copiada para ações do autor | Autor usa `create`/`comment`; testar cada operação com autor sem `update` | [rodada 2](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-2/REVISAO.md) |
| LI-07 | Recibo de release/reassign consultado e gravado com hashes diferentes | Contexto canônico montado duas vezes | RM-CMD-03: um único contexto para lookup e gravação | [rodada 3 C03](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-3/REVISAO.md) |
| LI-08 | Metas SLA configuradas no snapshot (10/20 min) ignoradas; clocks com 240/2.880 | Runtime lia colunas da versão, não o snapshot | RM-ARQ-05: snapshot é a fonte de verdade | [rodada 3](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-3/REVISAO.md) |
| LI-09 | +1 min em sexta 17:59:45 vencia 18:00:45 de sexta | Cálculo por hora/minuto, sem segundos | Vetor RM-SLA-T09 | [rodada 2](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-2/REVISAO.md) |
| LI-10 | Upload incrementava o agregado mas o editor seguia com a versão antiga e o autosave seguinte dava 409 | Servidor não devolvia `currentVersion` após o upload | Toda escrita no agregado devolve a versão nova; cliente atualiza antes do próximo save | [A23-A24](../arquivo/bpm-2026-11/evidencias/P01/A23-A24-20261102.md) |
| LI-11 | Projeção de campo ocultava para todos os atores os campos `hidden` de qualquer nó; download liberava documento oculto | Projeção sem ator/atividade | Projeção contextual por ator/atividade, a mesma para leitura, escrita, anexos, timeline e `allowedActions` | [rodada 3](../arquivo/bpm-2026-11/evidencias/P01/revisao-sol-rodada-3/REVISAO.md) |

Lição de processo: "build passou" e testes com mock não provaram os cenários; os defeitos de concorrência, replay e SLA só foram fechados com testes contra PostgreSQL real e fixtures próprias.

## 5. Procedimento de deploy seguro

Derivado de [DEPLOY-PILOTO-EXISTENTE.md](../arquivo/bpm-2026-11/evidencias/P01/DEPLOY-PILOTO-EXISTENTE.md) e [ATUALIZACAO-GRANTS-20261102.md](../arquivo/bpm-2026-11/evidencias/P01/ATUALIZACAO-GRANTS-20261102.md).

1. **Backup consistente** do PostgreSQL no volume privado (ex.: `pg_dump` formato custom), validado com `pg_restore --list`, permissão `600`, SHA-256 registrado.
2. **Imagens de rollback** de backend e frontend tagueadas antes do build novo (ex.: `lgc-dev-core-backend:rollback-<pacote>-<data>`).
3. **Ensaio** de migração e testes numa cópia descartável cujo nome termina em `_test` (no P01, `p01_20261102_bpm_test`). O helper de teste recusa URL ausente, bancos operacionais (`axis`, `axis_logistica`) e hosts fora da allowlist; nunca usar `DATABASE_URL` como fallback.
4. **Sem seed operacional e sem migrate automático no startup**: o compose padrão executa migrate + seed; subir só backend/frontend com override e `--no-deps`:
   `docker compose -f docker-compose.yml -f docker-compose.p01.override.yml up -d --no-deps --force-recreate backend frontend`. Não usar `docker compose up backend` como atalho.
5. **Smoke read-only autenticado** pós-deploy (login + GETs de usuários, papéis, setores, CC, colaboradores, clientes, projetos, requisições e rotas de UI), sem POST/PUT/DELETE e sem registrar credenciais.
6. **Rollback de aplicação**: retaguear as imagens de rollback e recriar backend/frontend. Se o deploy não aplicou migração, não restaurar banco. Nunca restaurar banco por cima de efeitos externos (RM-ARQ-11).
7. Registrar em evidência: backup (caminho, hash), imagens, comandos executados, resultado de testes e smoke, e o que não foi executado.

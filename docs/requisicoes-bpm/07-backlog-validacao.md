# Backlog ordenado e validação

Não iniciar implementação antes do encerramento da etapa de projeto. Ordem: **P01 → P02 → P03 → P04 → P05 → P06 → P07 → P08 → P09**. P10 é expansão fora do primeiro ciclo. Não executar pacotes em paralelo nos mesmos arquivos. A ordem inclui gates explícitos para não publicar processos que o runtime ainda não suporta.

## P01 — Processo simples completo no motor novo

Documento executável: [P01-processo-simples.md](pacotes/P01-processo-simples.md). Sem dependência de resposta de negócio. Entrega publicação assistida + draft/envio + triagem/execução + conclusão/close + autorização, anexos, eventos, concorrência e dois relógios básicos. Gate técnico do motor próprio. Piloto isolado, sem trocar módulo existente.

## P02 — Formulários por atividade e retorno ao autor

Dependência: P01 aceito. Entrega seções/campos reordenáveis, tabela repetível e dinheiro/referências, bindings de dados comuns, AST condicional tipada, visibilidade/edição/obrigatoriedade por etapa. Fluxos devolver/corrigir/reenviar e perguntar/responder/retomar completos, com contexto e anexos. Metas básicas contam corretamente pausa de autor com intervalos; P05 ampliará a administração/calendários, não poderá deixar pausa incorreta até lá.

Arquivos esperados: `request-processes/forms/{form-schema,form-validator,condition-evaluator,field-projection}.ts`, `request-runtime/{activities,commands,policy}/`, componentes `frontend/src/features/requisicoes-bpm/forms/`, páginas do detalhe e editor assistido; migration só para metadados da correção/espera se modelo P01 não bastar. Sem mexer em RequestsService legado.

Erros: campo oculto enviado, seleção não elegível, referência retirada, tabela >200, valor fora de escala, reenvio incompleto, resposta de outro usuário e dois reenvios concorrentes. Aceite: autor corrige campo liberado e reenvia; etapa volta coerentemente, histórico mantém valores anteriores permitidos; executor pede dado e autor responde sem permissão de executor; UI/backend rejeitam os mesmos dados; campo oculto não aparece em DTO/timeline/anexo. Testes de API e jornada visual cobrem sucesso e negação, não só unitários de campo.

## P03 — Aprovação, delegação e paralelismo estruturado

Dependência: P02. Implementar approval, exclusive, split/join, slots/rodadas/snapshot; TODOS/QUALQUER_UM/N_DE_M, veto, return, rastreio da hierarquia e exceção U04; fontes hierarquia/CC/papel-setor e delegações com inbox. UI apresenta quem representa, conteúdo/revisão/hash, motivo e resultado do grupo.

Arquivos: `request-runtime/approvals/{approval-resolver,approval-quorum,approval-decisions,delegation-policy}.ts`, `request-runtime/engine/{fork,join,exclusive}.ts`, migration ApprovalSlot/Decision/MaterialSnapshot/Fork/Branch, extensão Delegation, componentes ApprovalPanel/Participants/FlowPreview na feature BPM. Alterar serviço de delegações existente só para escopo/campos compatíveis, preservando contratos legados.

Aceite: N=2/M=3 conta votos sucessivos; qualquer_um cancela pendentes sem falsificar voto; veto/reenvio criam rodada correta; duas decisões simultâneas não duplicam próximo nó; um ator delegado de dois slots conta no máximo uma vez; delegação expirada perde ação/acesso; cadeia vazia legítima avança com evento U04, erro de matriz/fila não. Dois ramos encerram uma vez após join, inclusive após restart e com mensagens repetidas. Definição sem join correspondente ou com ciclo é recusada. Gate do paralelismo antes de editor gráfico.

## P04 — Compras: proposta e autorização financeira sem efeitos externos

Dependências: P03 e catálogo confiável de materiais. B01 pode ficar pendente para uso operacional; fixtures de teste identificam a recomendação usada. Entregar análise com evidência, cotações por linha, seleção pelo CC, total decimal/compromisso, matriz versionada administrável, fracionamento serializado, aprovação do snapshot e reaprovação após mudança. Sem emissão/reserva/recebimento simulados na UI.

Arquivos: novo `backend/src/request-procurement/` (module/controller/service/DTOs/calculators/catalog-adapter), migration dos modelos de compras de `03-modelo-dados.md`, registro de handlers de domínio, `frontend/src/features/requisicoes-bpm/procurement/`; possível endpoint read-only de serviço no catálogo da Logística. Preservar catálogo/proxy já alterados pelo usuário. Registry `procurement.*` é o mecanismo de extensão, não if(category.name).

Aceite: compra com dois itens usa referências validadas; preço adulterado do browser não altera referência confiável; CC escolhe uma proposta válida, estimatedValue/total aprovado sincronizam; 0,01/limites/valores altos não têm erro float; mudança de item/preço/anexo invalida rodada; matriz sem cobertura gera incidente; soma simultânea de compras não contorna alçada; publicação v2 da matriz não muda instância v1. UI mostra “integração pendente” no ponto de emissão. Não considerar piloto operacional concluído nesta entrega.

## P05 — Calendários, ciclos, aceite, recategorização e notificações

Dependência: P04 (sequência de revisão, ainda que parte técnica pudesse ser feita antes). Entregar editor de calendário/plantão e SLA por processo/atividade, clocks úteis completos, timers duráveis, alertas/escalonamento, primeira resposta, espera limitada do autor, acceptance/close automático, reabertura dentro/fora de janela, recategorização limitada e relações/barreiras. Centro de notificações in_app persistente e leitura; e-mail depende transporte corporativo, permanece explicitamente fora do núcleo se não houver configuração.

Arquivos: `request-runtime/sla/`, `request-runtime/jobs/`, `request-runtime/notifications/`, `request-processes/calendars/`, migrations Job/Calendar/SlaSignal/Notification, componentes correspondentes; `NotificationsDropdown.tsx` só recebe fonte BPM adicional mantendo comportamento legado. Sem substituir WorkSchedule de colaborador por calendário SLA.

Aceite: todos os vetores de `06-sla-logistica.md`; alerta único em dois workers; pergunta em um ramo não pausa trabalho em outro; auto-close não ignora aceite; comentário não adia fechamento; ciclo novo não reaproveita aprovação/SLA/aceite; deadline inclusivo; fora da janela cria draft relacionado sem reenviar; recategorização muda fila/versão/visibilidade sem zerar consumo; filhas reprovadas não deixam pai concluir sem dispensa. Notificação não vaza título restrito e perde acesso junto do registro.

## P06 — Modelador visual, simulador e governança de publicação

Dependências: P03/P05; todos os nós oferecidos já têm runtime testado. Implementar canvas @xyflow/react, builder de formulário, inspector, fork pareado, condições tipadas, resolutores, políticas, SLAs, diff/clone/retire de versões e simulação sem efeito com cenários persistidos. `service` de domínio financeiro pode ser desenhado apenas se handler registrado; ações externas de P07 continuam bloqueadas para habilitação operacional.

Arquivos: `frontend/src/features/requisicoes-bpm/designer/`, `request-processes/{simulation,publication,templates}/`, snapshot tests de definição, atualização de contratos; lockfiles somente dependências necessárias. Não introduzir BPMN completo.

Aceite: administrador cria um processo novo sem editar JSON/seed/código, com decisão e tarefas paralelas, testa rotas, publica v1 e v2; instância v1 continua igual; cenário inválido mostra nó/campo e impede publicação; conteúdo mudado após validate exige revalidar; simulador não cria Request/outbox/job nem chama rede; preview de campo oculto respeita papel; editor operável por teclado/lista. Alterar template não altera processos derivados.

## P07 — Logística ponta a ponta e operação de integrações

Dependências: P04/P05/P06 + B01–B04 homologadas para habilitação. Fechar eventos v1, contrato read-only catálogo/disponibilidade/reconciliação, ordens e quantidades correlacionadas, service jobs/outbox por destinatário, inbox recuperável, retry/lease/dead-letter, UI de incidente/reprocessamento e cancelamento com compensação.

Arquivos Core: `request-runtime/integration/`, `request-procurement/purchase-orders/`, `request-runtime/handlers/`, migrations Inbox/Delivery/ExternalOperation/RequestPurchaseOrder. Compartilhados permitidos sob revisão: `backend/src/integration/outbox{,-dispatcher}.service.ts`, `backend/src/main.ts` para raw body localizado. Logística: `integration/{axis-webhook.service,material-request.adapter,outbox-dispatcher.service}.ts`, `fulfillment/`, `shipping/`, `receiving/`, `replenishment/`, endpoint axis-operations e migrations de correlação. Frontend BPM: status de operação/quantidades e incidentes. Não alterar outros domínios satélites sem necessidade do contrato.

Aceite: estoque total, parcial e zero; proposta negada, mudança pós-aprovação e pedido já emitido; recebimento/entrega parcial; cancelamento antes/depois de separação; timeout depois de commit remoto; evento repetido/fora de ordem/corpo divergente; crash entre inbox e efeito; retorno >72h tratado por reconciliação explícita; um assinante falhando não duplica efeito em outro. Um pedido/reserva por chave de negócio, nada marcado como entregue por ACK HTTP. Demonstrar Core e Logística reais em homologação com fixtures descartáveis; mocks sozinhos não encerram este pacote.

## P08 — Substituir abertura, preservar histórico e medir operação

Dependência: P07 homologado. Inventário read-only do banco alvo, exportação segura, importador de 27 categorias do seed/legado como drafts revisáveis, seleção explícita das primeiras categorias, roteamento para runtime novo, resumo e dashboard com métricas reconciliáveis. Sem copiar demos nem publicar catálogo inteiro por seed. Usuário não precisa conhecer nome de fila para abrir.

Arquivos: `request-processes/import/`, adaptadores de consulta/catálogo e rotas antigas, `RequestsPortalPage`, `MyRequestApprovalsPage`, novos dashboard/report endpoints/componentes. Migration de índice/flags se necessário; sem DROP. Workers antigos excluem BPM desde P01, não esperar P08 para separar.

Aceite: IDs/códigos/anexos/decisões antigos preservados; registro decide em um motor só; trocar flag altera novas aberturas sem migrar antigas; rollback impede novas instâncias defeituosas e não desfaz efeitos; métricas úteis/corridas corretas e filtradas; smoke de login/refresh/troca de senha, usuários/papéis, colaborador, setor, CC, cliente/projeto, integrações de cadastros. Medir p95 em dataset sintético identificado (não prometer SLA sem medição).

## P09 — Templates e expansão por donos de processo

Dependência: P08; B05 para restritos. Templates publicados: TI simples, reembolso financeiro, material com aceite, mobilização com áreas paralelas; depois RH/DP/Compliance com homologação específica. Matriz de todas as categorias da spec × campos/fluxo/regra × pacote/evidência × dono. Não tratar nome cadastrado como processo entregue.

Aceite: três processos distintos criados/mantidos pela UI sem nova condicional de categoria; mobilização aguarda todas as áreas; restrito testa identidade em listas/busca/DTO/anexos/timeline/export/notificação e conflitos por cadeia/delegação. Domínio novo que exija ação externa vira handler e pacote próprio, não script do modelador.

## P10 — Fora do primeiro ciclo

BPMN import/export amplo, motor comercial, RPA, assinatura eletrônica, canal anônimo sem login, multiempresa/unidade real, e-mail/Teams/WhatsApp, MFA por decisão, IA de triagem, object storage/antimalware, migração de instâncias abertas e eliminação física do legado. As decisões U03/U04 não são revertidas por esta lista. Nenhuma dessas extensões bloqueia P01–P08 salvo requisito novo do usuário.

## Matriz de cobertura do diagnóstico

| Risco do diagnóstico | Pacote / evidência obrigatória |
|---|---|
| R01/R02 visibilidade/autorização | P01 política/consultas/anexos; P02 campo; P03 delegado; P09 identidade restrita |
| R03 quórum/concorrência | P03 API com DB real e chamadas simultâneas |
| R04 compras/valor/proposta | P04 cálculo e snapshot; P07 efeitos externos |
| R05 aprovador ausente | P03 incidentes e exceção U04 distinta de erro |
| R06 devolução/reabertura | P02 devolução/resposta; P05 novo ciclo/janelas |
| R07 recategorização | P05 troca atômica de destino/form/participantes |
| R08 locking/retry | P01 comandos/recibos/locks, repetidos para jobs em P05/P07 |
| R09 SLA | P01 clocks básicos; P02 pausa; P05 calendários/alertas/ciclos |
| R10 schema/anexos | P01 tipos/upload real; P02 regras/tabelas; U03 sem scan |
| R11 ações da UI | P01 allowedActions; P02 responder/corrigir; P05 aceitar/reabrir |
| R12 delegação/inbox | P03 visibilidade e comando com delegação atual |
| R13 Logística | P07 contrato + jornada bilateral real |
| R14 métricas/timeline | P01 eventos; P05 tempos; P08 indicadores reconciliados |

## Definition of Done e evidências

Todo pacote entrega: regra implementada no servidor, escopo de autorização, UI funcional, persistência/migration compatível, erros/conflitos, eventos e integrações aplicáveis, testes necessários, documentação e evidência por critério. Não exigir cobertura percentual arbitrária ou testes que só espelham implementação.

Usar Vitest/Supertest existentes no backend; testes de integração de concorrência/constraints/rollback executam em PostgreSQL 16 descartável, não só mock de Prisma. Frontend não tem runner de teste no package atual; P01 deve adicionar Vitest + Testing Library/jsdom para comportamento relevante e Playwright para jornada real se ambiente permitir. Se navegador/DB não estiver disponível, registrar impedimento e deixar aceite pendente; não marcar concluído por fallback ao build.

Cada retorno em `evidencias/Pxx/README.md` deve listar cenário, fixture/ambiente, comando real, resultado, data e evidência (log sanitizado/captura), incluindo o que não rodou. Distinguir `validado tecnicamente` de `homologado pelo negócio`. Sol confere que evidência corresponde ao diff atual; hash/revisão de definição e pacote constam no relato.

Não subir `docker compose up backend` como atalho: comando atual executa migrations/seeds automaticamente. Preparar ambiente de teste separado e identificável; nunca consumir URL de desenvolvimento padrão em script destrutivo de fixture. Sem reset/limpeza recursiva do checkout do usuário.

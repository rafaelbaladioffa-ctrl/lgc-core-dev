# Regras, transições e autorização

Regras normativas da revisão 1. Estados usam os enums minúsculos existentes. Nunca permitir `PATCH status`, `requesterId`, `executionMode`, `assigneeId` ou `lockVersion` livre.

## R01 — Ciclo e comandos

| Comando | Origem e ator | Validação / efeito atômico | Destino |
|---|---|---|---|
| `createDraft` | Catálogo BPM publicado; colaborador ativo com create | Guarda versão publicada escolhida e dados parciais tipados, autor da sessão; sem atividade/SLA | `rascunho` |
| `saveDraft` | Autor em rascunho | Versão esperada; valida somente campos presentes; anexos pertencem ao registro | `rascunho` |
| `submit` | Autor em rascunho | Categoria habilitada, versão utilizável, todos os obrigatórios de abertura, fontes e anexos; cria ciclo 1, token/triagem e relógios | `enviada` |
| `claim` | Candidato elegível à atividade disponível | Ator não conflitante; uma atribuição por vez; cria histórico; claim não é primeira resposta | `em_triagem` na triagem; demais mantêm projeção |
| `release` | Responsável ou gestor da fila | Motivo para gestor; sem decisão parcial perdida; volta à lista de candidatos | Mesma fase |
| `completeActivity` (triagem) | Triador que assumiu | Campos da triagem e resolução; primeira resposta humana; avança grafo | Próxima fase configurada |
| `returnForCorrection` | Triador/aprovador autorizado | Motivo e campos corrigíveis; encerra rodada atual como devolvida; suspende demais tarefas daquele escopo | `devolvida_ajuste` se todo ciclo espera autor |
| `saveCorrection` / `resubmit` | Autor na tarefa de correção | Apenas campos explicitamente liberados; reenvio valida o formulário inteiro; nova rodada desde a triagem/approval definido | `enviada` ou `aguardando_aprovacao` |
| `decideApproval` | Titular ou delegado elegível | Snapshot/slot/rodada atuais e motivo em reject/return; quórum sobre conjunto inteiro | Aguarda grupo ou avança/reprova/devolve |
| `completeActivity` (execução) | Executor que assumiu | Resolução e evidências do nó; sem dependências/filhas bloqueantes | Próxima atividade ou `concluida` |
| `requestInformation` | Executor atual | Pergunta objetiva, campos/documentos pedidos e prazo; guarda atividade retomável | `aguardando_solicitante` se não há outra tarefa executável |
| `respondInformation` | Autor (beneficiário só se política permitir explicitamente) | Texto/anexo exigido; não modifica campos materiais congelados; completa resposta e retoma a execução original | Projeção das atividades retomadas |
| `waitThirdParty` / `resumeThirdParty` | Executor atual | Motivo, terceiro descritivo, data de revisão; não pausa solução no default | `aguardando_terceiro` se único bloqueio |
| `reassign` | Gestor da fila, dentro da fila que administra | Destino ativo/elegível, motivo, reavalia conflitos; não reinicia SLA | Mesma fase |
| `completeProcess` | Motor ao atingir end sem bloqueios | Resolution consolidada, filhas terminadas e efeitos obrigatórios confirmados; completedAt explícito | `concluida` |
| `acceptDelivery` | Autor em concluída/tarefa acceptance | Aceite vinculado a ciclo + revisão da entrega; sem aceite herdado | `concluida`; close segue política |
| `close` | Gestor da fila ou timer autorizado | Concluída; exige aceite se snapshot manda; nada externo pendente | `encerrada` |
| `reopen` | Autor/gestor da fila com motivo | Até reopenDeadlineAt inclusive: ciclo novo, ponto de reentrada publicado, sem decisões/aceite reutilizados | `enviada` (retriagem), depois projeção |
| `createRelatedDraft` | Autor fora da janela ou reprovada | Novo ID/código/versão publicada atual; vínculo `origina`; nada é reenviado automaticamente | Novo `rascunho`; original intacto |
| `recategorize` | Gestor/triador com escopo de origem e destino, apenas triagem antes de efeito externo | Motivo, mapa explícito de campos, nova versão ativa e fila configurada; encerra ciclo antigo `superseded`, inicia correção no novo | `devolvida_ajuste` |
| `cancel` | Autor antes de execução/efeito; gestor da fila depois | Motivo; cancela atividades/jobs ainda sem efeito; após efeito abre pedido de cancelamento e compensação | `cancelada` só quando não há impacto pendente |
| `resolveIncident` | Operador autorizado no processo | Tipo de resolução permitido e motivo; nunca editar status diretamente; nova resolução de responsável/job | Fase anterior retomada |

P01 entrega apenas o subconjunto listado em seu pacote. Regras futuras não devem gerar botões de mentira. `planejada`, `suspensa`, `expirada` não têm comandos neste ciclo; rejeitar publicação que os exija. `reaberta` é evento, não estado de espera. Não manter estados sem saída.

Cancelamento em concluída/encerrada é inválido: usar reabertura/registro relacionado. Reprovação segue saída `reject` até fim de negócio reprovado; sem reabrir a mesma rodada por edição. Devolução não é reprovação. Encerrar por falta de resposta do solicitante não é automático: fim do prazo retoma contagem de solução e notifica gestor, preservando pendência.

## R02 — Projeção do status no paralelismo

Enquanto houver incidente bloqueante, mostrar badge “Pendência de configuração/integração” separado; status conserva a fase, sem usar `aprovada` para erro. Depois: terminal do ciclo prevalece; tarefa de execução disponível/em curso → `em_atendimento`; aprovação ativa → `aguardando_aprovacao`; triagem disponível → `enviada`, assumida → `em_triagem`; só correções → `devolvida_ajuste`; só respostas → `aguardando_solicitante`; só terceiro → `aguardando_terceiro`; acceptance/end → `concluida`. Essa precedência serve à listagem; detalhe e inbox exibem todas as atividades. Invariante: instância ativa tem token, tarefa, job, timer ou incidente explicando a espera.

## R03 — Responsáveis e conflitos

Resolutores registrados: `queueMembers(queueId)`, `explicitCollaborators(ids)`, `requester`, `directManager(subject)`, `managementLevels(subject, levels)`, `costCenterResponsible`, `roleInSector(roleId, sectorId)`. Cada nó contém tipo, escopo, fallback e comportamento vazio. Não usar string de papel fixa no código de compra.

- Pessoas operacionais usam Collaborator.id; segurança usa User.id ligado e ativo. Sem usuário ativo vinculado não é candidato executável. Usuário sem colaborador pode modelar/ver configuração com permissão específica, mas não assumir/decidir requisição.
- Fila tem membros e gestores explícitos. Pertencer ao setor ou ter `request:update` não torna alguém membro de todas as suas filas. Configuração incompleta gera incidente.
- Hierarquia atual é lida ao ativar tarefa, com trilha de resolução; decisões preservam os IDs resolvidos naquele instante. Ao decidir, revalidar atividade, conta ativa, conflito e delegação. Mudança organizacional invalida candidatura sem transferir silenciosamente a decisão histórica.
- Detectar ciclo/limite na hierarquia e abrir incidente `INVALID_HIERARCHY`. Não tratar ciclo, usuário desligado ou consulta falha como topo hierárquico válido.
- Triador, aprovador e delegado não podem ser solicitante/beneficiário. Executor comum pode ser autor somente quando a política do processo permitir; default não. Conflitos explícitos do registro prevalecem sobre papel/admin/delegação.
- Responsável de centro de custo igual ao autor/beneficiário procura gestor independente acima, registrando salto. Se não encontrar, incidente; exceção de cadeia vazia abaixo aplica-se só a resolutores hierárquicos explicitamente marcados, não a centro de custo obrigatório.
- Para denúncia futura: envolvidos e toda a cadeia superior ficam excluídos da triagem/aprovação/gestão operacional; configuração exige grupo independente. Publicação desse template fica bloqueada até homologação própria (P09).

**Exceção preservada de §27.2:** nos resolutores `directManager`/`managementLevels`, níveis inexistentes são pulados. `onEmptyHierarchy: "skip_with_audit"` é permitido e explícito no snapshot, inclusive para matriz financeira legada convertida. Se a cadeia alcança topo válido sem candidato, registrar `approval.skipped_empty_hierarchy` com motivo e avançar; UI mostra aviso permanente no histórico. O editor exige ciência dessa regra ao publicar, mas não inventa aprovador de fallback. `onEmptyHierarchy: "incident"` pode ser escolhido para novos processos. Matriz sem faixa, fila vazia, lista de IDs inválida e responsável obrigatório ausente SEMPRE são incidentes, não essa exceção.

## R04 — Aprovação

Cada atividade de aprovação tem rodada, `M` slots únicos de titulares elegíveis, regra e `N` quando aplicável. `M` é congelado ao ativar, depois de deduplicação/conflitos/saltos. Não recalcular denominador pela lista de pendentes. N_DE_M exige 1 ≤ N ≤ M; se resolução reduz M abaixo de N, incidente, sem reduzir N silenciosamente.

Contagem lê todas as decisões da rodada. TODOS aprova com M votos; QUALQUER_UM com 1; N_DE_M com N. Regra de rejeição v1: qualquer voto reject encerra a atividade na saída reject, mesmo antes de alcançar quórum; é um veto explícito do snapshot. Return fecha a rodada e pede correção. Quando quórum/reject/return vence, slots restantes recebem fechamento `superseded`/`not_required` sem fabricar votos. Corrida approve/reject é serializada pelo lock Request: primeira conclusão válida vence; segundo comando retorna 409 se atividade já fechou.

Um ator real só pode contar um voto por atividade/rodada, mesmo sendo delegado de vários titulares ou titular e delegado simultaneamente. Se elegível a mais de um slot, deve escolher slot; servidor não adivinha. Constraint de voto por ator e por slot. Delegação de um salto, sem transitividade; válida em `[startsAt, endsAt)`, escopo setor e processo/categoria quando disponível; revogação/inatividade reavaliadas a cada decisão. Inbox inclui delegação válida; expiração retira ação, nunca apaga decisão passada. Delegar não concede acesso geral à fila.

Snapshot aprovado inclui dados materiais canônicos, revisão e hashes dos documentos necessários. Diferença em itens, quantidade, fornecedor/proposta, valor, beneficiário, projeto, centro de custo, escopo, datas ou anexo de proposta invalida a rodada afetada inteira. V1 reinicia todas as aprovações financeiras do ciclo (sem otimização por faixa). Decisões são imutáveis e marcadas como superadas por evento; não editar/apagar voto. Comentário/pergunta sem mudança material não invalida.

## R05 — Política central de acesso

Regra: permissão atual de recurso E escopo do processo/fila/registro E atividade correspondente E campo liberado E ausência de conflito. Permissão de catálogo não implica leitura de instâncias. Admin do sistema não tem bypass de conteúdo restrito. Auditor tem leitura apenas com concessão de escopo, sem mutação.

| Pessoa / vínculo | Leitura padrão | Ações |
|---|---|---|
| Autor | Seu rascunho e conteúdo público do próprio registro | Editar/enviar/corrigir/responder/aceitar/contestar/cancelar conforme fase |
| Beneficiário | Após envio, se `beneficiaryCanRead=true` (default true para processos internos simples) | Acompanhamento; não herda decisão do autor |
| Candidato de fila | Registros enviados da fila, se classificação interna e policy permite | Assumir atividade elegível; não editar antes de claim |
| Executor/triador atribuído | Dados e documentos necessários à atividade | Campos e comandos da atividade |
| Titular ou delegado atual | Pacote de decisão e dados públicos autorizados | Votar apenas na atividade/slot elegível |
| Gestor explícito de fila | Registros no seu escopo; restritos exigem grant específico | Atribuir, prioridade, incidentes e cancelamentos com motivo |
| Observador concedido | Campos públicos autorizados e prazo da concessão | Comentário público se permitido; sem tarefas implícitas |
| Auditor com grant | Histórico e leitura mascarada do escopo | Sem ações operacionais |
| Modelador/publicador/admin sem vínculo | Configuração do processo | Não lê instância por esse papel |
| Outro setor/ID conhecido | Nenhuma informação sobre registro | 404 para registro oculto; sem contagem ou título |

Rascunho é privado ao autor; beneficiário/fila/aprovador ainda não o vê. Em `restrita`/`confidencial`, membresia da fila não basta: atribuição, candidatura explicitamente provisionada para a tarefa, participação direta ou grant restrito com campos e validade. `interna` também não significa leitura global do ERP. Hierarquia não concede leitura implícita; só política e vínculo explícitos. Grants gerenciais não podem adicionar pessoas conflitantes.

O mesmo predicado de visibilidade compõe consultas ANTES de paginação, contagens e agregação. Não carregar tudo para filtrar em JS. Projetar DTO por allowlist, sem retornar `...PrismaModel`. Busca/texto/ordenação não podem usar campo oculto como oráculo; exportação e métricas usam o mesmo escopo. Zero resultados não distingue registro oculto de ausente.

`allowedActions` vem do servidor por registro/atividade, mas é apenas ajuda de UI: comando sempre recalcula. Campos têm `hidden/read/write/required`, por nó e vínculo; oculto não é enviado; read não aceita patch. Campo material não editável fora de correção formal. Desconhecido ou não liberado → 422 `FIELD_NOT_WRITABLE`, sem aplicar o restante do patch.

## R06 — Comentários, documentos e identidade

- Público significa visível aos participantes autorizados do registro, não à organização inteira. Nota interna só equipe explicitamente autorizada do ciclo; aprovação isolada não libera todas as notas internas. Comentário em terminal é permitido com comment e acesso, sem reabrir processo.
- Anexo tem classificação e opcional vínculo a campo/atividade; download exige acesso ao registro E ao documento. Associação por ID de outro registro é inválida. Versão nova tem hash/linha nova; substituição nunca altera bytes já aprovados.
- Anonimato autenticado futuro oculta autoria em todos os DTOs, eventos, comentários do autor, nomes de upload, notificações, exports e diagrama; acesso à identidade requer permissão atual `request:view_whistleblower_identity` E grant restrito no processo. Não é canal anônimo sem login. Arquivo pode conter identidade no próprio conteúdo; não prometer anonimização automática. P09 deve homologar esse fluxo antes de abrir categoria restrita ao novo motor.
- Logs operacionais só IDs técnicos/códigos de erro/correlação; não armazenar formulário sensível, token ou base64. Timeline contém resumo filtrado; auditoria técnica não pode ser usada como atalho para revelar campo oculto.

## R07 — Prioridade, recategorização e dependências

Em P01 usar normal/alta/baixa/crítica com impacto/justificativa obrigatórios para crítica. P05 implementa a matriz impacto × urgência de §8 da especificação (`P1=critica`, `P2=alta`, `P3=normal`, `P4=baixa`). Gestor pode alterar com motivo; auditoria mantém solicitada, calculada e efetiva. Alteração não altera meta retroativamente sem comando explícito de prazo.

Recategorização não é migração de versão em andamento: somente durante triagem antes de aprovação/efeito, cria ciclo de definição nova na mesma Request, preservando eventos e decisão anterior (se houver, operação é recusada). Request.categoryVersionId aponta versão do ciclo atual; cada ProcessInstance guarda a sua. Setor e fila mudam na mesma transação, participantes antigos perdem acesso operacional; histórico só conforme grant vigente. SLA de processo mantém consumo desde primeiro envio e usa meta nova com evento; nunca zera tempo por trocar categoria. P01 não oferece esse comando.

Relações impedem autociclo e ciclos de dependência (busca de alcance com limite explícito). Filha concluída/encerrada atende barreira. Cancelada/reprovada exige dispensa explícita e motivada do gestor do pai; não satisfaz barreira automaticamente. Leitor do pai sem acesso à filha vê apenas “dependência pendente”, sem código/título sensíveis. Cancelar pai não cancela filhas com efeitos sem coordenação.

# Requisições Axis: diagnóstico e evolução para gestão de processos

Data da análise: 01/11/2026. Status: planejamento, sem alteração da aplicação.

## 1. Direção recomendada

Evoluir o módulo para uma plataforma de processos configuráveis integrada ao Axis. O objetivo é permitir que o administrador desenhe, configure, teste e publique processos e que cada pessoa receba suas atividades, prazos e ações permitidas. Novas categorias e mudanças usuais de negócio devem ser configuradas pela interface.

A referência funcional é o Lecom: modelagem visual, formulários, workflow, área de atividades, SLA, integrações e indicadores. Não se promete equivalência integral com um produto comercial nem compatibilidade BPMN completa nesta primeira entrega.

O Axis já tem componentes aproveitáveis. A mudança central é separar **definição do processo**, **execução de cada instância** e **interface das atividades**. Hoje essas responsabilidades estão concentradas em métodos específicos de requisição, condições no React e seeds.

## 2. Escopo e limites da análise

Foram inspecionados schema Prisma, serviços, controladores, DTOs, rotas e telas de requisições, categorias, delegações, alçadas, feriados, auditoria, notificações, seeds e adaptador de requisições da Logística. A especificação `REQUISICOES_SPEC.md` é a intenção funcional; o código é a evidência do comportamento implementado.

Esta é uma análise estática do checkout atual, incluindo alterações locais já existentes. Não foram aplicadas migrations, executados seeds, modificados dados ou validados fluxos em produção. Categorias e alçadas dos seeds não provam que esses dados estejam carregados no banco. Comentários e README contêm descrições desatualizadas; não foram tratados como prova de implementação.

Não foram encontrados testes de requisições no backend principal na busca por arquivos de testes. Existem configurações Vitest e testes no projeto satélite de Logística; isso não demonstra cobertura do motor atual. A homologação operacional fica como primeira entrega do plano.

### Fontes locais principais

- `backend/prisma/schema.prisma`: entidades, estados, relações e campos.
- `backend/src/requests/requests.service.ts`: regras executadas pelo módulo.
- `backend/src/requests/requests.controller.ts` e `dto/`: operações e permissões.
- `backend/src/request-categories/`: catálogo e primeira versão de categoria.
- `backend/src/delegations/`, `approval-authority-rules/`, `holidays/`: regras auxiliares.
- `backend/src/requests/attachment-security.ts`: política de arquivos.
- `frontend/src/pages/{RequestsPortalPage,NewRequestPage,MyRequestsPage,RequestsQueuePage,RequestDetailPage,MyRequestApprovalsPage,RequestsDashboardPage}.tsx`.
- `frontend/src/components/layout/NotificationsDropdown.tsx`.
- `backend/prisma/seed-requests-fase1.ts`, `seed-requests-fase2-sectors.ts`, `seed-requests-parallel-demo.ts`, `seed-approval-authority-matrix.ts`.
- `lgc-dev-logistica/backend/src/integration/material-request.adapter.ts`.

## 3. Situação atual: regras e condições

### 3.1 Catálogo, abertura e formulários

| Área | Comportamento observado |
|---|---|
| Categoria | Código único, setor, categoria-pai opcional, ativa/inativa, confidencialidade, exigência de aceite e uso de alçada dinâmica. |
| Versão | Guarda formulário, passos de aprovação, dois SLAs, autor e data de publicação. A requisição referencia uma versão específica. |
| Administração | API cria categoria com versão 1 publicada imediatamente; lista catálogo ativo e consulta versões. Não há ciclo completo de editar rascunho, testar e publicar pela interface. |
| Abertura | Exige usuário autenticado ligado a colaborador, categoria ativa e versão existente. Solicitante vem da sessão; beneficiário pode ser outro colaborador existente. |
| Identificação | Código `REQ-AAAA-000001`, com contador anual atualizado atomicamente em transação. |
| Destino | Setor da categoria; primeira fila desse setor, criada automaticamente se inexistente. Não há roteamento configurável por condição. |
| Dados comuns | Título, descrição, prioridade, confidencialidade, data necessária, projeto, centro de custo, valor decimal, beneficiário, campos JSON e vínculo com pai opcional. |
| Prioridades | Baixa, normal, alta e crítica. Não foi encontrada exigência de impacto para prioridade crítica. |
| Campos dinâmicos | Texto, texto longo, número, data, seleção, checkbox e attachment. Fontes de seleção: projetos, colaboradores, clientes, centros de custo e cargos. |
| Validação dinâmica | Backend verifica presença dos campos marcados obrigatórios. Não há validador completo de tipos, opções, limites, dependências ou regras por etapa. |
| Rascunho | API cria como rascunho, mas já exige campos obrigatórios. Tela cria e envia em duas chamadas consecutivas; sem salvar parcialmente ou retomar edição pela interface atual. |
| Edição | Apenas solicitante e apenas em rascunho. Incrementa `lockVersion`, mas não exige versão esperada no update. |
| Envio | Apenas solicitante e apenas rascunho. Revalida campos obrigatórios, com exceção quando existe array `purchaseItems`, e emite `request.submitted`. |

O campo dinâmico `attachment` da abertura recebe nomes de arquivos digitados, não um upload real. Campos financeiros dentro de `formData`, como `valor`, não são automaticamente mapeados para `estimatedValue`. Isso afeta a interpretação de alçada quando ela for habilitada.

### 3.2 Ciclo de vida realmente implementado

| Ação | Origem / condição | Resultado |
|---|---|---|
| Criar | Categoria ativa e dados válidos | `rascunho`. |
| Enviar | `rascunho`, pelo solicitante | `enviada`. |
| Devolver na triagem | `enviada`, motivo obrigatório, ator diferente de solicitante/beneficiário | `devolvida_ajuste`. |
| Recategorizar | `enviada`, nova categoria com versão | Troca versão e vai para `devolvida_ajuste`; não atualiza setor/fila no mesmo método. |
| Aceitar triagem comum | `enviada`, sem conflito | Resolve aprovadores; passa a `aguardando_aprovacao` ou `aprovada` se não houver aprovadores resolvidos. Triador vira responsável. |
| Aceitar triagem de compra | `enviada`, Suprimentos/admin, sem ser solicitante/beneficiário | `em_atendimento`, responsável = triador; caminho especial antecede motor comum. |
| Atribuir | Permissão `request:assign` | Muda responsável/fila; método não restringe por estado nem equipe. |
| Aprovar | `aguardando_aprovacao`, aprovador da etapa ativa ou delegado válido | Registra decisão; avança conforme regra do grupo; ao terminar vai para `aprovada`. |
| Reprovar | Mesmas condições de decisão | `reprovada`; demais aprovações pendentes ficam `devolvido`. Qualquer reprovação encerra o fluxo, inclusive em paralelo. |
| Iniciar | `aprovada` ou `planejada` | `em_atendimento`; para SLA de primeira resposta. |
| Pedir informação | `em_atendimento` | `aguardando_solicitante`, comentário público e pausa do SLA de solução. |
| Retomar | `aguardando_solicitante` ou `aguardando_terceiro` | `em_atendimento`; desloca prazo de solução pela duração corrida da pausa. Resposta é opcional. |
| Concluir | `em_atendimento`, resolução preenchida, sem subtarefas abertas | `concluida`; para SLA de solução e emite evento. |
| Aceitar entrega | `concluida`, somente solicitante | Registra aceite; não muda estado. |
| Encerrar | `concluida`; se categoria exige aceite, ele deve existir | `encerrada` e data de encerramento. |
| Encerrar automaticamente | Job por hora, concluída sem atualização há mais de 3 dias corridos | Tenta encerrar; adia se faltar aceite obrigatório. |
| Reabrir | `concluida`, `encerrada` ou `reprovada`; solicitante ou permissão de gestão | Até 5 dias úteis da referência vai para `em_triagem`; reprovada não tem janela. Fora da janela cria novo rascunho relacionado. |
| Cancelar | Exceto `concluida`, `encerrada` e `cancelada`; motivo obrigatório | `cancelada`; não há checagem de dono ou impacto operacional no serviço. |

Estados existentes no enum: `rascunho`, `enviada`, `em_triagem`, `aguardando_aprovacao`, `aprovada`, `planejada`, `em_atendimento`, `aguardando_solicitante`, `aguardando_terceiro`, `concluida`, `encerrada`, `devolvida_ajuste`, `reprovada`, `cancelada`, `suspensa`, `reaberta`, `expirada`.

Ter um estado no enum não significa ter uma operação para chegar ou sair dele. Exemplos: não há retorno implementado de `devolvida_ajuste` para edição/envio; a reabertura coloca em `em_triagem`, mas triagem só aceita `enviada`. Não há operações completas de planejar, suspender, expirar ou aguardar terceiro.

### 3.3 Aprovações, hierarquia e delegações

- Regras disponíveis no JSON: gestor direto, nível gerencial e lista explícita de colaboradores.
- Ordem gerencial: colaborador → supervisor → coordenador → gerente → diretor.
- Gestor direto sobe pela hierarquia ao encontrar pessoa conflitante; se não encontra supervisor elegível, retorna lista vazia.
- Por nível, considera níveis superiores ao solicitante e percorre supervisores. Níveis ausentes podem ser pulados; o comportamento não garante substituição obrigatória.
- O ramo escolhido depende do primeiro passo do workflow. Misturar listas de colaboradores e níveis gerenciais não é suportado adequadamente. O ramo gestor direto retorna um único passo.
- Solicitante e beneficiário são excluídos da resolução comum. Grupos de colaboradores sem candidatos são ignorados.
- Aprovação paralela tem configuração `todos`, `qualquer_um` e `n_de_m`; implementação precisa de correção, descrita na seção 4.
- Delegação possui delegador, delegado, início, fim, setor opcional e revogação. Início aceita tolerância de 60 segundos no passado; fim deve ser posterior ao início. Só delegador revoga.
- Decisão aceita delegado ativo dentro do setor/intervalo. A consulta “Minhas aprovações” busca apenas aprovador titular e não inclui tarefas recebidas por delegação.
- Conflito de interesse não é revalidado de forma completa no momento da decisão via delegado ou responsável do centro de custo.

### 3.4 Alçadas

Categoria com `useDynamicAuthority` resolve níveis por faixa de valor; faixa do setor prevalece sobre global. Sem regra aplicável, retorna fluxo vazio. A matriz é administrável por API, mas não há painel completo de manutenção.

Seed sugerido, cuja aplicação no banco não foi verificada:

| Valor | Níveis |
|---|---|
| 0 a 1.000,00 | Supervisor |
| 1.000,01 a 10.000,00 | Supervisor e coordenador |
| 10.000,01 a 50.000,00 | Coordenador e gerente |
| 50.000,01 a 100.000,00 | Gerente e diretor |
| Acima de 100.000,00 | Diretor |

A detecção de fracionamento soma valores de outras requisições do mesmo solicitante nos últimos 30 dias, exceto rascunhos, canceladas e reprovadas, sem filtrar por categoria/fornecedor/setor. Usa valor próprio + soma e registra detecção quando há soma positiva. Não calcula compromisso recorrente, impostos ou aditivos. Faixas em centavos podem deixar lacunas para valores com quatro casas decimais. Não há validação completa de sobreposição ou cobertura.

### 3.5 Compras: fluxo específico atual

1. Categoria reconhecida por código `SUP-COMPRA` ou nome “compra de material”.
2. Tela consulta catálogo da Logística, permite busca, categoria/subcategoria e vários itens com quantidade. Exige centro de custo e descrição.
3. Backend exige lista não vazia, `materialId` string, quantidade positiva e preço não negativo; calcula total com `Number`/`toFixed(2)`. Não consulta o catálogo para confirmar existência ou preço enviado.
4. Título gerado: “Compra de Materiais - [setor-pai/setor do solicitante]”.
5. Suprimentos/admin aceita triagem e entra diretamente em atendimento, sem cadeia hierárquica comum.
6. Analista registra por item: situação de estoque, quantidade disponível e necessidade de cotação, além de observações.
7. Cotação só em atendimento, após análise, com valor positivo e responsável definido no centro de custo. Guarda fornecedor textual, número, valor, observações e IDs de anexos. Suporta várias cotações e atualização por identificador.
8. Primeiro registro de cotação cria aprovação do responsável pelo centro de custo e coloca a requisição em aprovação. Se já houver essa aprovação aprovada, o método preserva o estado e não exige nova aprovação por alteração de cotação.
9. Responsável do centro de custo escolhe a cotação. A escolha não atualiza `estimatedValue`; registro da cotação atualiza esse valor independentemente da escolha final.
10. Aprovação do centro de custo exige existência de análise. Não exige expressamente cotação selecionada válida nem aprovação vinculada ao hash/versão da proposta.
11. Após aprovação retorna ao caminho comum (`aprovada` → iniciar → concluir).

Análise de estoque é registro manual; consultar catálogo não prova reserva, baixa, compra ou recebimento efetivos. Há trecho para acrescentar centro de custo no ramo comum da triagem, mas compras já retornam antes desse trecho.

### 3.6 SLA, arquivos, visibilidade e gestão

- Dois relógios: primeira resposta e solução; criados ao finalizar aprovação. Tempo anterior de envio, triagem e aprovação fica fora desses relógios. Caminho especial de compras não cria os relógios na aceitação da triagem.
- Prazo inicial usa segunda a sexta, 08h–18h, feriados cadastrados e deslocamento fixo UTC−3. Não há calendário por fila, unidade, categoria ou plantão.
- Seeds usam 240 minutos para resposta e 2.880 para solução. Com expediente de 600 minutos/dia, 2.880 minutos representam 4,8 expedientes, apesar do comentário de seed dizer “2 dias úteis”.
- Job a cada 5 minutos registra alertas de 50/80/100% e emite outbox. Percentual usa tempo corrido entre início e vencimento, não consumo efetivo de minutos úteis.
- Ao estourar solução, um escalonamento reatribui ao supervisor do responsável, se houver. Não existe cadeia progressiva configurável.
- Pausa move `SlaClock.targetAt`, mas não sincroniza os campos `slaDue*` da requisição usados por telas/notificações.
- Comentários públicos/internos; detalhe filtra internos conforme executor/aprovador. Escrita não reutiliza uma política central de acesso ao registro.
- Detalhe restrito só para solicitante, beneficiário, executor ou aprovador titular. Administrador genérico não ganha acesso automático. Delegado não é incluído nessa lista.
- Anonimato depende de `CMP-DENUNCIA` + `formData.anonimo === true`; preserva autoria no banco. Detalhe mascara `requesterId` para terceiros sem permissão específica. Isso não equivale a canal anônimo sem login nem anonimização de todos os metadados.
- Denunciado em `envolvido_id` e sua cadeia superior são excluídos na triagem comum/seleção de aprovadores. Necessário verificar demais superfícies e atores delegados.
- Arquivos: Base64 na API, binário no PostgreSQL, hash SHA-256, nome seguro, versão e vínculo anterior; limite de 25 MB/arquivo e 100 MB/requisição; PDF, PNG, JPEG e ZIP, incluindo Office tratado como ZIP. Bloqueio básico de executáveis/scripts. Sem antivírus real, quarentena ou armazenamento externo. Download autenticado existe no backend; falta experiência geral de anexos no detalhe atual.
- Subtarefas: requisição filha ligada ao pai; pai não conclui se filha não estiver concluída, encerrada ou cancelada. Filha reprovada continua bloqueando.
- Dashboard: volume por status, backlog, idade, percentis, taxas e carga. Percentis usam criação até encerramento/última atualização em horas corridas, apesar do nome “SLA solução”. Sem filtros gerenciais completos e escopo uniforme.
- Notificações: dropdown consulta filas a cada minuto e aponta atrasos; não é uma caixa persistente com destinatário, leitura e preferências.
- Existem auditoria geral de endpoints e eventos de domínio; não há timeline operacional completa exposta no detalhe. Cobertura e atomicidade dos eventos variam por método.
- Outbox emite eventos de requisições. O adaptador de material da Logística examinado aceita `material_request.*` ou o legado `ticket.status_changed`; não consome diretamente `request.status_changed`. O contrato ponta a ponta exige alinhamento.

### 3.7 Catálogo encontrado nos seeds

São 27 categorias de negócio nos dois seeds: 13 na fase 1 e 14 na fase 2. As definições exatas de campos, opções e obrigatoriedade estão nos arquivos de seed indicados acima. As demos são adicionais e não devem integrar o catálogo operacional publicado.

| Setor | Categorias / códigos |
|---|---|
| TI | Acesso `TI-ACESSO`; suporte `TI-SUPORTE`; equipamento `TI-EQUIPAMENTO`. |
| Financeiro | Reembolso `FIN-REEMBOLSO`; adiantamento `FIN-ADIANTAMENTO`. |
| Suprimentos | Compra de material `SUP-COMPRA`. |
| Almoxarifado e Patrimônio | Material em estoque `ALM-MATERIAL`, com aceite. |
| Frota | Reserva `FRT-RESERVA`. |
| RH | Vaga `RH-VAGA`. |
| DP | Férias `DP-FERIAS`; atestado `DP-ATESTADO`. |
| Administração | Viagem `ADM-VIAGEM`; sala/evento `ADM-SALA`. |
| Jurídico | Contrato `JUR-CONTRATO`; parecer `JUR-PARECER`; contencioso `JUR-CONTENCIOSO`. |
| Compliance | Due diligence `CMP-DUEDILIGENCE`; denúncia `CMP-DENUNCIA`; dados pessoais `CMP-LGPD`. |
| Operações | Mobilização `OPS-MOBILIZACAO`; ocorrência `OPS-OCORRENCIA`; paralisação `OPS-PARALISACAO`. |
| Qualidade | Não conformidade `QUA-RNC`; ação `QUA-ACAO`. |
| HSE/SST | Incidente `HSE-INCIDENTE`; EPI `HSE-EPI`; condição insegura `HSE-CONDICAOINSEGURA`. |

A especificação tem catálogo pretendido mais amplo. Ter uma categoria com o nome de um processo não significa executar suas regras específicas: mobilização, por exemplo, ainda não dispara automaticamente atividades simultâneas para todas as áreas.

## 4. Lacunas prioritárias antes de ampliar o módulo

Achados abaixo decorrem da leitura do código e devem receber reprodução controlada e teste de regressão antes de serem tratados como incidentes observados em produção.

| ID | Prioridade | Evidência e consequência | Aceite da correção |
|---|---|---|---|
| R01 | P0 | `findQueue` retorna registros completos sem política uniforme de participante/confidencialidade/anonimato. Fora da exceção Suprimentos, filtro de setor é escolhido pelo cliente. Dashboard é global com `request:read`. | Matriz de acesso aplicada no servidor a detalhe, listagens, agregados, anexos e exportação; nenhum dado proibido sai no JSON. |
| R02 | P0 | Cancelamento verifica estado, mas não dono/equipe. Comentário/upload verificam existência, não participação. Outras mutações dependem de permissão ampla, sem escopo do registro. | Todas as ações usam política central por usuário, atividade e registro; testes entre setores e usuários. |
| R03 | P0 | `activeStepRows` devolve somente pendentes; `approve` calcula contagem e total desse subconjunto. Em N_DE_M=2 com três, decisões sucessivas contam 1, sem acumular votos prévios, e podem deixar o grupo travado. TODOS funciona na sequência simples porque o conjunto diminui até o último pendente, mas não há proteção suficiente para decisões concorrentes. | Contagem sobre grupo completo; decisões anteriores entram no quórum; decisões simultâneas não perdem avanço nem duplicam transição. |
| R04 | P0 | Compras aceita preço do cliente; alteração de cotação pode preservar aprovação antiga; seleção não sincroniza valor aprovado. | Valor calculado com decimal no servidor e origem validada; decisão vinculada à versão da proposta; mudança material exige reaprovação. |
| R05 | P0 | Ausência de alçada/aprovador pode resolver em lista vazia e aprovar; conflito do delegado/centro de custo não é tratado de ponta a ponta. | Falta de responsável obrigatório gera exceção visível; nenhuma autoaprovação acidental ou decisão em conflito. |
| R06 | P1 | Devolução não tem corrigir/reenviar; reabertura cai em estado que triagem não aceita. | Solicitante corrige e reenvia; reabertura inicia novo ciclo coerente, sem aceite/aprovação/SLA anteriores indevidamente reutilizados. |
| R07 | P1 | Recategorização troca versão sem setor/fila e sem validação completa da nova categoria/formulário. | Valida destino ativo, permissões, mapeamento de campos e motivo; muda roteamento atomicamente. |
| R08 | P1 | `lockVersion` só incrementa; verificação de estado ocorre frequentemente fora da transação. | Comando usa versão esperada e atualização condicional; conflito retorna 409; retry não repete efeito. |
| R09 | P1 | SLA mistura tempo útil/corrido, prazo duplicado e referência `updatedAt`; compra tem caminho distinto. | Relógio único autoritativo, timestamps de ciclo explícitos, calendário testado e visão consistente em painel/notificação. |
| R10 | P1 | Obrigatoriedade dinâmica é superficial e anexos na abertura são nomes; presença de `purchaseItems` contorna validação comum no envio. | Schema validado no backend por categoria/etapa; documentos exigidos referenciam uploads válidos liberados. |
| R11 | P1 | Backend permite reabrir pelo solicitante, mas tela mostra botão apenas a quem tem update; retomada exige update e não oferece resposta adequada ao solicitante. | API informa ações habilitadas por ator; tela oferece corrigir, responder, aceitar e contestar conforme atividade. |
| R12 | P1 | Minhas aprovações omite delegações; detalhe restrito pode negar ao delegado autorizado a decidir. | Inbox e acesso incluem delegação válida com escopo e sem conflito. |
| R13 | P1 | Produtor Core e consumidor Logística usam contratos distintos para material. | Teste de contrato: aprovação → ordem única → atendimento → retorno ao Core; cancelamento registra impactos. |
| R14 | P2 | Métricas denominadas SLA representam ciclo corrido; auditoria de domínio é desigual; sem timeline completa. | Definições explícitas, eventos consistentes e histórico legível com autor, motivo, antes/depois e versão. |

## 5. Comparação com a referência Lecom

| Capacidade de referência | Axis atual | Entrega necessária |
|---|---|---|
| Modelagem visual de processos | Lista JSON de aprovadores + métodos fixos | Editor, validação, simulação e execução de grafo. |
| Formulários e regras configuráveis | Campos básicos, sem administração completa | Construtor visual e regras por atividade, com validação no servidor. |
| Área de atividades | Minhas requisições, fila e aprovações separadas | Inbox de tarefas com responsável, prazo, ação e contexto. |
| Versionamento/publicação | Referência a versão de categoria | Rascunho, revisão, publicação imutável e políticas incluídas no snapshot. |
| SLA e escalonamento | Dois clocks globais e um nível | Calendários e SLAs por atividade/processo; escalonamento configurável. |
| Integração | Outbox e consulta ao catálogo satélite | Contratos versionados, ações automáticas, retorno, retry e tratamento de falhas. |
| Indicadores | Dashboard inicial | Métricas por etapa, fila, versão e processo; gargalos e histórico. |

Fontes oficiais consultadas: [BPM Lecom](https://www.lecom.com.br/bpm/), [documentação Lecom v7](https://lecomsa.atlassian.net/wiki/spaces/VPL/pages/2991685708/v.7.0%2B-%2BDocumenta%2Bo%2BPlataforma%2BLecom), [modelagem e publicação de diagramas](https://lecomsa.atlassian.net/wiki/spaces/TDL/pages/1109557320/Diagrama). Recursos exatos variam por versão/contratação; o comparativo é funcional, não uma certificação de paridade.

## 6. Arquitetura alvo proposta

Manter NestJS, PostgreSQL, Prisma, React, usuários, hierarquia, catálogo e integração existentes. Separar módulos internos por responsabilidade antes de considerar serviços separados.

### 6.1 Definição e execução

| Componente proposto | Responsabilidade |
|---|---|
| ProcessDefinition | Identidade, código, dono e catálogo do processo. Categoria pode apontar para esse processo. |
| ProcessVersion | Snapshot publicado: grafo, formulários, políticas, responsáveis, SLA e contratos. Sem edição após publicar. |
| FormDefinition/FormVersion | Campos, seções, tabelas repetíveis, fontes, validações e permissões por etapa. |
| ProcessInstance | Execução vinculada a versão, requisição e variáveis; estado e versão de concorrência. |
| ActivityInstance | Etapa instanciada, responsável/candidatos, resultado, prazo, ciclo e status. |
| ExecutionToken | Caminhos ativos e correlação de divisões/junções, incluindo paralelismo. |
| ApprovalDecision | Decisão imutável vinculada à atividade, rodada e versão dos dados aprovados. |
| BusinessCalendar/SlaPolicy | Calendários, pausas, vencimentos e escalonamento versionados. |
| Policy/Participant | Leitura e ações por papel no processo, setor/fila, sigilo e conflito. |
| ProcessEvent/IntegrationJob | Timeline de domínio, execução automática, idempotência, retry e falha tratável. |

São propostas de modelagem, sujeitas ao desenho técnico. Evitar duplicar tabelas existentes sem necessidade: `Request` continua sendo a identidade de negócio, `CategoryVersion` pode ser adaptada e auditoria/outbox podem ser estendidas.

### 6.2 Regras estruturais do motor

1. Servidor determina ações possíveis; frontend recebe `allowedActions` e formulário da atividade. Cada comando revalida autorização, versão, estado e dados.
2. Mudança de estado, decisão, evento e outbox são confirmados na mesma transação. Comando tem chave de idempotência.
3. Processo publicado é imutável. Nova publicação afeta novas instâncias; migração das abertas exige plano explícito, validação e auditoria.
4. Snapshot inclui regras hoje guardadas na categoria mutável (`requiresAcceptance`, confidencialidade, modo de alçada), evitando mudança retroativa silenciosa.
5. Resolutores de responsáveis combinam hierarquia, grupo, setor, centro de custo e usuário. Falta de pessoa obrigatória produz pendência administrativa com fallback configurado.
6. Condições usam linguagem declarativa limitada, com tipos e operadores permitidos; não executar JavaScript arbitrário do modelador.
7. Primeiro conjunto: início/fim, tarefa humana, aprovação, decisão exclusiva, divisão/junção paralela, tarefa automática e temporizador. Definir semântica e validar cada elemento suportado.
8. Escolher por prova técnica entre motor especializado e motor próprio limitado. Comparar licenciamento, operação, migração, timers, paralelismo, incidentes e equipe. Editor BPMN sozinho não executa processo.
9. Se a interface usar BPMN, declarar o subconjunto suportado e recusar elementos sem semântica; importação/exportação ampla fica para etapa posterior.

### 6.3 Telas alvo

- **Portal:** catálogo pesquisável, descrição do serviço, requisitos, favoritos e recentes.
- **Nova requisição:** formulário por processo, rascunho real, anexos, validação, revisão e envio sem duplicação.
- **Minhas atividades:** executar, aprovar, corrigir, responder, aceitar; filtros por prazo, processo e delegação.
- **Detalhe:** dados por seção, atividade atual, próximos caminhos, diagrama da execução, timeline, anexos, comentários e relações.
- **Gestão de filas:** candidatos, assumir, atribuir, capacidade, prioridades justificadas e exceções.
- **Administração de processos:** catálogo, formulários, fluxo, regras, participantes, SLA, integrações, testes, versões e publicação.
- **Monitoramento:** instâncias paradas, falhas de integração, responsáveis ausentes e reprocessamento autorizado.
- **Indicadores:** tempo por atividade, tempo total, SLA útil, backlog, gargalos, devoluções e carga, sempre no escopo autorizado.

## 7. Plano de execução por entregas completas

Ordem obrigatória: E0 → E1 → E2 → E3 → E4 → E5 → E6. Separar validação de regras da implantação em produção. Cada entrega inclui backend, frontend, migração quando necessária, cenários de teste, documentação e demonstração.

### E0 — Baseline funcional e regras consolidadas

- Levantar banco de desenvolvimento/homologação: categorias realmente publicadas, versões, filas, alçadas, papéis e requisições em cada estado.
- Confrontar as 27 categorias dos seeds com o catálogo real e com a especificação. Gerar matriz: processo, campos, regra, implementação, teste e pendência.
- Homologar jornada com solicitante, triagem, executor, aprovador, delegado e gestor; incluir duas áreas e um caso restrito.
- Fixar regras de compras: estoque total/parcial, compra necessária, responsável do centro de custo, escolha de proposta, alçada e alteração após aprovação.
- Decidir comportamento seguro para ausência de aprovador, devolução, reabertura, cancelamento após execução e recategorização.

**Aceite:** inventário real, matriz de autorização e transições acordadas; exemplos executáveis de sucesso, exceção e negação. Nenhuma decisão de infraestrutura bloqueia esse levantamento.

### E1 — Correção da base atual

- Resolver R01–R13 conforme prioridade, começando por autorização, quórum, valores e integridade das decisões.
- Centralizar transições, políticas de acesso, validação dinâmica, comandos com versão esperada e eventos.
- Completar corrigir/reenviar, responder solicitação de informação, reabertura e anexos reais.
- Corrigir relógios, campos de prazo, datas de conclusão e regras de aceite por ciclo.

**Aceite:** jornadas atuais completas; nenhuma passagem indevida entre setores; quórum correto; compra com proposta alterada exige nova decisão; teste de concorrência; transição inválida retorna erro sem efeito parcial.

### E2 — Administração e versionamento sem edição de código

- Criar administração de categorias, filas, responsáveis, grupos, formulários, alçadas, calendários e políticas.
- Construtor com seções, campos, tabelas de itens, dinheiro, documentos e fontes de cadastro; visibilidade, edição e obrigatoriedade por atividade.
- Ciclo rascunho → validar → simular → publicar → descontinuar. Permissões distintas para modelar e publicar quando exigido.
- Comparação entre versões, checklist automático e prévia como solicitante/executor/aprovador.
- Vincular campos financeiros e de cadastro às propriedades de negócio; evitar valor de alçada isolado em JSON.

**Aceite:** administrador cria uma categoria com formulário, aprovação e SLA pela interface; publica versão 2; instância da versão 1 permanece coerente. Sem seed nem alteração em React/serviço.

### E3 — Execução de processos e compras como piloto

- Fazer prova técnica do motor e registrar decisão antes de implantar o editor definitivo.
- Implementar/integração do conjunto limitado de atividades, gateways, timers, tarefas e incidentes.
- Adaptar APIs atuais para comandos do motor, mantendo compatibilidade durante migração.
- Transformar a lógica especial de compras em processo configurado com ações de domínio de Suprimentos/Logística.
- Implementar tarefas simultâneas, quórum por rodada, reaprovação, responsável ausente e retorno controlado para ajuste.

**Piloto proposto:** abrir → triagem Suprimentos → verificar estoque → [estoque suficiente: atendimento de material / parcial ou indisponível: cotação] → escolha e aprovação conforme política → compra/recebimento ou entrega → aceite → encerramento. Ausência de estoque é condição de negócio; escolha final das aprovações vem da E0.

**Aceite:** demonstrar compra com estoque, parcial, sem estoque, reprovação, alteração de proposta, delegado, cancelamento e recebimento parcial; nenhuma dependência de comparação por nome de categoria para escolher o fluxo.

### E4 — Editor visual e área unificada de atividades

- Editor com arrastar elementos, propriedades, conexões e validação antes de publicar.
- Detectar nós sem saída, tarefas sem responsável, condições inválidas, paralelismo sem junção coerente e caminhos sem encerramento.
- Simular por valor, papel, setor, estoque e dados de formulário, explicando decisões de roteamento.
- Inbox com tarefas pessoais, candidatas e delegadas; detalhe com formulário da etapa, ações autorizadas e timeline/diagrama.
- Substituir prompts do navegador por formulários de decisão com contexto e tratamento de erro.

**Aceite:** modelador altera condição, responsável e etapa sem código; testes da definição aprovam; processo novo usa nova versão e execução anterior continua na antiga.

### E5 — Integrações e operação confiável

- Formalizar eventos Core ↔ Logística com esquema, versão, correlação e identificador de negócio.
- Ordem única por requisição/versão; retry não duplica reserva, compra, recebimento ou baixa.
- Retorno de atendimento parcial/completo e cancelamento com compensação explícita quando já houver efeitos.
- Tarefas automáticas com timeout, retry, fila de falhas e reprocessamento auditado.
- Upload direto para armazenamento adequado, quarentena/scan real e autorização consistente no download.
- Notificações persistentes por destinatário, leitura, lembretes e escalonamento por atividade.

**Aceite:** integração continua correta após falha de rede, entrega duplicada e evento fora de ordem; operador consegue identificar e resolver falha sem SQL manual.

### E6 — Expansão por modelos e gestão

- Publicar modelos reutilizáveis: solicitação simples; aprovação financeira; atendimento com aceite; execução paralela; processo restrito.
- Aplicar a TI, reembolso e mobilização depois de compras. Mobilização valida tarefas de múltiplas áreas e a junção antes da conclusão.
- Tratar Compliance/RH restrito com homologação própria de acesso e identidade, após políticas consolidadas.
- Completar catálogo por ondas com donos dos processos; não apenas cadastrar nomes de categoria.
- Indicadores por processo/versão/etapa, definição de tempo útil versus corrido, exportação autorizada e monitoramento de desempenho.

**Aceite:** pelo menos três processos distintos configurados pela interface, sem condicionais novas por categoria no frontend ou no orquestrador. Donos de processo conseguem manter mudanças usuais e demonstrar rastreabilidade.

## 8. Estratégia de migração e validação

1. Inventariar instâncias abertas e anomalias antes de mudar o modelo. Preservar IDs, códigos, anexos, autoria e decisões.
2. Criar tabelas/colunas novas de forma aditiva e mapear versões antigas como legado.
3. Executar novas instâncias do piloto no motor novo por configuração controlada. Instâncias antigas terminam no executor legado inicialmente.
4. Não decidir em dois motores sobre a mesma instância. Comparação em sombra, se usada, só calcula resultados sem efeitos operacionais.
5. Migrar instâncias abertas apenas com mapa de estado/atividade, decisões, prazos, participantes e retorno documentado.
6. Ensaiar migração e restauração em cópia de homologação; publicar por processo. Reverter significa suspender novas aberturas na versão problemática, preservando histórico e efeitos externos existentes.

Testes obrigatórios: transições; autorização entre participantes/setores; sigilo em listagens e anexos; TODOS/QUALQUER_UM/N_DE_M; decisões concorrentes; ausência de aprovador; conflito por delegação; valores decimais/limites; alteração pós-aprovação; sexta/noite/feriado/pausa; reabertura; anexos; versão antiga versus nova; retry de integração e jornada ponta a ponta do piloto.

## 9. Como conduzir a implementação sem pedidos fragmentados

Este documento deve orientar um backlog único. Cada item nasce com regra, entrega visível, dependências e aceite. O implementador deve concluir o comportamento inteiro — telas, API, persistência, autorização, auditoria, notificações aplicáveis e testes — sem depender de solicitação adicional para cada botão.

Estados sugeridos do backlog: pendente → em execução → validado tecnicamente → em homologação → concluído. A conclusão exige evidência do critério de aceite, não apenas build passando.

Antes de cada entrega: registrar escopo e decisões já adotadas. Ao terminar: explicar comportamento entregue, cenários validados, limitações reais e próximo pacote. Decisões de negócio novas são reunidas em lote com proposta padrão e impactos; escolhas técnicas rotineiras seguem o plano.

### Definição do resultado esperado

O módulo atinge o primeiro patamar pretendido quando um administrador consegue criar um processo, definir formulário e responsáveis, estabelecer condições e prazos, testar e publicar; usuários executam atividades por uma caixa única; gestores acompanham gargalos; mudanças usuais dispensam edição de código; instâncias antigas preservam suas regras e decisões.

### Estimativa e decisões ainda necessárias

Não há base suficiente para prometer prazo fechado: faltam tamanho da equipe, disponibilidade de homologação, volume real e decisão sobre o motor. Estimar E1 após E0 e E3/E4 após a prova técnica; usar capacidade observada nas primeiras entregas para projetar o restante.

Premissas propostas: manter a stack atual; compras como piloto; preservar requisições existentes; editor para subconjunto explícito de processos; ampliar por modelos. Confirmar em E0 a cadeia de aprovação de compras, permissões por fila, calendário/política de SLA e o alcance de “igual ao Lecom” desejado pela operação. Paridade comercial ampla, RPA, IA e assinatura eletrônica são expansões separadas, sem bloquear o núcleo de processos.

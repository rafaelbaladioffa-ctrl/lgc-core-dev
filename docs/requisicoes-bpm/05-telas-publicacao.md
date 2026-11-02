# Telas, formulário, versões e publicação

## Navegação e transição

P01 acrescenta rota autenticada `/requests/bpm` (“Processos — piloto”) e `/requests/bpm/admin`; mantém rotas existentes operacionais. Registrar rotas específicas antes das genéricas `:id`. Usar AppLayout, FormPage, Button, DataTable, tema e CSS existentes; alterações compartilhadas devem ser mínimas e revisadas, preservando mudanças locais.

Abertura/inbox exigem permissões de requisição; configuração exige suas permissões/grants de processo/fila, sem exigir artificialmente acesso a instâncias. Seletores de membros/modeladores/publicadores usam `/bpm/configuration/candidates` e não acrescentam `user:read` ou leitura sensível de colaboradores aos papéis operacionais.

Após P08, `/requests` abre catálogo novo; links antigos consultam executionMode e encaminham ao detalhe adequado. `/my-approvals` pode redirecionar à inbox filtrada; não duplicar decisões em dois backends. As telas não inferem fluxo por código SUP-COMPRA ou nome; renderizam activity.kind, schema e actions do servidor.

## Superfícies e comportamento obrigatório

| Tela | Conteúdo e ações | Falha / vazio / aceite |
|---|---|---|
| Portal `/requests/bpm` | Busca por processo/setor, descrição, requisitos, prazo e botão Abrir; links Minhas e Minhas atividades | Catálogo sem processo habilitado explica estado; falha com retry; sem categorias legadas/draft/retired |
| Nova `/requests/bpm/new?categoryId=` | Categoria → Dados → Revisão; título, descrição, beneficiário autorizado, prioridade/impacto, vínculos e campos por schema; Salvar rascunho e Enviar | Draft parcial salvo com ID imediatamente; obrigatórios só no submit; título 10–120 ao enviar; versão indisponível permite manter draft e rebase explícito futuro |
| Edição de draft `/requests/bpm/:id/edit` | Mesmos dados, estado de salvamento, anexos reais, voltar depois e retomar | Autosave após 1s sem digitação, uma chamada em voo; coalescer alterações, chave nova por save; conflito interrompe autosave sem sobrescrever; aviso de saída com pendência |
| Minhas `/requests/bpm/mine` | Código, título, versão/ciclo, status, atividades/responsável resumidos, prioridade e SLA, pesquisa/filtros/paginação | Autor vê draft; beneficiário só após envio e permitido; paginação sem vazar contagem |
| Inbox `/requests/bpm/activities` | Abas Minhas, Para assumir, Delegadas; tarefa, processo/código, prazo, ator representado, ação | Assume com feedback persistido; duas abas não assumem simultaneamente; delegada expirada desaparece/recarrega sem perder dados |
| Detalhe `/requests/bpm/:id` | Cabeçalho e prazos; tarefas atuais; dados por seções; formulário da etapa; anexos; comentários/notas; timeline; ciclos; diagrama read-only em P06 | Botões de allowedActions; erro de ação preserva input; sem `prompt()`/`confirm()` de browser para colher resolução ou motivo |
| Fila `/requests/bpm/queues/:id` | Pendentes/candidatas/assumidas, gestor distribui e altera prioridade, incidentes claros | Só filas autorizadas; mudança de responsável exige motivo e elegibilidade; sem select global de todos os usuários |
| Configurações `/requests/bpm/admin` | Processos, versões, filas/membros e grants; categoria desabilitada até habilitar | Não precisar editar seed ou pedir SQL para publicar um processo |
| Versão `/requests/bpm/admin/versions/:id` | Abas metadados/formulário/fluxo/políticas/validação/versões; Salvar, Validar, Prévia, Publicar | Edição somente draft; unsaved changes claros; conteúdo publicado em leitura; clonar inicia novo draft |
| Operação `/requests/bpm/incidents` | Tipo, idade, nó/job e causa segura, responsável pela correção, retry/re-resolve com motivo | Sem edição livre de JSON/status; se sem permissão, sem detalhe do registro; reexecução auditada |
| Painel `/requests/bpm/dashboard` | Backlog, aging, tempo útil/corrido por etapa, SLA, filtros processo/versão/fila e atualização | Agregação após escopo; zero não revela processos restritos; definições das métricas visíveis |

P01 entrega portal, nova/retomar/minhas, inbox simples, detalhe, fila mínima, configuração e incidentes de responsável no próprio detalhe/gestão. Abas de editor gráfico, approval, compras, painel agregado e delegação ficam indisponíveis até seus pacotes. Não exibir ações disabled sem motivo se o recurso sequer existe.

## Formulários

Campos iniciais P01: `text`, `textarea`, `integer`, `decimal`, `date`, `select`, `boolean`, `attachment`. Select com opções estáticas ou fontes registradas; no máximo uma seleção neste primeiro pacote. P02 acrescenta seções reordenáveis, tabela repetível, dinheiro, referências e condições. Schema sempre diferencia apresentação (`label/help/order`) de valor estável (`key` e IDs de opção).

Cada campo tem chave estável, tipo, limites, opções/fonte, requiredOn e política de leitura/escrita por etapa. Unknown keys rejeitadas. Boolean false e número zero são valores presentes; texto só de espaço e array vazio não. Datas impossíveis e decimal fora de escala falham no servidor. Required condicional é resolvido após aplicar condições com contexto autorizado do servidor. Campo oculto mantém valor anterior até comando autorizado mudá-lo; cliente não pode enviá-lo disfarçado de vazio. Servidor ignora nada silenciosamente.

Bindings explícitos (`request.costCenterId`, `request.projectId`, `request.estimatedValue`) impedem duplicar valores financeiros em JSON com significados diferentes. Um destino só pode ter um binding; colisão → erro de publicação. `money` usa BRL; editor mostra R$ sem enviar máscara. Quantidade exibe unidade do catálogo.

Anexo é upload e referência de ID/hash, não nome digitado. UI mostra progresso/erro, nome, tipo, tamanho e versão; arquivo só conta como obrigatório após persistência/validação básica. Sem selo “antivírus verificado”. Troca de documento aprovado encaminha para correção/reaprovação. Upload antes de Request existir requer criar draft primeiro, não arquivo órfão global.

## Publicação e versionamento

1. Criar processo desabilitado ou clonar versão atual. Modelo legado importado é draft, nunca publicado automaticamente.
2. Editar form/fluxo/políticas; salvar incrementa revision e invalida validação anterior. Conflito entre modeladores exige recarregar/diff, sem último gravador vencer.
3. Validar estrutura, tipos, fontes, filas, resolutores, condições, SLA e capabilities; gerar relatório com links para nó/campo. Publicação revalida resolução operacional mínima (fila tem pessoa elegível, calendar tem expediente).
4. P01 oferece prévia de form como autor/triador/executor. P06 acrescenta cenários salvos e simulador usando mesmo interpretador puro, com pessoas/dados sintéticos e clock controlado, sem criar requisição/outbox ou chamar Logística.
5. Publicar exige hash validado da revisão salva atual + permissões/grant. Transação bloqueia categoria/versão, verifica que revisão não mudou, congela snapshot/hash/autor/data e muda ponteiro. Configuração mutável externa (alçadas/calendário) é copiada nesse instante.
6. Habilitar nova abertura separadamente. Publicar v2 muda a versão proposta a novos drafts; draft já existente continua v1 enquanto v1 publicada não retired e processo habilitado. Usuário vê versão e eventual versão mais nova, podendo continuar ou criar draft atual. Nunca substituir schema sob formulário preenchido.
7. Retirar versão bloqueia novos submits de drafts nela ainda não enviados; draft permanece legível/editável e pode copiar dados compatíveis para novo draft mediante prévia e confirmação. Instâncias enviadas continuam na versão original. Desabilitar processo bloqueia novas criações/submits; tarefas já abertas continuam executáveis.
8. Não migrar processos ativos para v2 por publicar. Recategorização limitada é comando de negócio diferente, com ciclo/evento/política, e só aparece em P05.

ProcessVersion lógico = CategoryVersion + snapshot completo. Formulário, aceite, confidencialidade, SLA, valor de alçada, hierarquia vazia e regras de domínio não leem flags mutáveis da categoria durante execução. Participantes/responsáveis ativos são dados operacionais atuais, registrados ao resolver; não se congela direito de usuário desligado.

## Editor P06

Canvas com paleta dos tipos suportados, conexões por saídas nomeadas, inspector de propriedades, zoom, seleção, validação e modo teclado/lista equivalente. Split/join criado como bloco pareado; o editor não permite aresta cruzando o bloco. Aprovação mostra modo TODOS/QUALQUER_UM/N_DE_M e regra de veto. Condição exclusiva apresenta ordem e default de modo explícito.

Configurador de handlers só lista ações registradas pelo backend e seus parâmetros tipados. Não oferece URL, header secreto ou editor JavaScript. Form builder com preview por atividade/papel, indicador de hidden/read/write/required e erros que batem com backend. Publicador vê diff semântico, relatório e aviso sobre pular cadeia vazia quando aplicável. Templates copiam configuração; mudar template não muda versões derivadas.

## Padrões de experiência e verificação

- pt-BR, DD/MM/AAAA, 24h, America/Sao_Paulo, BRL. Prazo mostra instante absoluto e tempo útil restante; status inclui texto/ícone, não só cor.
- Labels associados, foco previsível, diálogo com foco contido e retorno ao botão, mensagens por campo/aria-live. Jornadas de autor e executor utilizáveis em 390px e por teclado; modelador prioriza desktop, com alternativa tabular.
- Ao reenviar após erro de rede, conservar chave/body até saber resultado; ao alterar input, gerar nova chave. Duplo clique desabilita ação em voo; backend ainda garante dedupe.
- 409 não apaga formulário: mostrar versão atual, recarregar e permitir reaplicar conscientemente campos ainda autorizados. 403/404 remove conteúdo da tela quando acesso foi revogado. Não manter dado restrito em localStorage/cache persistente.
- Prévia, confirmação de cancelamento e decisão financeira mostram exatamente efeito e valor a aprovar. Notificação abre rota autenticada e não concede acesso.
- Evidência visual deve cobrir draft salvo/retomado, tarefa assumida, conclusão, negação e conflito. Screenshot de página vazia ou build não demonstra jornada.

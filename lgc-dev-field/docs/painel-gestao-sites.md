# Painel de Gestão de Sites — visão de negócio

> Status: **implementado** (02/10/2026) — tela `/gestao-sites` (menu Central de Operações), endpoint `GET /api/dashboard/sites/`. Ver seção **Implementação**.
> Decisões tomadas: ver seção **Decisões tomadas (02/10/2026)** — elas prevalecem sobre as propostas originais no restante do texto.
> Mockups: `output/painel-sites/layout-a.jpg`, `layout-b.jpg`, `layout-c.jpg` (HTML de origem ao lado).

## Visão de negócio

### Objetivo
Dar ao gestor uma tela de leitura rápida ("bater o olho") que responda, por site e por outros recortes (regional, cliente, responsável), três perguntas:

1. Quanto de carteira tenho rodando e quanto está para entrar? (projetos em execução x em planejamento)
2. Tenho gente suficiente onde precisa hoje? (técnicos presentes x ausentes, por site)
3. Onde preciso agir antes de virar problema com o cliente? (projetos atrasados ou com risco de atrasar, com o motivo)

A decisão que o painel apoia é **onde colocar a atenção da gestão hoje**: qual site escalar, qual responsável cobrar, onde remanejar técnicos e qual cliente precisa de comunicação proativa.

### Problema operacional
Hoje a informação existe, mas está espalhada:

- A **Central de Operações** (`api/operations.py`, `build_board_data`) mostra presença e tarefas **de um site por vez**, com foco no despacho do dia, sem visão de carteira.
- O **Dashboard de Performance** (`api/dashboard.py` → `projects/analytics.py`) mostra progresso por projeto e produtividade técnica, mas sem recorte por site/regional e sem leitura de prazo (não sinaliza atraso).
- A **previsão de término** está especificada em `docs/previsao-de-termino-de-projetos.md`, mas **não está implementada** (não há código de forecast no backend).

Resultado: para saber "como estão meus sites", o gestor precisa abrir site por site e projeto por projeto.

### Usuários impactados
| Perfil | Uso |
|---|---|
| Gestor / diretoria de operações | Leitura diária e reunião semanal; decide escalonamentos e remanejamentos |
| Coordenador de site / responsável CSTR | Vê a própria carteira (visão "por responsável") e os motivos do vermelho |
| Despacho | Usa o bloco de técnicos (ausências, sem acesso, sem check-in) para agir na Central |
| Gestor com escopo de site (`User.manager_sites`) | Vê só os sites dele (escopo já existe em `core/access_scope.py`) |
| Usuário-cliente (portal) | **Fora do MVP** — painel é interno |

---

## Decisões tomadas (02/10/2026)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Site do técnico no dia | Definido pela **tarefa despachada** ao técnico (`ProjectTaskAssignment` → `project_task.project.site`). Prioridade: (a) despacho em execução hoje (`assignment_start` preenchido e `assignment_end` vazio); (b) senão, despacho concluído hoje (`assignment_end` na data); (c) senão, próximo despacho pendente da fila (menor `queue_order`, sem `assignment_end`). Sem nenhum despacho válido → o técnico aparece como **"sem despacho"**: conta no total geral, e só entra no site da lotação se tiver um único site em `Collaborator.sites`. `DailyUpdateAllocation` não é usado. |
| 2 | Quem é técnico | **Filtrar por cargo** (`Collaborator.job_title`). Excluir cargos de gestão com o mesmo critério já usado em `Collaborator.manager` (nome contém "Supervisor", "Coordenador" ou "Gerente"); colaborador sem cargo entra como técnico e soma no contador de qualidade de cadastro. Lista de cargos excluídos fica em settings para ajuste. Nenhuma migração. |
| 3 | Tarefas canceladas | **Saem do painel**: excluídas do denominador do avanço real e do planejado. Aceita-se que o % do painel difira das demais telas; o tooltip do % deve dizer "sem tarefas canceladas". |
| 4 | Capacidade x demanda | **Fora do escopo** até definir se `ProjectTask.estimated_hours` é homem-hora ou duração. Retirado do MVP e da Fase 2; o layout C deve ser lido sem esse bloco. |

## De onde sai cada indicador (verificado no código)

### 1. Projetos ativos e em planejamento
| Indicador | Fonte | Regra |
|---|---|---|
| Em execução | `Project.status = in_progress` e `is_active=True` | contagem |
| Pausados | `Project.status = paused` | mostrar separado (não somar em execução) |
| Em planejamento | `Project.status in (planning, not_started)` | os dois são "ainda não começou"; pode exibir a quebra no tooltip |
| Iniciam em até 7 dias | `Project.planned_start` entre hoje e hoje+7 | sub-indicador do planejamento |
| Concluídos / cancelados | `completed`, `canceled` | fora da contagem padrão (filtro opcional) |

Agrupamentos possíveis com dado existente:
- **Site**: `Project.site` (FK, nullable → balde "Sem site").
- **Regional**: `Project.site.region` (`core.Region`, FK nova e nullable → balde "Sem regional"). Também dá para agrupar por **país** (`Region.country`: BR, US, CL, MX).
- **Cliente**: `Project.client`.
- **Responsável CSTR**: `Project.responsible_cstr` (Responsible kind CSTR).
- **Responsável do cliente**: `Project.responsible_client`.
- **Tipo de projeto / Categoria**: `Project.project_type`, `Project.category`.
- **Empresa**: `Project.company` (útil se houver mais de uma empresa do grupo).

### 2. Técnicos trabalhando e ausentes no site
| Indicador | Fonte | Regra |
|---|---|---|
| Técnicos lotados no site | `Collaborator.sites` (M2M), `is_active=True` | base do site |
| Presentes | `dispatch.TechnicianDailyPresence` do dia, `status != not_started` e sem ausência | mesma regra de `build_board_data` (`technicians_on_site`) |
| Em execução agora | presença `in_progress` (setada pelo sistema ao iniciar tarefa) | sub-indicador |
| Improdutivos (sem acesso / aguardando liberação / disponível sem tarefa) | presença `site_blocked`, `awaiting_release`, `available` (`PRESENCE_PRODUCTIVITY = unproductive`) | destacar — é tempo potencialmente cobrável do cliente |
| Ausência planejada | `dispatch.TechnicianAbsence` com `date_from <= hoje <= date_to` (motivo em `reason`) | "férias / atestado / folga" |
| Sem check-in | presença inexistente ou `not_started` e sem ausência | hoje a Central chama isso de `technicians_absent` — **no painel separar de ausência planejada**, porque a ação é diferente (ligar para o técnico x já sabido) |

Cuidados e dependências:
- **Lotação multi-site (RESOLVIDO — decisão 1, prevalece sobre o texto a seguir):** `Collaborator.sites` é M2M e `TechnicianDailyPresence` **não tem site**. Um técnico lotado em dois sites seria contado nos dois. Regra proposta para o "site do dia": (1) site do projeto da tarefa em execução/realizada hoje (`ProjectTaskAssignment` → `project.site`); senão (2) site do projeto em `updates.DailyUpdateAllocation` da data; senão (3) se tiver um único site em `Collaborator.sites`, esse; senão "lotação múltipla" (conta uma vez no total geral, aparece em "não atribuído a site"). O total geral deve ser sempre `distinct` por colaborador.
- **Quem é técnico (RESOLVIDO — decisão 2: filtro por cargo):** não existe flag de técnico em `Collaborator`. A Central usa todos os colaboradores ativos. Sugestão: filtrar por `job_title` configurável ou criar um booleano aditivo `is_field_technician`. Sem isso, gestores/administrativos lotados em site entram na conta.
- **Visão por cliente/responsável:** técnico pertence a site, não a cliente. Nessas visões, mostrar "técnicos alocados hoje" = colaboradores distintos com assignment em projeto daquele cliente/responsável na data (ou em `DailyUpdateAllocation`), nunca a soma dos sites (dupla contagem).

### 3. Atraso e risco de atraso
Dados disponíveis:
- `Project.planned_start`, `planned_end`, `actual_start`, `actual_end`, `status`.
- `ProjectTask.status`, `planned_start`, `planned_end` (datetime), `completion_outcome` (`blocked`), `estimated_hours`.
- Avanço real atual: % de tarefas concluídas (`ProjectSerializer.get_progress_percent` = concluídas / total).
- Histórico diário de avanço: `ProjectProgressSnapshot.percent` (gravado às 15h pelo bot) e `ProjectDailyUpdate.completion_percent`.
- Ocorrências: `ProjectOccurrence` (`severity` low/medium/high/critical, `status` open/in_progress).

**Avanço planejado (novo cálculo, sem nova modelagem):** % de tarefas não canceladas cujo `planned_end <= agora`. Se mais de 30% das tarefas não tiverem `planned_end`, o planejado fica "sem base" e o projeto não é classificado por desvio (só por data).

> RESOLVIDO — decisão 3: canceladas saem do painel. Contexto original: o progresso atual (`get_progress_percent`) conta tarefas **canceladas** no denominador. Para o painel, recomenda-se excluir canceladas no real e no planejado — decisão a confirmar para não divergir de outras telas.

#### Regra objetiva (MVP — configurável)
Aplica-se a projetos `is_active=True` com status `in_progress`, `paused`, `planning` ou `not_started`.

**Atrasado (vermelho)** — qualquer um:
1. `hoje > Project.planned_end` e status diferente de `completed`.
2. Desvio `planejado% − real% >= 15 pp`.

**Risco de atraso (amarelo)** — se não estiver atrasado, qualquer um:
1. Desvio entre **5 e 15 pp**.
2. `planned_end` nos próximos **7 dias** e real < 90%.
3. **Início atrasado:** status `planning`/`not_started` com `planned_start < hoje`.
4. **Projeto parado:** `in_progress` sem nenhuma tarefa concluída e sem aumento em `ProjectProgressSnapshot` nos últimos **3 dias úteis**.
5. **Tarefas vencidas:** >= 3 tarefas (ou >= 10%) com `planned_end < agora` e não concluídas.
6. **Bloqueio:** ocorrência aberta com severidade `high`/`critical`, ou tarefa finalizada com `completion_outcome = blocked` sem tarefa de continuação concluída.

**Sem dados (cinza):** sem `planned_end` ou sem tarefas.
**No prazo (verde):** demais casos.

Regras complementares:
- Todo projeto amarelo/vermelho carrega a **lista de motivos** em texto ("Término previsto 26/09 já passou", "7 tarefas vencidas", "Ocorrência alta aberta há 4 dias"). Sem motivo explicável, não pinta.
- A cor de um grupo (site, regional, cliente, responsável) = pior cor entre seus projetos; os contadores mostram quantos de cada.
- Os limiares (15 pp, 5 pp, 7 dias, 3 dias úteis, 3 tarefas) ficam em configuração do backend para calibrar com dados reais nas primeiras semanas.
- **Fase 2:** quando a previsão de término (`docs/previsao-de-termino-de-projetos.md`) for implementada, somar a regra "previsão >= 4 dias úteis após `planned_end` = atrasado; 1 a 3 dias = risco" e exibir a data prevista. A previsão deve usar `ProjectProgressSnapshot`/`ProjectDailyUpdate`, que já existem.

---

## Ideias além do pedido (filtradas por decisão real)

| # | Ideia | Decisão que apoia | Fonte do dado | Prioridade |
|---|---|---|---|---|
| 1 | **Técnicos improdutivos por site** (sem acesso, aguardando liberação, disponível sem tarefa) com horas do dia | Cobrar o cliente por indisponibilidade de acesso; remanejar gente ociosa | `TechnicianDailyPresence` + `TechnicianStatusEvent` (durações já calculadas em `_presence_durations_by_collaborator`) | Alta (MVP) |
| 2 | **Motivos explicáveis do vermelho/amarelo** em drill-down lateral | Saber o que fazer, não só que está ruim | Mesmas regras acima | Alta (MVP) |
| 3 | **Ocorrências abertas por site/severidade** | Escalar impedimento com o cliente | `ProjectOccurrence` | Alta (MVP) |
| 4 | **Atualização ao cliente pendente** (projeto em execução sem `ProjectDailyUpdate` enviado no último dia útil) | Proteger relacionamento; cobrar responsável | `ProjectDailyUpdate.sent_at` por projeto/data | Média-alta (MVP se barato) |
| 5 | **Prontidão de mobilização**: projetos em planejamento que começam em até 14 dias sem tarefas geradas ou sem técnicos lotados no site | Evitar início atrasado | `Project.planned_start`, `ProjectTask` count, `Collaborator.sites` | Média-alta |
| 6 | **Ausências futuras (7/14 dias) por site** | Antecipar falta de equipe | `TechnicianAbsence` | Média |
| 7 | ~~**Capacidade x demanda 7 dias por site**~~ (ADIADO — decisão 4) (HH estimado das tarefas agendadas x técnicos disponíveis × 8h) | Remanejar entre sites; pedir reforço | Demanda: `ProjectTask.estimated_hours` com `planned_start` na janela. Oferta: lotados − ausências × `STANDARD_WORKDAY_HOURS` (8h) | Média — **DEPENDÊNCIA**: confirmar se `estimated_hours` é HH total ou duração (pela regra de HH aprovada, demanda deve ser em homem-hora) |
| 8 | **Tendência de avanço 7 dias** (sparkline real x planejado) | Ver se está recuperando ou piorando | `ProjectProgressSnapshot` | Média |
| 9 | **Qualidade de dados** (projeto sem site, sem `planned_end`, sem responsável; site sem regional; técnico multi-site sem alocação) | Sem cadastro bom, o painel mente | Campos nulos nos models | Média (barato, entra no MVP como contador) |
| 10 | **Mapa de sites** com cor de saúde | Visão executiva/regional | `Site.latitude/longitude` (já existe tela `SitesMap.tsx`) | Baixa — bonito, mas decide pouco além da lista por regional |
| 11 | **Visões salvas** ("reunião semanal diretoria") | Padronizar ritual de gestão | Novo: preferências por usuário | Baixa (fase 3) |

Descartadas por ora: health score numérico composto (opaco, difícil de explicar ao responsável — preferir semáforo com motivos); ranking de responsáveis exposto na tela principal (gera ruído político sem regra de normalização por porte do projeto); HH realizado/faturamento no painel (pertence a Relatórios, regra de HH em `regra-homem-hora-relatorios`).

---

## MVP recomendado

Uma tela **Gestão de Sites** (rota sugerida `/gestao-sites`), somente leitura, com:

1. **Seletor de visão**: Site (padrão) · Regional · Cliente · Responsável CSTR. (Resp. cliente e Tipo ficam para a fase 2.)
2. **Filtros**: país, regional, cliente, status (padrão: execução + pausado + planejamento), "somente com alerta".
3. **Faixa de KPIs**: em execução, pausados, em planejamento, atrasados, risco, técnicos presentes/lotados, ausência planejada, sem check-in, improdutivos.
4. **Um card por grupo** (layout A): contagem execução/planejamento/atrasados, barra de técnicos (execução/improdutivo/ausente/sem check-in), até 3 projetos em alerta com real x planejado, rodapé com ocorrências e updates pendentes. Ordenado por criticidade.
5. **Drill-down**: clicar no card abre a lista dos projetos do grupo (layout B) com painel lateral de motivos e equipe do dia, e links para Projeto e Central de Operações.
6. Contador de **qualidade de dados**.

Data de referência: hoje (UTC−3, `timezone.localdate()`), com possibilidade de escolher outra data só para os blocos de técnicos (histórico de presença existe).

## Evolução futura
- **Fase 2**: previsão de término integrada à regra de risco; modo tabela completo (layout B) como alternativa aos cards; agrupamento por Resp. cliente e Tipo; painel de exceções (layout C, coluna direita); ausências futuras; prontidão de mobilização. Capacidade x demanda fica sem fase até definir a semântica de `estimated_hours`.
- **Fase 3**: mapa; visões salvas; envio diário do resumo do painel pelo bot WhatsApp (já existe `receives_daily_project_report` em `BotSubscriber`), com fallback manual = a própria tela.

## Impacto técnico

**Backend**
- Novo endpoint somente leitura: `GET /api/dashboard/sites/?group_by=site|region|client|responsible_cstr&date=&country=&region=&client=&status=&only_alerts=`.
- Lógica em `projects/analytics.py` (padrão já usado por `build_projects_performance`), reaproveitando de `api/operations.py` a regra de presença/ausência. Evitar chamar `build_board_data` site a site (N consultas): montar as presenças do dia em uma consulta e distribuir por site.
- Resposta sugerida: `summary{...}`, `groups[{key, label, health, projects{in_progress, paused, planning}, alerts{late, at_risk, start_late, no_data}, technicians{assigned, present, executing, unproductive, on_leave, no_checkin}, occurrences_open, updates_pending, data_quality{...}, top_alerts[{project_id, code, name, real_pct, planned_pct, health, reasons[]}]}]`.
- Regras de saúde em função única e testável (`compute_project_health(project, today)`) com limiares em settings; testes unitários cobrindo cada motivo.
- Sem migração no MVP. Técnico identificado por cargo (decisão 2); o booleano `is_field_technician` não será criado.
- Performance: `select_related`/`prefetch_related` em tarefas e assignments; cache curto (60 s) por usuário+filtros.

**Permissões e escopo**
- Acesso: `projects.view_project`. O bloco de técnicos exige também `projects.view_projecttaskassignment` (mesma permissão da Central); sem ela, o bloco é omitido.
- Aplicar `core/access_scope.py`: gestor com `manager_sites` vê só seus sites; usuário-cliente não acessa no MVP.
- Somente leitura: não gera `AuditLog`.

**Frontend**
- Nova página (ex.: `frontend/src/pages/SitesPanel.tsx`) e item no menu. Usar apenas as variáveis de cor existentes em `index.css` (`--red`, `--amber`, `--green`, `--blue`, `--purple`, `--text-faint` e os `-soft`); `--danger/--warning/--success` não existem.
- Estados: carregando, vazio (nenhum projeto no filtro), erro, "sem permissão para técnicos".
- i18n: textos via o mesmo mecanismo de traduções usado em `Layout.tsx`.

### Agentes envolvidos
- **Layout WFM: sim** — decidir entre A/B/C (ou híbrido A+B), densidade e comportamento do drill-down.
- **Frontend: sim** — nova página, seletor de visão, cards, drawer, consumo do endpoint.
- **Backend** (sem agente dedicado): endpoint, regra de saúde e testes.

## Critérios de aceite (MVP)
1. Na visão Site, cada site com projeto ativo aparece com contagens de execução, pausado e planejamento que batem com a lista de projetos filtrada pelo mesmo site e status.
2. Técnicos presentes/sem check-in de um site batem com `technicians_on_site`/`technicians_absent` da Central de Operações para o mesmo site e dia; ausências planejadas aparecem separadas.
3. Um técnico lotado em dois sites não é contado duas vezes no total geral, e aparece no site do projeto da tarefa que foi despachada a ele (em execução > concluída hoje > próxima da fila).
3a. Colaboradores com cargo de Supervisor, Coordenador ou Gerente não entram na contagem de técnicos.
3b. O avanço real e o planejado do painel ignoram tarefas canceladas.
4. Um projeto com `planned_end` vencido e status diferente de concluído aparece vermelho com o motivo "término previsto dd/mm já passou".
5. Um projeto em planejamento com `planned_start` no passado aparece amarelo com "início atrasado".
6. Todo projeto amarelo/vermelho exibe ao menos um motivo em texto.
7. Trocar a visão para Regional/Cliente/Responsável reagrupa sem recarregar a página inteira; sites sem regional caem em "Sem regional".
8. Gestor com `manager_sites` vê apenas os sites permitidos; usuário sem `view_projecttaskassignment` não vê o bloco de técnicos.
9. A tela carrega em menos de 2 s com a carteira atual.

## KPIs afetados
Projetos em andamento/atrasados; desvio planejado x real; tarefas atrasadas/bloqueadas; presença e tempo improdutivo por site; atualizações ao cliente pendentes; qualidade cadastral. Métrica de sucesso do painel: redução do número de projetos que viram "atrasado" sem antes terem passado por "risco" (sinal de que o alerta antecipa), e uso diário pela gestão.

## Prioridade sugerida
**Alta.** Usa quase só dados existentes, consolida três telas e cria o ritual diário de gestão por exceção. Pré-requisitos de decisão resolvidos em 02/10/2026 (ver Decisões tomadas).

## Opções de layout
| Opção | Conceito | Prós | Contras |
|---|---|---|---|
| A — Cards por grupo | Faixa de KPIs + grade de cards por site com semáforo, barra de técnicos e top 3 alertas | Leitura instantânea; funciona igual para qualquer agrupamento; ótimo em TV/reunião | Pouca informação por projeto; com muitos grupos (>12) exige rolagem |
| B — Matriz operacional | Tabela agrupada (ex.: Cliente → projetos) com real x planejado, término, desvio, equipe, ocorrências, update ao cliente e painel lateral de motivos | Máxima densidade; drill-down explica o vermelho; exportável; bom para coordenação | Menos "bater o olho"; exige mais leitura |
| C — Mapa + exceções | KPIs, mapa com sites coloridos, resumo por regional e fila de exceções acionáveis + capacidade x demanda | Visão executiva/regional; fila de exceções guia a ação | Mapa ocupa espaço e decide pouco; capacidade depende de dado ainda a confirmar |

**Recomendação:** MVP com **A como tela inicial** e **o drill-down de B** (lista dos projetos do grupo + painel lateral de motivos). A fila de **exceções de C** entra na fase 2 como coluna lateral ou aba; o mapa fica para a fase 3.


## Implementação (02/10/2026)

Estrutura em abas aprovada: os três layouts viraram uma tela só, sem repetir conteúdo.

- **Parte fixa (uma vez só):** agrupar por (Site / Regional / Cliente / Responsável), filtros (país, status, somente com alerta), faixa de indicadores e o painel lateral de detalhe do projeto.
- **Visão geral (layout A):** cards por grupo com semáforo, contagens e barra de técnicos; o card mostra só a contagem de alertas. Clicar no card abre a Análise filtrada por aquele grupo. Card de qualidade de cadastro ao final.
- **Análise de projetos (layout B):** tabela por projeto agrupada, real x planejado com marcador, desvio, técnicos do dia, ocorrências, update ao cliente, saúde; exportação CSV.
- **Regionais e exceções (layout C):** mapa (Leaflet) com sites coloridos pela pior situação e tamanho pelo nº de técnicos + fila de exceções com filtro (Prazo, Equipe, Cliente, Mobilização) e botão de ação. Sem o bloco de capacidade x demanda (decisão 4) e sem o resumo por regional (já é a Visão geral agrupada por Regional).

Arquivos: `backend/projects/sites_panel.py` (regras), `backend/api/sites_panel.py` (view), `backend/api/tests_sites_panel.py` (17 testes), `frontend/src/pages/SitesPanel.tsx`, estilos `.sp-*` em `frontend/src/index.css`.
Limiares ajustáveis em settings: `SITES_PANEL_THRESHOLDS` (dict parcial) e `SITES_PANEL_EXCLUDED_JOB_TITLE_KEYWORDS`.

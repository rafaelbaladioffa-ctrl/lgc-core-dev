# Relatórios e Indicadores v2

> Status: especificação aprovada em 2026-10-02 (regras de HH aprovadas pelo Rafael).
> Tela: `/relatorios-indicadores` — `frontend/src/pages/OperationsReports.tsx`
> Endpoint: `GET /api/operations/reports/` — `backend/api/operations.py` (`OperationsReportsView`)

---

## 1. Problema e objetivo

A tela de Relatórios mostra a presença do dia, mas não ajuda a decidir, e parte dos números está errada: a utilização não desconta pausas (gera faixas de ">300%"), metas por pessoa são comparadas com a soma da equipe, o dia sem "Fim de Expediente" infla as horas improdutivas, e o tempo por atividade é agrupado pelo nome livre da tarefa, o que fragmenta o histórico. Como a empresa **cobra o cliente por homem-hora (HH)**, esses erros afetam faturamento, margem e a base de estimativa de propostas.

Objetivo da v2: **números confiáveis e com definição única**, qualidade do dado visível, e uma **base de estimativa por tipo de atividade e tipo de cabo** (HH por unidade) que sirva para orçar escopos futuros.

## 2. Personas e jornada

| Perfil | Momento | O que precisa nesta tela |
|---|---|---|
| Gerente de projeto | Diário / semanal | HH consumido, atividades fora do padrão, qualidade do apontamento |
| Coordenador / despachante | Ao longo do dia | Quem está ocioso, quem está bloqueado e por quê |
| Diretoria | Semanal / mensal | Utilização da equipe, improdutivo causado pelo cliente, exportar para apresentação |
| Comercial / planejamento | Ao orçar | HH por unidade por atividade × cabo, com tamanho de amostra |

## 3. Regras de negócio

### 3.1 Horas e homem-hora (aprovadas)

- **RN-01 — HH.** HH de uma tarefa = soma das horas reais de cada técnico alocado, descontando pausas (`ProjectTaskAssignment.actual_hours`; agregado em `ProjectTask.real_man_hours`). Nunca usar `duração da tarefa × nº de técnicos`. Ex.: A e B 3h, C 1h → **7 HH**.
- **RN-02 — Duração.** Duração = `actual_hours` da tarefa: do primeiro início ao último fim entre os técnicos, descontando os trechos em que **ninguém** estava em execução (união dos intervalos de execução de cada técnico, já sem as pausas de cada um). Serve para cronograma, nunca para faturamento.
- **RN-03 — Equipe.** Tamanho da equipe de uma execução = nº de assignments com horas reais > 0.
- **RN-04 — Horas do técnico (utilização).** Horas produtivas do técnico = tempo em status `Em Execução` (`TechnicianStatusEvent`, status `in_progress`) no período. É contado uma única vez mesmo com tarefas paralelas e já exclui pausas. Fallback para períodos sem eventos de status: soma de `assignment.actual_hours` das tarefas concluídas, limitada à jornada do dia.
- **RN-05 — Tarefas sem apontamento real** entram em HH, duração, utilização e base de estimativa somente quando têm apontamento. **Ajuste feito pelo administrador não conta em indicadores de técnico** (decisão do time): a conclusão aplicada pelo admin fica sem horas e não entra em "concluídas por técnico", taxa de rastreamento nem performance técnica. O status agregado da tarefa (avanço do projeto, e-mail ao cliente) continua considerando essa conclusão.
- **RN-05b — Conclusão é por técnico.** Cada técnico inicia, pausa e conclui a própria parte (`ProjectTaskAssignment.status`). "Concluídas" de técnico, HH, utilização e performance contam a parte de cada um, na data em que ele concluiu. A tarefa só fica **concluída** quando todos os técnicos despachados concluírem (ver `ProjectTask.sync_from_assignments`); avanço do projeto e e-mail ao cliente usam o status da tarefa.
- **RN-05c — Resultado e quantidade por técnico.** Resultado (concluída/parcial/bloqueada) e quantidade executada são registrados por técnico. O resultado da tarefa é o pior resultado entre os técnicos (bloqueada > parcial > concluída).

### 3.2 Jornada, utilização e dias incompletos

- **RN-06 — Jornada.** Jornada = `STANDARD_WORKDAY_HOURS` (8h) por dia com check-in. Mantida como hoje.
- **RN-07 — Utilização.** Utilização = horas produtivas (RN-04) ÷ jornada (RN-06), por técnico e no total (razão das somas, não média das porcentagens).
- **RN-08 — Faixas de utilização** (valores iniciais, configuráveis em constante única):

  | Faixa | Cor | Significado |
  |---|---|---|
  | < 50% | vermelho | Baixa — ocioso, exige ação |
  | 50–69% | âmbar | Atenção |
  | 70–100% | verde | Normal |
  | > 100% | cinza + ícone de alerta | **Dado suspeito** (não é "sobrecarga") — revisar apontamento |

- **RN-09 — Dia sem "Fim de Expediente".** *(Aprovada em 2026-10-02.)* Quando o último status do dia não é `off_duty`:
  - **Se o último status for `in_progress`** (execução de fato): **não há corte**. A contagem segue até o próximo evento ou até a meia-noite, e o dia **não** é marcado como incompleto. O status de presença `in_progress` só é definido pelo sistema enquanto uma tarefa está rodando; ao pausar, a presença volta para `available` — portanto tarefa **pausada não conta** como execução.
  - **Em qualquer outro status** (`available`, `site_blocked`, `awaiting_release`, `lunch`, `personal`, inclusive com tarefa pausada): a contagem daquele status termina em `checked_in_at + 9h` (jornada + almoço) ou na meia-noite, o que vier primeiro, e o dia é marcado como **incompleto**.
  - Dias incompletos aparecem como contador por técnico.
- **RN-10 — Fuso.** Todas as datas e cortes de dia em UTC−3. No frontend, "hoje" e "30 dias atrás" são calculados na data local do Brasil, nunca com `toISOString()`.

### 3.3 Improdutivo

- **RN-11 — Duas categorias, nunca somadas sem rótulo:**
  - **Bloqueio externo** (site/cliente): `site_blocked` (Sem Acesso ao Site) + `awaiting_release` (Aguardando Liberações). É a evidência para conversa com o cliente.
  - **Ocioso interno**: `available` (Disponível sem tarefa). É falha de despacho/planejamento.
  - `lunch` e `personal` são neutros e não entram em nenhuma das duas.
- **RN-26 — Limite de ocioso interno.** *(Aprovada em 2026-10-02.)* 30 minutos por técnico por dia. No período, compara a média diária (ocioso interno ÷ dias com check-in); no bloco Hoje, compara o ocioso do dia. Acima do limite, o técnico entra na lista de exceções. Bloqueio externo não tem limite (não é falha interna).
- **RN-12 — Mesma definição em toda a tela.** Cartões, barras por técnico e gráfico por motivo usam RN-11.
- **RN-13 — Metas são por pessoa.** Qualquer meta diária (ex.: horas produtivas) é comparada com **média por técnico com check-in**, nunca com a soma da equipe.

### 3.4 Período e filtros

- **RN-14 — Filtro de período vale para toda a seção "Período".** O bloco "Hoje" é separado, com título explícito, e não muda com o filtro.
- **RN-15 — Filtro de site** aplica-se às duas seções (tarefas pelo site do projeto; técnicos pelos sites do colaborador).

### 3.5 Base de estimativa por atividade (aprovada)

- **RN-16 — Agrupamento.** Tempo por atividade agrupa por **Atividade do catálogo mestre** (`generated_task.activity`) × **família de cabo** (`generated_task.scope_item.cable_family`), não pelo nome da tarefa. Tarefas sem `generated_task` (manuais) ficam fora e são contadas como "excluídas: sem vínculo ao catálogo".
- **RN-17 — Unidade.** Unidade = `Activity.default_unit`; se vazia, `scope_item.unit`. Quantidade da execução = `quantity_planned` da tarefa; se vazia, `scope_item.quantity`.
- **RN-18 — Lançamento de cabo.** Quando o item tem `length_m`, registrar **duas** medidas: HH por metro (metros = quantidade × `length_m`) e HH por cabo.
- **RN-19 — Execuções válidas para estimativa.** Uma execução = uma tarefa fechada no período (todos os técnicos concluíram). Entram apenas tarefas com resultado agregado Concluída (ou vazio), com apontamento real (RN-05) e quantidade > 0. A quantidade usada é a planejada da tarefa. **Parciais e bloqueadas ficam fora** até existir quantidade executada numérica (Fase 3). Cada exclusão é contada por motivo.
- **RN-20 — Estatística.** HH por unidade usa **mediana**, com P25 e P75. Também exibir HH mediano, duração mediana e equipe média.
- **RN-21 — Amostra mínima.** Com menos de **5** execuções válidas, a linha mostra "Dados insuficientes (n=X)" no lugar da referência. "Sem dados" ≠ zero.

### 3.6 Conexões (Fase 2, aprovada)

- **RN-22 — Produtividade da equipe** = conexões ÷ HH × 8 (conexões por pessoa-dia; referência atual 37). Conexões = soma de `RackPosition.links` das tarefas concluídas.
- **RN-23 — Crédito por técnico** proporcional às horas reais de cada um na tarefa. A soma dos créditos é igual ao total entregue.

### 3.7 Qualidade do dado

- **RN-24 — Taxa de rastreamento** = concluídas com apontamento real ÷ concluídas, por técnico, por atividade e no total do período.
- **RN-25** — Toda tabela mostra quantas execuções entraram e quantas foram excluídas.

## 4. KPIs e fórmulas

| KPI | Numerador | Denominador | Filtro / período | Sem dado |
|---|---|---|---|---|
| Utilização | Horas em `in_progress` (RN-04) | Dias com check-in × 8h | Período, site | "—" se sem check-in |
| HH consumido | Σ `assignment.actual_hours` | — | Tarefas concluídas no período (`actual_end`) | 0 só se houve tarefas rastreadas |
| Bloqueio externo | Horas em `site_blocked` + `awaiting_release` | Horas de jornada | Período | "—" |
| Ocioso interno | Horas em `available` | Horas de jornada | Período | "—" |
| Taxa de rastreamento | Concluídas com apontamento real | Concluídas | Período | "—" se 0 concluídas |
| HH por unidade | Mediana de (HH ÷ quantidade) por execução | — | Atividade × família de cabo, período | "Dados insuficientes" se n < 5 |
| Conexões/pessoa-dia (F2) | Conexões entregues × 8 | HH | Período | "—" |

Timezone: UTC−3 para todos os cortes de dia.

## 5. Dados

### Modelos usados (todos existentes)
- `ProjectTask`: `actual_start`, `actual_end`, `actual_hours`, `paused_seconds`, `status`, `completion_outcome`, `quantity_planned`, `unit`, `generated_task`, `origin`, `rack_positions`.
- `ProjectTaskAssignment`: `assignment_start`, `assignment_end`, `paused_seconds`, `actual_hours`, `dispatched_at`.
- `master_data.GeneratedTask` → `activity` (`code`, `name`, `default_unit`, `measurable`) e `scope_item` (`cable_family`, `cable_spec`, `quantity`, `unit`, `length_m`, `medium`, `preterminated`).
- `TechnicianDailyPresence`, `TechnicianStatusEvent`.

### Migrações
- **Fase 1: nenhuma.**
- Fase 3: `ProjectTask.quantity_done_value` (`DecimalField`, `null=True`) aditivo, mantendo o `quantity_done` texto atual.

### Endpoint — `GET /api/operations/reports/` (alteração aditiva)

Campos atuais mantidos durante a transição; novos campos:

```jsonc
{
  "date_from": "2026-09-03", "date_to": "2026-10-02",
  "stats": {
    // existentes mantidos...
    "period_completed_count": 412,
    "tracked_completed_count": 371,
    "tracking_rate_pct": 90,              // null se 0 concluídas
    "man_hours_total": 1520.5,            // RN-01
    "productive_hours_total": 980.0,      // RN-04
    "journey_hours_total": 1280.0,
    "utilization_pct": 77,                // RN-07, null se jornada 0
    "external_block_hours": 64.0,         // RN-11
    "internal_idle_hours": 120.5,         // RN-11
    "incomplete_days": 7                  // RN-09
  },
  "today": {
    "technicians_checked_in": 12,
    "productive_hours_avg_per_tech": 4.2, // RN-13
    "external_block_hours": 1.5,
    "internal_idle_hours": 3.0
  },
  "technicians": [{
    "id": 1, "name": "...", "site_name": "...",
    "productive_hours": 120.0,            // RN-04 (substitui worked_hours)
    "man_hours": 120.0,
    "journey_hours": 160.0,
    "utilization_pct": 75,
    "utilization_band": "normal",         // "low" | "attention" | "normal" | "suspect" | null
    "completed_count": 40,
    "untracked_count": 3,
    "tracking_rate_pct": 93,
    "external_block_hours": 6.0,
    "internal_idle_hours": 10.0,
    "incomplete_days": 1
  }],
  "activity_productivity": [{
    "activity_code": "CAB-RUN", "activity_name": "Lançar cabeamento",
    "cable_family_code": "CAT6A", "cable_family_name": "Cat6A U/FTP",
    "unit": "CABLE",
    "executions_total": 38, "executions_used": 31,
    "excluded": { "untracked": 4, "partial_or_blocked": 2, "no_quantity": 1 },
    "sufficient_sample": true,            // RN-21 (n >= 5)
    "median_man_hours": 2.5,
    "median_duration_hours": 1.0,
    "avg_crew_size": 2.4,
    "total_quantity": 620,
    "hh_per_unit": { "median": 0.12, "p25": 0.09, "p75": 0.16 },
    "hh_per_meter": { "median": 0.008, "p25": 0.006, "p75": 0.011, "total_meters": 9300 } // null se sem length_m
  }],
  "activity_excluded_no_catalog": 57,     // RN-16
  "unproductive_by_reason": [             // agora respeita o período (RN-14)
    { "status": "site_blocked", "status_display": "Sem Acesso ao Site", "category": "external", "hours": 40.0 }
  ],
  "log_entries": [
    { "at": "...", "name": "...", "type": "complete", "text": "..." } // type: dispatch|start|complete|pause|available|checkin|status
  ]
}
```

O campo antigo `activities` continua sendo enviado na Fase 1 e é removido depois que o frontend migrar.

### Exportação CSV
Fase 1 no frontend (mesmo padrão de `exportCsv` em `ProjectsList.tsx`), um botão por tabela: Técnicos, Produtividade por atividade, Improdutivo por motivo. Separador `;`, BOM UTF-8 (abre direto no Excel pt-BR), números com vírgula decimal no pt-BR.

## 6. Permissões

- Tela e endpoint continuam com `PERMS.viewOperationsBoard` / `projects.view_projecttaskassignment`.
- CSV não exige permissão extra (mesmos dados da tela).
- Fase 2: a seção de projetos (HH real × orçado) exige também `projects.view_project`; sem ela, a seção não é exibida.

## 7. Escopo

### Fase 1 — MVP (correções + base de estimativa)
1. RN-01 a RN-15: correções de cálculo, unificação do improdutivo, cores de utilização, metas por pessoa, filtros e fuso.
2. RN-16 a RN-21: nova tabela "Produtividade por atividade" substituindo "Tempo por tipo de atividade".
3. RN-24/25: taxa de rastreamento e contadores de exclusão.
4. `type` nos eventos do log (fim da detecção por texto em português).
5. Exportação CSV.
6. Troca de emojis por `<Icon>`.

### Fase 2
- Conexões por pessoa-dia e crédito por técnico (RN-22/23).
- Seção de projetos: HH real × orçado (`estimated_hours`), avanço real × planejado (SPI), projetos atrasados.
- "Lista de exceções" de técnicos no lugar do ranking: utilização baixa, dado suspeito, dias incompletos, tarefa concluída sem check-in.
- Tendência diária no período (produtivo, bloqueio externo, ocioso) no lugar do log de hoje.

### Fase 3
- Quantidade executada numérica, informada pelo técnico no WhatsApp ao finalizar (permite usar execuções parciais).
- Motivos de improdutividade (acesso, sala, material, cliente, EHS) escolhidos no WhatsApp ao pausar.
- Tempo entre despacho e início real.
- Aprovação na primeira certificação via importação CSV do Fluke LinkWare / VIAVI.

## 8. Critérios de aceite (Fase 1)

1. **HH com entrada tardia.** Dado uma tarefa concluída com A (3h), B (3h) e C (1h) apontados por assignment, quando abro o relatório do período, então o HH da tarefa soma 7h e a utilização de cada técnico considera só as suas horas.
2. **Pausa longa.** Dado uma tarefa iniciada na segunda, pausada à noite e concluída na sexta com 6h reais, quando abro o relatório, então o técnico recebe 6h produtivas, não ~100h, e a utilização não passa de 100% por causa dela.
3. **Utilização suspeita.** Dado um técnico com utilização > 100%, então a barra aparece cinza com ícone de alerta e rótulo "Dado suspeito", nunca vermelho de "sobrecarga".
4. **Utilização baixa.** Dado um técnico com 30% de utilização, então ele aparece em vermelho.
5. **Meta por pessoa.** Dado 3 técnicos com 4h produtivas cada hoje, então o cartão mostra média de 4h por técnico (67% da meta de 6h), não 12h/200%.
6. **Dia sem Fim de Expediente.** Dado um técnico com check-in às 8h e último status "Disponível" às 15h, sem Fim de Expediente, então o ocioso daquele dia termina às 17h (8h + 9h) e o dia conta como incompleto.
6b. **Execução de fato não é cortada.** Dado um técnico com check-in às 8h que iniciou uma tarefa às 16h e não a pausou nem finalizou até as 19h (próximo evento), então as 3h contam como produtivas, sem corte às 17h, e o dia não é marcado como incompleto.
6c. **Tarefa pausada é cortada.** Dado o mesmo técnico, mas com a tarefa pausada às 16h30 (presença volta para "Disponível") e sem novos eventos, então o ocioso termina às 17h e o dia conta como incompleto.
7. **Improdutivo consistente.** Dado qualquer filtro, então a soma de bloqueio externo dos técnicos é igual ao cartão de bloqueio externo, e o mesmo para ocioso interno.
8. **Filtro de período.** Quando mudo o período, então todos os cartões e tabelas da seção "Período" mudam; o bloco "Hoje" não muda.
9. **Fuso.** Dado que são 22h em Brasília, quando abro a tela, então o filtro padrão termina na data de hoje (Brasil), não amanhã.
10. **Agrupamento por atividade.** Dado tarefas "Lançar 50m Cat6A" e "Lançar 60m Cat6A" geradas pelo catálogo (mesma atividade e família), então aparecem numa única linha, com HH por cabo e HH por metro.
11. **Amostra pequena.** Dado uma combinação com 3 execuções válidas, então a linha mostra "Dados insuficientes (n=3)" e não exibe HH por unidade.
12. **Exclusões visíveis.** Dado 4 tarefas sem apontamento e 2 parciais numa atividade, então a linha informa 4 + 2 excluídas, e o rodapé mostra quantas tarefas ficaram fora por não terem vínculo com o catálogo.
13. **Taxa de rastreamento.** Dado 40 concluídas, 37 com apontamento, então o técnico mostra 93%.
14. **Log em inglês.** Com idioma en-US, os rótulos/filtros do log aparecem em inglês e os filtros funcionam pelo `type`, não pelo texto.
15. **CSV.** Clicando em exportar na tabela de atividades, baixa um CSV que abre no Excel pt-BR com acentos e decimais corretos, contendo as mesmas linhas da tela (sem paginação).

## 9. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Números caem bruscamente após a correção (ex.: utilização de 250% para 60%) e geram desconfiança | Nota de versão na tela por 2 semanas: "Cálculo corrigido em DD/MM — veja o que mudou" com link para esta spec |
| Pouco histórico vinculado ao catálogo → muitas linhas "dados insuficientes" | Esperado no início; o contador de exclusões mostra o caminho (usar mais SOW via catálogo) |
| Técnicos não marcam Fim de Expediente | RN-09 limita o dano; contador de dias incompletos por técnico permite cobrança; Fase 3 pode lembrar via WhatsApp |
| Tarefa esquecida em execução (não pausada) passa da meia-noite sem corte (RN-09) | Fase 2: exceção "tarefa em execução há mais de 10h" na lista de exceções e na Central de Operações |
| Mediana instável em atividades com poucas execuções | Amostra mínima (RN-21) e exibição de P25–P75 |
| Performance (agregação em Python sobre o período) | Limitar período máximo a 180 dias na Fase 1; avaliar agregação SQL se passar de ~2 s |

## 10. Métrica de sucesso (30 dias após o lançamento)

- Nenhum técnico com utilização > 100% sem justificativa de dado.
- Taxa de rastreamento do período ≥ 90%.
- Pelo menos 10 combinações atividade × cabo com amostra suficiente.
- Comercial/planejamento usando o CSV de produtividade em ao menos uma proposta.

## Decisões (todas aprovadas em 2026-10-02)

| # | Decisão | Padrão adotado até resposta |
|---|---|---|
| D-1 | Corte do dia sem Fim de Expediente (RN-09) | **Aprovada:** check-in + 9h e dia incompleto, exceto quando o último status é execução de fato (`in_progress`, não pausada) |
| D-2 | Faixas de utilização (RN-08) | **Aprovada:** < 50 vermelho / 50–69 / 70–100 / > 100 "dado suspeito" |
| D-3 | Amostra mínima (RN-21) | **Aprovada:** 5 execuções |
| D-4 | Ordem das seções | **Aprovada:** bloco Hoje antes da seção Período (coordenadores usam a tela pelo dia corrente) |
| D-5 | Limite de ocioso interno (RN-26) | **Aprovada:** 30 min por técnico por dia |
| D-6 | Tarefa com apontamento real mas sem técnico vinculado (assignment) | **Aprovada (2026-10-03):** não gera HH nem entra na base de estimativa — sem técnico não há HH confiável. Não assumir equipe de 1 pessoa. |

---

## Briefing → layout-wfm

- **Objetivo da tela/fluxo e perfil principal:** reorganizar `/relatorios-indicadores` (Relatórios e Indicadores, ERP CSTR — obras de cabeamento em data center) para gestão por exceção. Perfis: gerente de projeto e coordenador (uso diário), diretoria (semanal), planejamento/comercial (ao orçar).
- **Decisão que o usuário precisa tomar nesta tela:** quem está ocioso ou com dado suspeito e precisa de ação; quanto tempo foi perdido por bloqueio do cliente (para cobrar); quanto HH cada tipo de atividade × cabo consome por unidade (para orçar).
- **Informações em ordem de prioridade:**
  1. *Exceção:* técnicos com utilização < 50% (vermelho) ou > 100% ("dado suspeito", cinza + alerta); dias incompletos; taxa de rastreamento < 90%.
  2. *Período:* cartões de Utilização, HH consumido, Bloqueio externo (cliente/site), Ocioso interno, Taxa de rastreamento, Concluídas no período.
  3. *Tabela de técnicos:* horas produtivas, jornada, utilização com faixa, HH, concluídas, taxa de rastreamento, bloqueio externo, ocioso, dias incompletos.
  4. *Tabela "Produtividade por atividade":* Atividade, Família de cabo, Unidade, Execuções usadas / total (com tooltip das exclusões por motivo), HH por unidade (mediana, com faixa P25–P75), HH por metro quando houver, HH mediano, Duração mediana, Equipe média. Linhas com n < 5 mostram "Dados insuficientes (n=X)".
  5. *Improdutivo por motivo:* duas categorias visualmente distintas (Bloqueio externo × Ocioso interno).
  6. *Bloco "Hoje" separado:* técnicos com check-in, média de horas produtivas por técnico vs. meta de 6h, bloqueio e ocioso de hoje, barra do dia por técnico, log do dia.
- **Ações principais e frequência:** mudar período e site (toda visita); exportar CSV de cada tabela (semanal); ordenar tabelas (frequente); passar o mouse em exclusões/faixas (ocasional).
- **Estados a desenhar:** carregando; período sem dados; atividade com amostra insuficiente; técnico sem jornada ("—"); "sem dados" diferente de zero; sem permissão (rota bloqueada pelo `RequirePermission`); erro de API; banner temporário "Cálculo corrigido em DD/MM".
- **Telas e componentes existentes a reaproveitar:** `PageHeader`, `DateInput`, `Pagination`, `Icon` (Material Symbols — substituir os emojis atuais), classes `ops-pool-card`, `ops-card-head`, `stat-grid`, `rpt-kpi-card`, `table`, `reason-bars`, `empty-state`. Barras são `<div>` com `width: %` (sem biblioteca de gráficos).
- **Restrições:** CSS puro em `index.css` com variáveis de cor existentes (`--green`, `--amber`, `--red`, `--blue`, `--text-faint`, versões `-soft`); dark mode via `[data-theme="dark"]`; densidade alta (desktop é o uso principal, mas precisa funcionar em tablet); textos em pt-BR, en-US, es-ES; rótulos devem distinguir "HH" de "duração" sem ambiguidade.
- **Entregável esperado:** proposta de layout com hierarquia das seções (Hoje × Período), wireframe textual ou mockup das duas tabelas principais, regras de cor de cada indicador e desenho de todos os estados acima.

## Briefing → frontend-erp

- **Arquivos/páginas a alterar ou criar:** `frontend/src/pages/OperationsReports.tsx`; `frontend/src/api/types.ts` (`OperationsReports`); `frontend/src/api/resources.ts` (se necessário); `frontend/src/index.css` (novos estilos `rpt-*`). Opcional: extrair um helper `utils/csv.ts` a partir de `exportCsv` de `ProjectsList.tsx`.
- **Endpoints e tipos:** `GET /api/operations/reports/?site=<id|all>&date_from=&date_to=` — contrato completo na seção 5 desta spec (`stats` ampliado, `today`, `technicians[]` com novos campos, `activity_productivity[]`, `activity_excluded_no_catalog`, `unproductive_by_reason[].category`, `log_entries[].type`). Campo `activities` antigo continua vindo na transição, mas a tela deve usar `activity_productivity`.
- **Regras de negócio que a UI deve respeitar:** RN-08 (faixas e cores de utilização, centralizar numa função), RN-10 (datas em UTC−3 — calcular "hoje" com data local, nunca `toISOString()`), RN-11/12 (rótulos Bloqueio externo × Ocioso interno), RN-13 (meta de 6h comparada com média por técnico), RN-14 (bloco Hoje separado do Período), RN-21 (dados insuficientes ≠ zero), RN-25 (exibir execuções usadas/excluídas), filtros do log por `type`.
- **Permissões e rotas:** rota `/relatorios-indicadores` sem mudança (`PERMS.viewOperationsBoard`).
- **Textos i18n (pt-BR / en-US / es-ES):**
  - "Homem-hora (HH)" / "Man-hours (MH)" / "Horas-hombre (HH)"
  - "Duração" / "Duration" / "Duración"
  - "Bloqueio externo (cliente/site)" / "External block (client/site)" / "Bloqueo externo (cliente/sitio)"
  - "Ocioso interno" / "Internal idle" / "Inactividad interna"
  - "Dado suspeito" / "Suspicious data" / "Dato sospechoso"
  - "Dados insuficientes (n={n})" / "Insufficient data (n={n})" / "Datos insuficientes (n={n})"
  - "Taxa de rastreamento" / "Tracking rate" / "Tasa de seguimiento"
  - "Dias incompletos" / "Incomplete days" / "Días incompletos"
  - "HH por unidade" / "MH per unit" / "HH por unidad"; "HH por metro" / "MH per meter" / "HH por metro"
  - "Equipe média" / "Avg crew" / "Equipo medio"
  - "Exportar CSV" / "Export CSV" / "Exportar CSV"
- **Critérios de aceite a verificar no navegador:** 3, 4, 5, 8, 9, 11, 12, 14 e 15 da seção 8; verificar também dark mode e largura de tablet (768px).

## Notas → backend / bot

- **`OperationsReportsView` (`backend/api/operations.py`):**
  - Horas do técnico pela RN-04 (eventos `in_progress` via `_presence_durations_by_collaborator`), não por intervalo `assignment_start → assignment_end` sem desconto de pausa (linhas ~513–516 atuais).
  - HH por `assignment.actual_hours` / `ProjectTask.real_man_hours` (RN-01), substituindo `hours * num_assignees` (linha ~534).
  - `_presence_durations_by_collaborator`: aplicar o corte da RN-09 (hoje o último status vai até 23:59:59) e devolver contagem de dias incompletos. O corte só se aplica quando o último evento do dia **não** é `in_progress`; precisa do `checked_in_at` de `TechnicianDailyPresence` do dia. Não aplicar ao dia corrente (ele já termina em `now`).
  - Improdutivo do período (não só do mês corrente) e com `category` external/internal (RN-11, RN-14).
  - Nova agregação `activity_productivity` por `generated_task.activity` × `generated_task.scope_item.cable_family`, com `select_related("generated_task__activity", "generated_task__scope_item__cable_family")`; mediana/P25/P75 com `statistics` da stdlib.
  - `_log_entries`: incluir `type` em cada entrada.
  - Limitar período a 180 dias (retornar 400 com mensagem clara acima disso).
- **Testes a adicionar** (`backend/api/tests.py`): HH com entrada tardia (7 HH); tarefa com pausa longa não infla utilização; dia sem Fim de Expediente cortado e contado como incompleto; agrupamento por atividade × família; amostra < 5 → `sufficient_sample: false`; exclusões por motivo; improdutivo por categoria somando igual entre cartão e técnicos; regressão dos campos antigos.
- **Migrações:** nenhuma na Fase 1. Fase 3: `ProjectTask.quantity_done_value` aditivo.
- **Bot WhatsApp:** nenhum impacto na Fase 1. Fase 3: pedir quantidade executada ao finalizar parcial e motivo ao pausar.
- **Consistência:** `projects/analytics.py::build_technical_performance` (Dashboard) usa o mesmo cálculo antigo de intervalos; alinhar com RN-01/RN-04 na mesma entrega ou em seguida, para o Dashboard não divergir dos Relatórios.

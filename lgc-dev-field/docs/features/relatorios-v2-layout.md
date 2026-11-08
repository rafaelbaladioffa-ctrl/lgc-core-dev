# Relatórios e Indicadores v2 — Proposta de layout

> Status: proposta para revisão (2026-10-02). Não implementada.
> Base: `docs/features/relatorios-v2.md` (spec aprovada, RN-01 a RN-25, contrato da seção 5, critérios da seção 8).
> Tela: `/relatorios-indicadores` — `frontend/src/pages/OperationsReports.tsx`.
> Escopo: **Fase 1**. Itens de Fase 2 aparecem só como "lugar reservado", sem dados inventados.

---

## 0. Referências consultadas e padrões escolhidos

| Referência (fonte verificada) | Padrão observado | Aplicação nesta tela |
|---|---|---|
| SAP Fiori — *Using Semantic Colors* (sap.com/design-system/fiori-design-web) | Cinco estados semânticos fixos (neutro, positivo, crítico, negativo, informação); a mesma cor tem o mesmo significado em todo o produto; cor nunca é o único portador do estado. | Faixas RN-08 usam vermelho/âmbar/verde e um **cinza neutro** para "dado suspeito" (não é "ruim", é "não confiável"). Todo estado colorido leva texto ou ícone. |
| SAP Fiori — *Analytical List Page* e *KPI tags* (SAPUI5 docs, community.sap.com) | KPIs curtos (rótulo + valor) acima da tabela, ligados ao filtro; tabela densa como corpo principal; o KPI pode filtrar a tabela. | Barra de **exceções clicáveis** que filtram a tabela de técnicos; cartões de KPI enxutos (sem ícone decorativo) logo abaixo do filtro de período que os afeta. |
| Microsoft Dynamics 365 Field Service — *Review resource utilization on the schedule board* (learn.microsoft.com) | Utilização = horas trabalhadas ÷ horas de jornada no intervalo, exibida ao lado do nome do recurso, para identificar sub e sobrealocação. | Utilização como coluna principal da tabela de técnicos, barra + % ao lado do nome; total como razão das somas (RN-07). |
| Oracle Field Service — *Overview of Dashboard and Reports* / *Navigate the Dashboard* (docs.oracle.com) | Painel do dia separado dos relatórios; por padrão o painel mostra o dia corrente, independentemente de relatórios históricos. | Bloco **"Hoje"** com título e data explícitos, fora do alcance do filtro de período (RN-14). |

**Limitação:** não consultei documentação de Salesforce Field Service nem NetSuite FSM para esta tela; nenhuma decisão abaixo é atribuída a eles. Não copio marca nem estética de nenhum dos produtos — só os padrões de interação acima.

**Padrões descartados de propósito:** ícones coloridos decorativos nos cartões (atual `rpt-kpi-icon` com emoji), ranking com barras relativas ao maior valor (distorce: 120% vira "barra cheia"), grade 2×2 de cartões com altura fixa e scroll interno (esconde linhas sem indicar), limiares não especificados ("limite recomendado 30min", alerta "> 40h").

---

## 1. Hierarquia das seções

Princípio: **escopo de filtro = escopo visual**. O filtro de site (RN-15, vale para tudo) fica no cabeçalho da página; o filtro de período (RN-14) fica **dentro** do cabeçalho da seção "Período", que é a única coisa que ele altera. O bloco "Hoje" tem cabeçalho próprio, sem controle de período.

> **Decisão do Rafael (2026-10-02):** os coordenadores usam a tela principalmente pelo dia corrente — **a Seção Hoje vem antes da Seção Período**. Os wireframes da §2 mostram a ordem antiga; na implementação, troque a ordem dos dois `<section>` (nenhum componente muda) e o atalho do cabeçalho passa a ser "Ir para Período". Limite de ocioso interno aprovado: **30 min por técnico por dia** (RN-26 da spec) — ver §4.2.

Ordem (Hoje primeiro; dentro de cada seção, exceção antes de contexto):

| # | Bloco | Título (pt-BR) | O que mostra | Fonte no contrato |
|---|---|---|---|---|
| 0 | Cabeçalho da página | Relatórios e Indicadores | Eyebrow, título, subtítulo; filtro **Site** (global); atalho âncora "Ir para Período". | `PageHeader` |
| 1 | Aviso temporário | — | Banner "Cálculo corrigido em DD/MM" (até DD/MM + 14 dias, dispensável). | constante no frontend (ver §5.7) |
| 2 | **Seção Período** — cabeçalho | Período | Título + intervalo (DateRangeCalendar, máx. 180 dias) + atalhos 7 / 30 / 90 dias + texto de escopo "Afeta todos os blocos desta seção". | `date_from`, `date_to` |
| 2.1 | Exceções | Requer atenção | Contadores clicáveis: utilização baixa (< 50%), dado suspeito (> 100%), ocioso interno acima de 30 min/dia (`idle_limit_exceeded`), técnicos com dias incompletos, rastreamento < 90% (total e por técnico). Clique filtra a tabela 2.3. | derivado de `technicians[]` e `stats` |
| 2.2 | KPIs do período | (sem título; os 6 cartões) | Utilização · HH consumido · Bloqueio externo · Ocioso interno · Taxa de rastreamento · Concluídas no período. | `stats.*` |
| 2.3 | Tabela de técnicos | Técnicos no período | Uma linha por técnico, exceções primeiro, linha de total. CSV. | `technicians[]`, `stats` |
| 2.4 | Improdutivo por motivo | Improdutivo por motivo | Dois grupos lado a lado: Bloqueio externo (cliente/site) × Ocioso interno, cada um com subtotal e % da jornada. CSV. | `unproductive_by_reason[]` (`category`) |
| 2.5 | Base de estimativa | Produtividade por atividade | Atividade × família de cabo, HH por unidade (mediana, P25–P75), exclusões. CSV. | `activity_productivity[]`, `activity_excluded_no_catalog` |
| 3 | **Seção Hoje** — cabeçalho | Hoje · qua, 02/10 | Data local Brasil (RN-10), "Não muda com o filtro de período", botão Atualizar. | — |
| 3.1 | KPIs de hoje | (4 cartões compactos) | Técnicos com check-in · Produtivo médio por técnico vs. meta 6h (RN-13) · Bloqueio externo hoje · Ocioso interno hoje. | `today.*` |
| 3.2 | Barra do dia por técnico | Dia por técnico | Barra empilhada por técnico: execução / bloqueio externo / ocioso interno / intervalos; ordenada por ocioso interno. Técnico com ocioso hoje > 30 min recebe selo vermelho "Ocioso acima do limite". | `today_technicians[]` |
| 3.3 | Log do dia | Log do dia | Feed com filtros por `type`. | `log_entries[]` |
| — | Fase 2 (não desenhar agora) | — | Seção de projetos (HH real × orçado) entraria entre 2.2 e 2.3, só com `projects.view_project`; tendência diária substituiria 3.3. | — |

**(Superado pela decisão acima — mantido como histórico.)** Por que "Hoje" ficava embaixo: o briefing coloca o bloco Hoje em 6º na prioridade, e a ação operacional imediata (realocar técnico ocioso agora) acontece na Central de Operações. O atalho "Ir para Hoje" no cabeçalho resolve o acesso rápido do coordenador. **Ponto para validar com o Rafael:** se os coordenadores abrirem esta tela principalmente pelo bloco Hoje, inverter a ordem (Hoje em cima, compacto) não muda nenhum componente — só a ordem dos dois `<section>`.

---

## 2. Wireframes

### 2.1 Desktop (≥ 1280px de área de conteúdo)

```
+--------------------------------------------------------------------------------------------------------+
| CENTRAL DE OPERAÇÕES                                                                                   |
| Relatórios e Indicadores                                              [Site: Todos os sites    v]      |
| Utilização, homem-hora e base de estimativa por atividade             [ Ir para Hoje  (v) ]            |
+--------------------------------------------------------------------------------------------------------+
| (i) Cálculo corrigido em 02/10. Utilização agora desconta pausas e HH soma as horas de cada técnico.   |
|     [Ver o que mudou]                                                                     [Fechar  x]  |
+--------------------------------------------------------------------------------------------------------+

== PERÍODO ==========================================================================================
| Período   [03/09/2026 - 02/10/2026  (cal)]  [7 dias] [30 dias] [90 dias]     Afeta todos os blocos    |
|                                                                               desta seção.            |
+-----------------------------------------------------------------------------------------------------+
| REQUER ATENÇÃO                                                                                       |
| [(!) 3 Utilização baixa <50%] [(△) 1 Dado suspeito >100%] [(cal) 4 técnicos c/ dias incompletos (7)]  |
| [(△) Rastreamento 88% no período · 5 técnicos <90%]                                                  |
+-----------------------------------------------------------------------------------------------------+
| UTILIZAÇÃO     | HOMEM-HORA (HH)  | BLOQUEIO EXTERNO | OCIOSO INTERNO  | TAXA DE         | CONCLUÍDAS  |
|                | CONSUMIDO        | ■ cliente/site   | ■ interno       | RASTREAMENTO    | NO PERÍODO  |
| 77%            | 1.520,5 HH       | 64,0 h           | 120,5 h         | 88% (△)         | 412         |
| [=======---]   | 371 tarefas      | 5,0% da jornada  | 9,4% da jornada | 371 de 412 com  | 41 sem      |
| 980 h exec. ÷  | rastreadas       |                  |                 | apontamento     | apontamento |
| 1.280 h jorn.  |                  |                  |                 | (meta 90%)      | (fora do HH)|
+-----------------------------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------------------------+
| Técnicos no período   18 técnicos                    [Todos][Baixa 3][Suspeito 1][Incompl. 4][<90% 5]|
|                                                                                  [(dl) Exportar CSV]|
+-----------------------------------------------------------------------------------------------------+
| TÉCNICO          | UTILIZAÇÃO (v)        | H. EXEC. | JORNADA | HH     | BLOQ.EXT | OCIOSO | CONCL.   | RASTR. | DIAS INC.|
|------------------+-----------------------+----------+---------+--------+----------+--------+----------+--------+----------|
| (RS) Rafael S.   | [==-------] 31% (!)Baixa| 49,6 h | 160,0 h | 52,0 HH|   12,0 h | 38,5 h | 14 · 2 s/a | 86% △ |   2 (cal)|
|      DC-SP1      |                       |          |         |        |          |        |          |        |          |
| (JM) João M.     | [▒▒▒▒▒▒▒▒▒▒] 132% (△) | 211,2 h  | 160,0 h |198,0 HH|    0,0 h |  4,0 h | 41       | 100%   |   0      |
|      DC-SP1      |   Dado suspeito       |          |         |        |          |        |          |        |          |
| (AL) Ana L.      | [======---] 62%  Atenção| 99,2 h | 160,0 h |101,5 HH|    6,0 h | 20,0 h | 30 · 1 s/a | 97%   |   0      |
| (CP) Carlos P.   | [========-] 84%       | 134,4 h  | 160,0 h |140,0 HH|    4,5 h |  8,0 h | 40 · 3 s/a | 93%   |   1 (cal)|
| (MT) Marta T.    | Sem jornada           |   0,0 h  |    —    | 12,0 HH|      —   |    —   |  3       | 100%   |   —      |
|------------------+-----------------------+----------+---------+--------+----------+--------+----------+--------+----------|
| Total (18)       | 77%                   | 980,0 h  |1.280,0 h|1.520,5 | 64,0 h   |120,5 h | 412 · 41 | 90%    |   7      |
+-----------------------------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------------------------+
| Improdutivo por motivo                 Almoço e pausas pessoais não entram.   [(dl) Exportar CSV]    |
+---------------------------------------------------+-------------------------------------------------+
| ■ BLOQUEIO EXTERNO (CLIENTE/SITE)  64,0 h · 5,0%  | ■ OCIOSO INTERNO                120,5 h · 9,4%  |
| Evidência para o cliente                          | Falha de despacho/planejamento                  |
| Sem Acesso ao Site       [#######-----]  40,0 h   | Disponível sem tarefa  [##############] 120,5 h |
| Aguardando Liberações    [####--------]  24,0 h   |                                                 |
+---------------------------------------------------+-------------------------------------------------+
  (escala comum aos dois grupos: a maior barra da seção = 100%)

+-----------------------------------------------------------------------------------------------------+
| Produtividade por atividade   42 combinações · 31 com amostra suficiente                            |
| [Buscar atividade ou cabo...      ]  [x] Só amostra suficiente (n >= 5)        [(dl) Exportar CSV]  |
+-----------------------------------------------------------------------------------------------------+
|                                     |              |       REFERÊNCIA DE ESTIMATIVA      |     POR EXECUÇÃO (MEDIANA)    |
| ATIVIDADE      | FAMÍLIA DE CABO    | UN.  | EXEC.   | HH POR UNIDADE   | HH POR METRO     | HH     | DURAÇÃO | EQUIPE  |
|                |                    |      | usadas/ |                  |                  |        | (relógio)| MÉDIA  |
|                |                    |      | total   |                  |                  |        |         |         |
|----------------+--------------------+------+---------+------------------+------------------+--------+---------+---------|
| Lançar         | Cat6A U/FTP        | cabo | 31/38(i)| 0,12 HH/cabo     | 0,008 HH/m       | 2,5 HH | 1,0 h   | 2,4     |
| cabeamento     | CAT6A              |      |         | P25–P75 0,09–0,16| P25–P75 0,006–   |        |         |         |
| CAB-RUN        |                    |      |         |                  | 0,011 · 9.300 m  |        |         |         |
| Conectorizar   | MPO-12             | porta| 22/22   | 0,05 HH/porta    | —                | 1,1 HH | 0,6 h   | 2,0     |
| CON-MPO        |                    |      |         | P25–P75 0,04–0,07|                  |        |         |         |
| Certificar     | OM4                | link | 3/9 (i) | (i) Dados insuficientes (n=3)       | 0,9 HH*| 0,9 h*  | 1,0*    |
| CERT-FO        |                    |      |         |                                     | (*cinza: só informativo)     |
|----------------+--------------------+------+---------+------------------+------------------+--------+---------+---------|
| Exclusões nas linhas: 21 sem apontamento real · 9 parciais ou bloqueadas · 4 sem quantidade          |
| Fora da tabela: 57 tarefas concluídas sem vínculo ao catálogo mestre (tarefas manuais).             |
|                                                           [10 v] por página   < 1 2 3 4 5 >         |
+-----------------------------------------------------------------------------------------------------+

== HOJE · qua, 02/10 ======================================== Não muda com o filtro de período. [(r)]=
| TÉCNICOS COM CHECK-IN | PRODUTIVO MÉDIO / TÉCNICO      | BLOQUEIO EXTERNO HOJE | OCIOSO INTERNO HOJE |
| 12                    | 4h 12min  de 6h                 | ■ 1h 30min            | ■ 3h 00min           |
|                       | [=========-----] 70% da meta    |                       |                      |
+------------------------------------------------------+----------------------------------------------+
| Dia por técnico   (ordem: mais ocioso primeiro)      | Log do dia                        34 eventos |
| ■ Execução ■ Bloq. externo ■ Ocioso interno ■ Interv.| [Todos][Concluiu 8][Despacho 6][Início 7]    |
|                                                      | [Pausa 4][Disponível 5][Check-in 12][Status] |
| (RS) Rafael S.   [====|##|::::::::|..]  2h 10min/6h  |----------------------------------------------|
|      exec 2h10 · bloq 0h30 · ocioso 2h40 · int 1h00  | 14:32 (o) João M. concluiu "Lançar 50m..."   |
| (AL) Ana L.      [=========|::::|..]    4h 05min/6h  |            [Concluiu]                        |
| (JM) João M.     [=============|.]      5h 50min/6h  | 14:10 (o) Ana L. ficou disponível [Disponível]|
| ...                                                  | ...                                (scroll)  |
+------------------------------------------------------+----------------------------------------------+

Legenda: (!) ícone error  (△) ícone warning  (i) ícone info com tooltip  (cal) event_busy
         (dl) download  (r) refresh  ■ amostra de cor da categoria  (v) ordenação ativa
```

### 2.2 Tablet (768px — sidebar vira gaveta abaixo de 860px, conteúdo ≈ 736px)

```
+--------------------------------------------------+
| CENTRAL DE OPERAÇÕES                             |
| Relatórios e Indicadores                         |
| [Site: Todos os sites                       v]   |   <- largura total (regra .page-header @860 existente)
| [Ir para Hoje (v)]                               |
+--------------------------------------------------+
| (i) Cálculo corrigido em 02/10 ...  [Ver] [x]    |
+--------------------------------------------------+
== PERÍODO =========================================
| [03/09 - 02/10/2026 (cal)]                       |
| [7 dias] [30 dias] [90 dias]                     |   <- atalhos quebram linha
| Afeta todos os blocos desta seção.               |
| REQUER ATENÇÃO                                   |
| [(!) 3 Baixa <50%]   [(△) 1 Suspeito]            |   <- chips quebram em 2 colunas, alvo >= 36px
| [(cal) 4 Incompl.]   [(△) Rastr. 88%]            |
+----------------+----------------+----------------+
| UTILIZAÇÃO 77% | HH 1.520,5     | BLOQ. EXT 64 h |   <- 3 colunas x 2 linhas
+----------------+----------------+----------------+
| OCIOSO 120,5 h | RASTR. 88% (△) | CONCL. 412     |
+----------------+----------------+----------------+
| Técnicos no período                [CSV]         |
| [Todos][Baixa 3][Suspeito 1][Incompl. 4][<90% 5] |   <- chips com scroll horizontal se faltar espaço
| +---------------+------------------------------> |
| | TÉCNICO (fixa)| UTILIZ. | H.EXEC | JORN | ...  |   <- 1a coluna sticky; demais com scroll-x
| | Rafael S.     | 31% (!) | 49,6 h | 160h | ...  |      sombra na borda indica que há mais colunas
| +---------------+------------------------------> |
+--------------------------------------------------+
| Improdutivo por motivo            [CSV]          |
| ■ BLOQUEIO EXTERNO   64,0 h · 5,0%               |   <- grupos empilhados (1 coluna)
|   Sem Acesso ao Site  [######----]   40,0 h      |
|   Aguardando Lib.     [###-------]   24,0 h      |
| ■ OCIOSO INTERNO    120,5 h · 9,4%               |
|   Disponível          [##########]  120,5 h      |
+--------------------------------------------------+
| Produtividade por atividade        [CSV]         |
| [Buscar...                    ] [x] Só n>=5      |
| | ATIVIDADE (fixa) | FAMÍLIA | UN | EXEC | HH/UN ...-> scroll-x
+--------------------------------------------------+
== HOJE · qua, 02/10 =========================[(r)]=
| CHECK-IN 12          | PRODUTIVO MÉDIO 4h12/6h   |   <- 2 x 2
| BLOQ. EXT 1h30       | OCIOSO INT 3h00           |
+--------------------------------------------------+
| Dia por técnico  (largura total)                 |
+--------------------------------------------------+
| Log do dia  (largura total, altura máx. 360px,   |
|              scroll interno com sombra no fim)   |
+--------------------------------------------------+
```

Regras de responsividade:

| Largura | KPIs Período | KPIs Hoje | Improdutivo | Hoje (dia × log) | Tabelas |
|---|---|---|---|---|---|
| ≥ 1280 | 6 colunas | 4 colunas | 2 grupos lado a lado | 3fr / 2fr | todas as colunas visíveis |
| 861–1279 | 3 × 2 | 4 colunas | 2 grupos lado a lado | 1fr / 1fr | scroll-x se necessário, 1ª coluna fixa |
| 481–860 (768) | 3 × 2 | 2 × 2 | empilhados | empilhados | scroll-x, 1ª coluna fixa |
| ≤ 480 | 2 colunas (regra existente da `.stat-grid` vira 1) | 1 coluna | empilhados | empilhados | scroll-x |

Nenhuma coluna é escondida por largura: o CSV e a tela precisam mostrar os mesmos dados (critério 15), e esconder HH ou jornada no tablet tiraria justamente o que o gerente consulta.

---

## 3. Tabelas principais

### 3.1 Técnicos no período

| # | Coluna (pt-BR) | Campo | Alinh. | Formato | Ordenável | Tooltip do cabeçalho (ícone `info`) |
|---|---|---|---|---|---|---|
| 1 | Técnico | `name`, `site_name` | esq. | Avatar com iniciais (`rpt-avatar` existente) + nome; sites em linha secundária, 11px, `--text-muted`, separados por " · " | sim (alfabética) | — |
| 2 | Utilização | `utilization_pct`, `utilization_band` | esq. | Barra 80px (`width: min(pct,100)%`, **escala absoluta 0–100%**, não relativa ao maior) + `77%` + selo de faixa quando ≠ normal | sim (**padrão**) | "Horas em execução ÷ jornada (8 h por dia com check-in). Acima de 100% indica apontamento a revisar." |
| 3 | Horas em execução | `productive_hours` | dir. | `49,6 h` | sim | "Tempo em status Em Execução, contado uma vez mesmo com tarefas paralelas. Já desconta pausas." |
| 4 | Jornada | `journey_hours` | dir. | `160,0 h`; `—` se 0 | sim | "8 h por dia com check-in." |
| 5 | HH | `man_hours` | dir. | `52,0 HH` | sim | "Homem-hora: soma das horas reais deste técnico nas tarefas concluídas. Base de faturamento." |
| 6 | Bloqueio externo | `external_block_hours` | dir. | amostra roxa + `12,0 h`; `—` se sem jornada | sim | "Sem Acesso ao Site + Aguardando Liberações." |
| 7 | Ocioso interno | `internal_idle_hours` | dir. | amostra vermelha + `38,5 h`; `—` se sem jornada | sim | "Disponível sem tarefa." |
| 8 | Concluídas | `completed_count`, `untracked_count` | dir. | `14` e, se `untracked_count > 0`, ` · 2 s/a` em `--text-muted` (tooltip na célula: "2 sem apontamento real — fora do HH") | sim | — |
| 9 | Rastreamento | `tracking_rate_pct` | dir. | `93%`; < 90% → ícone `warning` âmbar antes do número; `—` se 0 concluídas | sim | "Concluídas com apontamento real ÷ concluídas. Meta: 90%." |
| 10 | Dias incompletos | `incomplete_days` | dir. | `0` em `--text-faint`; ≥ 1 → número em `--text` + ícone `event_busy` âmbar | sim | "Dias sem Fim de Expediente. O tempo foi cortado em check-in + 9 h." |

**Ordenação padrão — "exceções primeiro"** (indicador de ordenação no cabeçalho Utilização, `aria-sort` + rótulo "Exceções primeiro"):
1. `low` (crescente de %) → 2. `suspect` (decrescente) → 3. `attention` (crescente) → 4. `normal` (crescente) → 5. `null` / sem jornada (alfabética).
Clicar em Utilização alterna para ordem numérica crescente → decrescente → volta ao padrão. Demais colunas: 1º clique decrescente para números, crescente para texto. Uma ordenação ativa por vez; nada persiste entre visitas.

**Filtros rápidos** (chips no cabeçalho do card, reaproveitando o visual de `log-filter-chip`): Todos · Utilização baixa (n) · Dado suspeito (n) · Dias incompletos (n) · Rastreamento < 90% (n). Seleção única. Chip com n = 0 fica desabilitado (não some, para manter a posição). Os itens da barra "Requer atenção" (2.1) acionam o mesmo filtro e rolam até a tabela. O hint do card mostra "5 de 18 técnicos · filtro: Utilização baixa [Limpar]".

**Linha de total (`<tfoot>`)**: soma de horas, jornada, HH, bloqueio, ocioso, concluídas e incompletos; Utilização e Rastreamento do total vêm de `stats.utilization_pct` / `stats.tracking_rate_pct` (razão das somas, RN-07 — nunca média das linhas). A linha total sempre reflete **todos** os técnicos, mesmo com filtro rápido ativo (rótulo "Total (18)"), para não sugerir que o filtro mudou o KPI.

**Sem paginação**: o quadro de técnicos cabe numa página (dezenas de linhas). Se passar de 50 linhas, usar `Pagination` existente com 50 por página.

**Linha**: altura 40px (padding de célula 8px 12px, mais denso que o `.table` padrão de 12px 16px, via modificador `rpt-table-dense`). Sem cor de fundo na linha inteira; o estado fica na célula de utilização. Hover existente do `.table`.

### 3.2 Produtividade por atividade

Cabeçalho em dois níveis para separar sem ambiguidade **HH (esforço, faturável)** de **duração (relógio, cronograma)**:

```
|  ATIVIDADE | FAMÍLIA DE CABO | UN. | EXECUÇÕES |  REFERÊNCIA DE ESTIMATIVA   |  POR EXECUÇÃO (MEDIANA)     |
|            |                 |     |           | HH POR UNIDADE | HH POR METRO | HH   | DURAÇÃO | EQUIPE MÉDIA |
```

| # | Coluna | Campo | Alinh. | Formato | Ordenável |
|---|---|---|---|---|---|
| 1 | Atividade | `activity_name`, `activity_code` | esq. | Nome 600; código em linha secundária, fonte mono 11px, `--text-muted` | sim |
| 2 | Família de cabo | `cable_family_name`, `cable_family_code` | esq. | Nome; código abaixo. Sem família → `—` | sim |
| 3 | Unidade | `unit` | esq. | Rótulo traduzido da unidade quando houver mapeamento (cabo, porta, link, m); senão o código como veio | não |
| 4 | Execuções | `executions_used`, `executions_total`, `excluded` | dir. | `31 / 38`. Se houver exclusões, ícone `info` (botão focável) abre tooltip com motivos | sim (por `executions_used`) |
| 5 | HH por unidade | `hh_per_unit.median/p25/p75` | dir. | Linha 1: `0,12 HH/cabo` (600). Linha 2 (11px, `--text-muted`): `P25–P75 0,09–0,16` | sim |
| 6 | HH por metro | `hh_per_meter.*` | dir. | Igual à 5 + ` · 9.300 m` na linha 2. `null` → `—` com tooltip "Item sem comprimento cadastrado" | sim |
| 7 | HH | `median_man_hours` | dir. | `2,5 HH` | sim |
| 8 | Duração | `median_duration_hours` | dir. | `1,0 h` (cabeçalho com tooltip: "Tempo de relógio do início ao fim, sem pausas. Não usar para faturar.") | sim |
| 9 | Equipe média | `avg_crew_size` | dir. | `2,4` (1 casa) | sim |

`total_quantity` aparece no tooltip de Execuções ("Quantidade total: 620 cabos") e no CSV, para não abrir uma 10ª coluna.

**Precisão dos números** (Intl.NumberFormat do idioma ativo): valor < 0,1 → 3 casas; < 10 → 2 casas; ≥ 10 → 1 casa. Mesma regra para P25/P75 da linha, para os três números ficarem comparáveis.

**Tooltip de exclusões** (RN-25, critério 12):

```
Execuções desta combinação
  Usadas na referência ............ 31
  Excluídas ........................ 7
    Sem apontamento real ........... 4
    Parcial ou bloqueada ........... 2
    Sem quantidade ................. 1
  Quantidade total ............... 620 cabos
```
Motivos com 0 não aparecem.

**Tooltip de HH por unidade:** "Mediana de HH ÷ quantidade em cada execução. Metade das execuções ficou entre P25 e P75; quanto mais larga a faixa, menos previsível a atividade."

**Amostra insuficiente (`sufficient_sample = false`, RN-21, critério 11):**
- Colunas 5 e 6 viram uma única célula (`colSpan=2`) com selo neutro: ícone `info` + "Dados insuficientes (n=3)". Nenhum número de HH por unidade é renderizado (nem no `title`).
- Colunas 7–9 continuam visíveis, em `--text-muted` com asterisco e tooltip "Amostra pequena — informativo, não usar para orçar".
- No CSV, as colunas de HH por unidade/metro saem vazias e uma coluna "Amostra suficiente" sai "Não".

**Ordenação padrão:** amostra suficiente primeiro; dentro de cada grupo, `executions_used` decrescente. Ordenar por HH por unidade compara unidades diferentes; por isso, ao ordenar por essa coluna, as linhas são agrupadas por unidade (ordem: unidade, depois valor) — sem isso a ordenação engana.

**Ferramentas do card:** busca textual (atividade, código ou família; cliente, sem chamada à API) · caixa "Só amostra suficiente (n ≥ 5)", desmarcada por padrão · Exportar CSV (exporta todas as linhas, ignorando busca e paginação, como pede o critério 15 — o rótulo do botão não muda; a busca não filtra o CSV).

**Rodapé (RN-16/RN-25):**
- "Exclusões nas linhas: 21 sem apontamento real · 9 parciais ou bloqueadas · 4 sem quantidade" (soma de `excluded` de todas as linhas, não só da página).
- "Fora da tabela: 57 tarefas concluídas sem vínculo ao catálogo mestre (tarefas manuais)." (`activity_excluded_no_catalog`; 0 → linha não aparece).
- `Pagination` existente, 10 por página por padrão (mantém o comportamento atual).

---

## 4. Regras de cor

Regra geral (Fiori, semântica fixa): **a cor nunca é o único portador do estado** — sempre acompanha ícone, rótulo ou ambos. Por contraste, `--green` (#16a34a) e `--amber` (#d97706) no fundo branco ficam ≈ 3,2:1, abaixo de AA para texto pequeno. Então:
- Texto ≥ 18,7px bold (valor dos KPIs) pode usar a cor da faixa.
- Em tabela e selos, o **número fica em `--text`**; a cor vai na barra, no ícone e no fundo `-soft` do selo.
- Vermelho (`--red`, ≈ 4,8:1) pode colorir texto pequeno.

Centralizar numa única função/constante (`UTIL_BANDS` em `OperationsReports.tsx` ou `utils/reports.ts`), consumida pelo cartão, pela tabela e pela barra de exceções.

### 4.1 Utilização (RN-08)

| Faixa (`utilization_band`) | Condição | Barra | Selo na célula | Valor no KPI | Ícone |
|---|---|---|---|---|---|
| `low` | < 50% | `--red` | fundo `--red-soft`, texto `--red`, "Baixa" | `--red` | `error` |
| `attention` | 50–69% | `--amber` | fundo `--amber-soft`, texto `--text`, "Atenção" | `--amber` | — (o selo basta) |
| `normal` | 70–100% | `--green` | sem selo | `--text` (neutro: normal não precisa chamar atenção) | — |
| `suspect` | > 100% | `--text-faint` com listras diagonais (`repeating-linear-gradient` de `--text-faint`/`--border`), barra cheia | fundo `--bg`, borda `--border`, texto `--text-muted`, "Dado suspeito" | `--text-muted` + ícone | `warning` (cor `--text-muted`) |
| `null` | sem jornada | sem barra | texto "Sem jornada" (`rpt-no-journey` existente) | `—` + hint "Sem check-in no período" | — |

Nunca usar vermelho ou âmbar para > 100% (critério 3). O backend manda `utilization_band`; se vier `null` com `utilization_pct` numérico, o frontend calcula a faixa pela mesma constante (defesa na transição).

### 4.2 Bloqueio externo × Ocioso interno (RN-11/12)

Duas cores de **categoria**, iguais em toda a tela (KPI, colunas da tabela, grupos de motivo, barra do dia):

| Categoria | Cor | Por quê | Marcador |
|---|---|---|---|
| Bloqueio externo (cliente/site) | `--purple` / `--purple-soft` | Não é falha nossa; é evidência para conversa com o cliente. Fica fora do eixo vermelho/âmbar/verde para não ser lido como "ruim nosso". | quadrado 8px + rótulo "Bloqueio externo (cliente/site)" |
| Ocioso interno | `--red` / `--red-soft` | Falha de despacho/planejamento, exige ação interna; coerente com "utilização baixa = vermelho". | quadrado 8px + rótulo "Ocioso interno" |
| Execução (só barra do dia) | `--green` | Tempo produtivo. | rótulo "Execução" |
| Intervalos (almoço/pessoal, só barra do dia) | `--border` / `--text-faint` | Neutro (RN-11): não é improdutivo. | rótulo "Intervalos" |

Os valores numéricos de bloqueio externo ficam em `--text` (não há limiar aprovado). **Ocioso interno tem limite aprovado de 30 min por técnico por dia (RN-26):** quando `idle_limit_exceeded` é verdadeiro (por técnico no período ou em `today_technicians`), o valor ganha selo vermelho com ícone `warning` e tooltip "Média de X por dia — limite 30 min". No KPI do período, mostrar "N técnicos acima do limite" como dica; o total em horas fica sem cor. O % da jornada (`horas ÷ stats.journey_hours_total`) é exibido como contexto, sem cor.

### 4.3 Taxa de rastreamento (RN-24)

| Condição | KPI | Célula da tabela | Exceções |
|---|---|---|---|
| ≥ 90% | valor `--text`, hint "371 de 412 com apontamento real" | número `--text` | — |
| < 90% | valor `--amber` + ícone `warning`, hint "Abaixo da meta de 90%" | ícone `warning` âmbar + número `--text` | item "Rastreamento 88% · 5 técnicos < 90%" |
| `null` | `—`, hint "Nenhuma tarefa concluída no período" | `—` | — |

### 4.4 Demais indicadores

| Indicador | Cor | Observação |
|---|---|---|
| HH consumido | neutra (`--text`) | Volume, não é bom nem ruim. |
| Concluídas no período | neutra | Hint mostra `period_completed_count − tracked_completed_count` sem apontamento. |
| Dias incompletos | ícone `event_busy` `--amber` quando ≥ 1 | É cobrança de disciplina de apontamento, não emergência. |
| Produtivo médio por técnico hoje (RN-13) | barra `--green` até 100% da meta de 6 h; valor neutro | Não aplicar faixas RN-08 ao dia em curso: às 10h todo mundo estaria "vermelho". |
| Banner de correção | `--blue-soft` / `--blue` | Estado informativo. |
| Erro de API | `--red-soft` / `--red` | — |

Dark mode: todas as cores acima são variáveis já redefinidas em `[data-theme="dark"]`; a única regra nova é a listra do "dado suspeito", que usa `--text-faint`/`--border` e por isso se adapta sozinha.

---

## 5. Estados

### 5.1 Carregando (primeira carga, `data == null`)
- Cabeçalho, filtro de site e controle de período ficam **interativos** imediatamente.
- KPIs: 6 + 4 blocos `rpt-skeleton` com a mesma altura do cartão (evita salto de layout).
- Tabelas: cabeçalho real + 5 linhas `rpt-skeleton-row`.
- `aria-busy="true"` na `<section>`; texto oculto para leitor de tela "Carregando relatório…".
- Substitui o atual `<p>Carregando...</p>`.

### 5.2 Recarregando (troca de filtro com dados na tela)
- Mantém os dados anteriores com `opacity: .55` e `pointer-events: none` na seção afetada (`rpt-is-refreshing`), e um indicador "Atualizando…" (ícone `progress_activity` girando) ao lado do título "Período".
- O bloco Hoje **não** escurece ao mudar o período (reforça RN-14 visualmente), mesmo que a mesma chamada traga os dois. Ao mudar o site, ambos escurecem.

### 5.3 Período sem dados
Condição: `technicians.length === 0` e `stats.period_completed_count === 0`.
- KPIs com `—` e hint "Sem dados no período".
- Barra "Requer atenção" substituída por uma linha neutra "Sem dados para avaliar exceções neste período."
- Tabelas: `table-empty` com ícone `event_note` + "Nenhuma atividade no período selecionado." + ação "Ampliar para 90 dias" (aplica o atalho; respeita o limite de 180).
- Improdutivo: "Nenhum tempo improdutivo registrado no período." — **diferente** do caso em que há jornada e o improdutivo é 0 (ver 5.6).

### 5.4 Amostra insuficiente
Ver §3.2. Além da linha, o hint do card mostra "42 combinações · 31 com amostra suficiente". Se **nenhuma** linha tiver amostra suficiente: aviso neutro no topo do card, "Nenhuma combinação atingiu 5 execuções válidas no período. Amplie o período ou gere tarefas pelo catálogo mestre."

### 5.5 Técnico sem jornada
`journey_hours === 0` / `utilization_pct === null`:
- Utilização: "Sem jornada" (`rpt-no-journey`), sem barra, sem selo.
- Jornada, Bloqueio externo, Ocioso interno: `—`.
- HH, Concluídas, Rastreamento: mostrados normalmente (ele pode ter concluído tarefas sem check-in — é informação útil).
- Não entra na contagem de "Utilização baixa"; vai para o fim da ordenação padrão.

### 5.6 "Sem dados" ≠ zero
Regra única de renderização: `null`/ausente → `—` em `--text-faint` com `title`/tooltip explicando o motivo; `0` → `0,0 h` / `0%` em `--text`.

| Campo | Mostra `—` quando | Mostra `0` quando |
|---|---|---|
| `utilization_pct` | sem jornada | jornada > 0 e nenhuma hora em execução |
| `tracking_rate_pct` | 0 concluídas | concluídas > 0, nenhuma rastreada |
| `man_hours_total` | sem tarefas rastreadas no período | (nunca 0 "real" sem tarefas — spec seção 4) |
| bloqueio / ocioso | sem jornada | jornada > 0 e nenhum minuto no status |
| `hh_per_unit` | `sufficient_sample = false` → selo "Dados insuficientes (n=X)" | — |
| `hh_per_meter` | `null` (sem `length_m`) | — |
| `today.productive_hours_avg_per_tech` | 0 técnicos com check-in → "Nenhum técnico com check-in hoje" | check-in feito, nada executado → `0min de 6h` |

### 5.7 Banner "Cálculo corrigido em DD/MM"
- Faixa `rpt-notice rpt-notice--info` abaixo do cabeçalho: ícone `info`, "Cálculo corrigido em 02/10. A utilização agora desconta pausas, o HH soma as horas de cada técnico e o tempo por atividade usa o catálogo mestre."
- "Ver o que mudou" expande in-place (`<details>`) com 4 itens: pausas descontadas (RN-04); HH por técnico (RN-01); dia sem Fim de Expediente cortado em check-in + 9 h (RN-09); atividades agrupadas por atividade × família de cabo (RN-16). Não linkar para o `.md` do repositório — o usuário final não tem acesso a ele.
- "Fechar" grava `localStorage` (`rpt-calc-fix-dismissed=<data>`, com try/catch); some sozinho 14 dias após a data.
- **Dependência:** a data de deploy precisa existir numa constante (`CALC_FIX_DATE`) definida no momento do deploy; o contrato da API não traz essa data.

### 5.8 Erro de API
- **Sem dados anteriores:** no lugar das seções, `rpt-notice rpt-notice--error` com ícone `error`, "Não foi possível carregar o relatório." + detalhe do servidor quando houver + botão "Tentar novamente". Nada de cartões com zero (hoje um erro renderiza zeros, porque `data` fica `null` e os campos caem em `?? 0` — isso precisa mudar).
- **Com dados anteriores:** mantém o último resultado e mostra o aviso de erro em linha no topo da seção: "Não foi possível atualizar. Exibindo o resultado anterior."
- **400 por período > 180 dias:** erro de campo ao lado do seletor de período, com a mensagem do backend; o `DateRangeCalendar` com `maxDays={180}` já evita o caso no cliente.
- **Sem permissão:** tratado pela rota (`RequirePermission`), nada a desenhar na página.

### 5.9 Outros estados pequenos
- Filtro rápido sem resultado: "Nenhum técnico nesta condição. [Limpar filtro]".
- Busca de atividade sem resultado: "Nenhuma atividade encontrada para "texto". [Limpar busca]".
- Log filtrado vazio: reaproveita `nenhumEventoTipo` existente.
- Hoje sem check-in: KPIs com `—` e "Nenhum técnico com check-in hoje"; "Dia por técnico" vazio com o mesmo texto.

---

## 6. CSS

### 6.1 Reaproveitar (sem mudança ou com modificador)

| Classe existente | Uso na v2 |
|---|---|
| `ops-pool-card`, `ops-card-head`, `ops-card-title`, `ops-card-hint` | Todos os cards (tabelas, improdutivo, dia, log). |
| `stat-grid` | Base dos KPIs; recebe modificador `rpt-kpi-grid` para 6 colunas. |
| `rpt-kpi-card`, `rpt-kpi-top`, `rpt-kpi-label`, `rpt-kpi-value`, `rpt-kpi-hint`, `rpt-kpi-bar`, `rpt-kpi-bar-fill` | Cartões de KPI (sem `rpt-kpi-icon`). |
| `table`, `table-wrap`, `table-empty`, `empty-state` | Tabelas e vazios. |
| `rpt-avatar`, `rpt-tech-cell`, `rpt-site-tag`, `rpt-no-journey` | Coluna Técnico e "Sem jornada". |
| `rpt-util-cell`, `rpt-util-bar`, `rpt-util-fill` | Célula de utilização; cor via modificador de faixa em vez de `style` inline. |
| `reason-bars`, `reason-bar-row`, `reason-bar-label`, `reason-bar-track`, `reason-bar-fill`, `reason-bar-value` | Improdutivo por motivo; `reason-bar-fill` recebe modificador de categoria (hoje é fixo em `--red`). |
| `log-feed`, `log-item`, `log-dot`, `log-time`, `log-text`, `log-filter-row`, `log-filter-chip`, `log-filter-count`, `log-tag`, `log-legend*` | Log do dia. |
| `rpt-today-row`, `rpt-today-header`, `rpt-today-name`, `rpt-today-bar`, `rpt-today-metrics`, `rpt-today-metric*` | Dia por técnico (segmentos passam a usar classes de categoria). |
| `btn btn-outline btn-sm`, `select`, `ops-toolbar`, `badge` | Botões CSV, filtro de site, selos. |
| `Pagination`, `DateRangeCalendar` (`maxDays={180}`), `PageHeader`, `Icon` | Componentes. |

### 6.2 Deixar de usar nesta tela (remover do CSS depois da migração, se não houver outro uso)
`reports-four-grid`, `rpt-compact-card`, `rpt-compact-scroll`, `rpt-ranking`, `rpt-rank-*`, `rpt-improd-alert`, `rpt-time-cell/-bar/-fill`, `rpt-best-badge`, `rpt-kpi-icon`, `log-tag-concluiu/-despacho/-inicio/-status`, `reports-two-col`. Conferir com `grep` antes de apagar.

### 6.3 Novas (prefixo `rpt-`)

| Classe | Função |
|---|---|
| `rpt-section`, `rpt-section-head`, `rpt-section-title`, `rpt-section-scope` | Contêiner das seções Período/Hoje; cabeçalho com título 15px/700, controles e texto de escopo (11px, `--text-muted`). Separação por borda superior 2px `--border` e 24px de margem, sem card. |
| `rpt-period-bar`, `rpt-preset` (+ `.active`) | Seletor de período + atalhos 7/30/90 dias. |
| `rpt-notice`, `rpt-notice--info`, `rpt-notice--error`, `rpt-notice--warning`, `rpt-notice-actions` | Banner de correção, erro de API, avisos de card. Borda esquerda 3px na cor do estado, fundo `-soft`, texto `--text`. |
| `rpt-exceptions`, `rpt-exception`, `rpt-exception--low`, `--suspect`, `--attention`, `rpt-exception-count`, `rpt-exceptions-ok` | Barra "Requer atenção" (botões, altura 36px, foco visível). |
| `rpt-kpi-grid` (6 col), `rpt-kpi-grid--today` (4 col) | Grades de KPI com os breakpoints da §2.2. |
| `rpt-kpi-value--low`, `--attention`, `--suspect`, `--empty` | Cor do valor grande por estado. |
| `rpt-band`, `rpt-band--low`, `--attention`, `--suspect` | Selo de faixa na célula. |
| `rpt-util-fill--low`, `--attention`, `--normal`, `--suspect` | Cor da barra (o `--suspect` com listras). |
| `rpt-cat`, `rpt-cat--external`, `rpt-cat--internal`, `rpt-cat--active`, `rpt-cat--break` | Quadrado de categoria (8px) e cor de segmento/barra. `reason-bar-fill.rpt-cat--external` etc. |
| `rpt-reason-groups`, `rpt-reason-group`, `rpt-reason-group-head`, `rpt-reason-group-total` | Os dois grupos do improdutivo. |
| `rpt-table-dense` | Modificador de `.table`: célula 8px 12px, cabeçalho 9px 12px. |
| `rpt-th-group` | Linha de agrupamento do cabeçalho (Referência de estimativa / Por execução), borda inferior e centralizada. |
| `rpt-th-sort` (+ `aria-sort`) | Botão dentro do `<th>` com ícone `arrow_upward`/`arrow_downward`; foco visível. |
| `rpt-num`, `rpt-num-sub` | Célula numérica à direita; linha secundária 11px `--text-muted` (P25–P75, códigos). |
| `rpt-cell-muted` | Valores informativos de amostra pequena. |
| `rpt-insufficient` | Selo "Dados insuficientes (n=X)" (fundo `--bg`, borda tracejada `--border`, ícone `info`). |
| `rpt-tip`, `rpt-tip-trigger`, `rpt-tip-body` | Tooltip CSS que abre em `:hover` **e** `:focus-within` (funciona por teclado e por toque no tablet). Renderizar o corpo fora de containers com `overflow: hidden` ou usar `position: fixed`, conforme regra de popups do `frontend/CLAUDE.md`. |
| `rpt-total-row` | `<tfoot>` com fundo `--bg`, texto 600, borda superior 2px. |
| `rpt-table-foot` | Rodapé de exclusões (11.5px, `--text-muted`). |
| `rpt-card-tools` | Área de busca/chips/CSV no cabeçalho do card; quebra linha no tablet. |
| `rpt-sticky-col` | Primeira coluna fixa no scroll horizontal (`position: sticky; left: 0; background: var(--white)`), com sombra na borda direita quando há rolagem. |
| `rpt-skeleton`, `rpt-skeleton-row` | Placeholders de carregamento (fundo `--bg`, animação de opacidade; `prefers-reduced-motion` desliga). |
| `rpt-is-refreshing` | Opacidade e bloqueio de clique durante recarga. |
| `rpt-today-grid` | Grade dia por técnico × log (3fr/2fr → 1 coluna ≤ 860). |
| `rpt-logtag-complete`, `-dispatch`, `-start`, `-pause`, `-available`, `-checkin`, `-status` | Tags do log por `type` (verde, azul, teal, âmbar, vermelho, neutro, neutro). |
| `rpt-warn-inline` | Ícone + número para rastreamento < 90% e dias incompletos. |

### 6.4 Ícones (Material Symbols, substituindo emojis)
`warning` (dado suspeito, rastreamento), `error` (utilização baixa, erro de API), `event_busy` (dias incompletos), `info` (tooltips, amostra insuficiente, banner), `download` (CSV), `refresh` (atualizar Hoje), `progress_activity` (recarregando), `arrow_upward`/`arrow_downward` (ordenação), `close` (fechar banner), `today` (cabeçalho Hoje), `search` (busca). Log: `task_alt` concluiu, `send` despacho, `play_arrow` início, `pause` pausa, `hourglass_empty` disponível, `login` check-in, `sync_alt` status. Os cartões de KPI ficam **sem ícone**; ícone só onde indica estado.

---

## 7. Textos i18n novos

Já definidos no briefing (não repetidos): HH, Duração, Bloqueio externo (cliente/site), Ocioso interno, Dado suspeito, Dados insuficientes (n={n}), Taxa de rastreamento, Dias incompletos, HH por unidade, HH por metro, Equipe média, Exportar CSV.

Unidade do HH no en-US: o briefing usa "MH" — manter consistente em todos os rótulos e sufixos de valor (`52,0 HH` / `52.0 MH` / `52,0 HH`).

### 7.1 Estrutura e cabeçalhos

| Chave sugerida | pt-BR | en-US | es-ES |
|---|---|---|---|
| `subtitle` | Utilização, homem-hora e base de estimativa por atividade | Utilization, man-hours and activity estimating baseline | Utilización, horas-hombre y base de estimación por actividad |
| `irParaHoje` | Ir para Hoje | Go to Today | Ir a Hoy |
| `secPeriodo` | Período | Period | Período |
| `escopoPeriodo` | Afeta todos os blocos desta seção. | Applies to every block in this section. | Afecta a todos los bloques de esta sección. |
| `preset7` / `preset30` / `preset90` | 7 dias / 30 dias / 90 dias | 7 days / 30 days / 90 days | 7 días / 30 días / 90 días |
| `secHoje` | Hoje · {data} | Today · {date} | Hoy · {fecha} |
| `escopoHoje` | Não muda com o filtro de período. | Not affected by the period filter. | No cambia con el filtro de período. |
| `atualizar` | Atualizar | Refresh | Actualizar |
| `requerAtencao` | Requer atenção | Needs attention | Requiere atención |
| `semExcecoes` | Nenhuma exceção no período. | No exceptions in the period. | Ninguna excepción en el período. |
| `cardTecnicos` | Técnicos no período | Technicians in the period | Técnicos en el período |
| `cardImprodutivo` | Improdutivo por motivo | Non-productive time by reason | Tiempo improductivo por motivo |
| `cardAtividades` | Produtividade por atividade | Productivity by activity | Productividad por actividad |
| `cardDiaTecnico` | Dia por técnico | Day by technician | Día por técnico |
| `cardLog` | Log do dia | Today's log | Registro del día |

### 7.2 KPIs e dicas

| Chave | pt-BR | en-US | es-ES |
|---|---|---|---|
| `kpiUtilizacao` | Utilização | Utilization | Utilización |
| `hintUtilizacao` | {exec} em execução ÷ {jornada} de jornada | {exec} in progress ÷ {shift} shift | {exec} en ejecución ÷ {jornada} de jornada |
| `kpiHH` | Homem-hora (HH) consumido | Man-hours (MH) consumed | Horas-hombre (HH) consumidas |
| `hintHH` | {n} tarefas rastreadas | {n} tracked tasks | {n} tareas con seguimiento |
| `pctJornada` | {pct} da jornada | {pct} of shift hours | {pct} de la jornada |
| `hintRastreamento` | {a} de {b} com apontamento real | {a} of {b} with actual time logged | {a} de {b} con tiempo real registrado |
| `abaixoMeta90` | Abaixo da meta de 90% | Below the 90% target | Por debajo de la meta del 90% |
| `kpiConcluidas` | Concluídas no período | Completed in the period | Completadas en el período |
| `hintSemApontamento` | {n} sem apontamento (fora do HH) | {n} without time logged (excluded from MH) | {n} sin registro de tiempo (fuera de HH) |
| `kpiCheckin` | Técnicos com check-in | Technicians checked in | Técnicos con check-in |
| `kpiProdMedio` | Produtivo médio por técnico | Avg productive time per technician | Productivo medio por técnico |
| `deMeta` | {h} de {meta} | {h} of {target} | {h} de {meta} |
| `pctMeta` | {pct}% da meta | {pct}% of target | {pct}% de la meta |
| `semDadosPeriodo` | Sem dados no período | No data in the period | Sin datos en el período |
| `semCheckinPeriodo` | Sem check-in no período | No check-in in the period | Sin check-in en el período |
| `nenhumaConcluida` | Nenhuma tarefa concluída no período | No tasks completed in the period | Ninguna tarea completada en el período |
| `nenhumCheckinHoje` | Nenhum técnico com check-in hoje | No technician checked in today | Ningún técnico con check-in hoy |

### 7.3 Faixas, exceções e categorias

| Chave | pt-BR | en-US | es-ES |
|---|---|---|---|
| `faixaBaixa` | Baixa | Low | Baja |
| `faixaAtencao` | Atenção | Attention | Atención |
| `faixaNormal` | Normal | Normal | Normal |
| `excUtilBaixa` | Utilização baixa (< 50%) | Low utilization (< 50%) | Utilización baja (< 50%) |
| `excSuspeito` | Dado suspeito (> 100%) | Suspicious data (> 100%) | Dato sospechoso (> 100%) |
| `excIncompletos` | {n} técnicos com dias incompletos ({d}) | {n} technicians with incomplete days ({d}) | {n} técnicos con días incompletos ({d}) |
| `excRastreamento` | Rastreamento {pct} · {n} técnicos < 90% | Tracking {pct} · {n} technicians < 90% | Seguimiento {pct} · {n} técnicos < 90% |
| `filtroTodos` | Todos | All | Todos |
| `filtroAtivo` | {a} de {b} técnicos · filtro: {f} | {a} of {b} technicians · filter: {f} | {a} de {b} técnicos · filtro: {f} |
| `limparFiltro` | Limpar filtro | Clear filter | Quitar filtro |
| `nenhumTecnicoFiltro` | Nenhum técnico nesta condição. | No technician matches this condition. | Ningún técnico en esta condición. |
| `descExterno` | Evidência para o cliente | Evidence for the client | Evidencia para el cliente |
| `descInterno` | Falha de despacho/planejamento | Dispatch/planning gap | Falla de despacho/planificación |
| `intervalosNeutros` | Almoço e pausas pessoais não entram. | Lunch and personal breaks are not counted. | El almuerzo y las pausas personales no se cuentan. |
| `segExecucao` | Execução | In progress | En ejecución |
| `segIntervalos` | Intervalos | Breaks | Pausas |
| `ordemOcioso` | Mais ocioso primeiro | Most idle first | Más inactivo primero |

### 7.4 Tabela de técnicos

| Chave | pt-BR | en-US | es-ES |
|---|---|---|---|
| `thHorasExec` | Horas em execução | Hours in progress | Horas en ejecución |
| `thHH` | HH | MH | HH |
| `thRastreamento` | Rastreamento | Tracking | Seguimiento |
| `thDiasIncompletos` | Dias incompletos | Incomplete days | Días incompletos |
| `semApontAbrev` | {n} s/a | {n} untracked | {n} s/r |
| `semApontTip` | {n} sem apontamento real — fora do HH | {n} without actual time — excluded from MH | {n} sin tiempo real — fuera de HH |
| `total` | Total ({n}) | Total ({n}) | Total ({n}) |
| `ordemExcecoes` | Exceções primeiro | Exceptions first | Excepciones primero |
| `tipUtilizacao` | Horas em execução ÷ jornada (8 h por dia com check-in). Acima de 100% indica apontamento a revisar. | Hours in progress ÷ shift (8 h per checked-in day). Above 100% means time logs need review. | Horas en ejecución ÷ jornada (8 h por día con check-in). Más de 100% indica registros a revisar. |
| `tipHorasExec` | Tempo em Em Execução, contado uma vez mesmo com tarefas paralelas. Já desconta pausas. | Time in In Progress status, counted once even with parallel tasks. Pauses excluded. | Tiempo en estado En ejecución, contado una vez aun con tareas paralelas. Sin pausas. |
| `tipJornada` | 8 h por dia com check-in. | 8 h per checked-in day. | 8 h por día con check-in. |
| `tipHH` | Homem-hora: soma das horas reais deste técnico nas tarefas concluídas. Base de faturamento. | Man-hours: sum of this technician's actual hours on completed tasks. Billing basis. | Horas-hombre: suma de las horas reales de este técnico en tareas completadas. Base de facturación. |
| `tipExterno` | Sem Acesso ao Site + Aguardando Liberações. | No Site Access + Awaiting Clearance. | Sin acceso al sitio + Esperando liberaciones. |
| `tipInterno` | Disponível sem tarefa. | Available without a task. | Disponible sin tarea. |
| `tipRastreamento` | Concluídas com apontamento real ÷ concluídas. Meta: 90%. | Completed with actual time ÷ completed. Target: 90%. | Completadas con tiempo real ÷ completadas. Meta: 90%. |
| `tipIncompletos` | Dias sem Fim de Expediente. O tempo foi cortado em check-in + 9 h. | Days without End of Shift. Time was capped at check-in + 9 h. | Días sin Fin de jornada. El tiempo se cortó en check-in + 9 h. |

> Os rótulos de status em `tipExterno` (en/es) devem usar a tradução que já existe para `site_blocked` / `awaiting_release` no i18n do sistema, se houver; os textos acima são provisórios.

### 7.5 Tabela de atividades

| Chave | pt-BR | en-US | es-ES |
|---|---|---|---|
| `thFamiliaCabo` | Família de cabo | Cable family | Familia de cable |
| `thUnidade` | Un. | Unit | Ud. |
| `thExecucoesUsadas` | Execuções (usadas / total) | Runs (used / total) | Ejecuciones (usadas / total) |
| `thGrupoReferencia` | Referência de estimativa | Estimating baseline | Referencia de estimación |
| `thGrupoExecucao` | Por execução (mediana) | Per run (median) | Por ejecución (mediana) |
| `thDuracaoRelogio` | Duração | Duration | Duración |
| `tipDuracao` | Tempo de relógio do início ao fim, sem pausas. Não usar para faturar. | Clock time from start to finish, excluding pauses. Not for billing. | Tiempo de reloj del inicio al fin, sin pausas. No usar para facturar. |
| `tipHHUnidade` | Mediana de HH ÷ quantidade em cada execução. Metade das execuções ficou entre P25 e P75. | Median of MH ÷ quantity per run. Half of the runs fall between P25 and P75. | Mediana de HH ÷ cantidad por ejecución. La mitad de las ejecuciones está entre P25 y P75. |
| `faixaP25P75` | P25–P75 {a}–{b} | P25–P75 {a}–{b} | P25–P75 {a}–{b} |
| `semComprimento` | Item sem comprimento cadastrado | Item has no length registered | Ítem sin longitud registrada |
| `exUsadas` | Usadas na referência | Used in baseline | Usadas en la referencia |
| `exExcluidas` | Excluídas | Excluded | Excluidas |
| `exSemApontamento` | Sem apontamento real | No actual time logged | Sin tiempo real registrado |
| `exParcialBloqueada` | Parcial ou bloqueada | Partial or blocked | Parcial o bloqueada |
| `exSemQuantidade` | Sem quantidade | No quantity | Sin cantidad |
| `quantidadeTotal` | Quantidade total | Total quantity | Cantidad total |
| `amostraPequenaTip` | Amostra pequena — informativo, não usar para orçar. | Small sample — informational only, do not use for quoting. | Muestra pequeña — solo informativo, no usar para presupuestar. |
| `soAmostraSuficiente` | Só amostra suficiente (n ≥ 5) | Sufficient sample only (n ≥ 5) | Solo muestra suficiente (n ≥ 5) |
| `buscarAtividade` | Buscar atividade ou cabo… | Search activity or cable… | Buscar actividad o cable… |
| `nCombinacoes` | {n} combinações · {s} com amostra suficiente | {n} combinations · {s} with sufficient sample | {n} combinaciones · {s} con muestra suficiente |
| `rodapeExclusoes` | Exclusões nas linhas: {a} sem apontamento real · {b} parciais ou bloqueadas · {c} sem quantidade | Excluded within rows: {a} without actual time · {b} partial or blocked · {c} without quantity | Excluidas en las filas: {a} sin tiempo real · {b} parciales o bloqueadas · {c} sin cantidad |
| `rodapeSemCatalogo` | Fora da tabela: {n} tarefas concluídas sem vínculo ao catálogo mestre (tarefas manuais). | Not in table: {n} completed tasks not linked to the master catalog (manual tasks). | Fuera de la tabla: {n} tareas completadas sin vínculo al catálogo maestro (tareas manuales). |
| `nenhumaSuficiente` | Nenhuma combinação atingiu 5 execuções válidas no período. Amplie o período ou gere tarefas pelo catálogo mestre. | No combination reached 5 valid runs in the period. Widen the period or generate tasks from the master catalog. | Ninguna combinación alcanzó 5 ejecuciones válidas en el período. Amplíe el período o genere tareas desde el catálogo maestro. |
| `nenhumaAtividadeBusca` | Nenhuma atividade encontrada para "{q}". | No activity found for "{q}". | Ninguna actividad encontrada para "{q}". |
| `limparBusca` | Limpar busca | Clear search | Borrar búsqueda |
| `colAmostraSuficiente` (CSV) | Amostra suficiente | Sufficient sample | Muestra suficiente |

### 7.6 Log (por `type`)

| `type` | pt-BR | en-US | es-ES |
|---|---|---|---|
| `complete` | Concluiu | Completed | Completó |
| `dispatch` | Despacho | Dispatch | Despacho |
| `start` | Início | Started | Inicio |
| `pause` | Pausa | Paused | Pausa |
| `available` | Disponível | Available | Disponible |
| `checkin` | Check-in | Check-in | Check-in |
| `status` | Status | Status | Estado |

### 7.7 Estados e banner

| Chave | pt-BR | en-US | es-ES |
|---|---|---|---|
| `carregandoRelatorio` | Carregando relatório… | Loading report… | Cargando informe… |
| `atualizando` | Atualizando… | Updating… | Actualizando… |
| `nenhumaAtividadeNoPeriodo` | Nenhuma atividade no período selecionado. | No activity in the selected period. | Ninguna actividad en el período seleccionado. |
| `ampliar90` | Ampliar para 90 dias | Widen to 90 days | Ampliar a 90 días |
| `semExcecoesAvaliar` | Sem dados para avaliar exceções neste período. | No data to evaluate exceptions in this period. | Sin datos para evaluar excepciones en este período. |
| `semImprodutivo` | Nenhum tempo improdutivo registrado no período. | No non-productive time recorded in the period. | Ningún tiempo improductivo registrado en el período. |
| `erroCarregar` | Não foi possível carregar o relatório. | Could not load the report. | No fue posible cargar el informe. |
| `erroAtualizar` | Não foi possível atualizar. Exibindo o resultado anterior. | Could not refresh. Showing the previous result. | No fue posible actualizar. Mostrando el resultado anterior. |
| `tentarNovamente` | Tentar novamente | Try again | Reintentar |
| `bannerCorrecao` | Cálculo corrigido em {data}. A utilização agora desconta pausas, o HH soma as horas de cada técnico e o tempo por atividade usa o catálogo mestre. | Calculation corrected on {date}. Utilization now excludes pauses, MH sums each technician's hours and activity time uses the master catalog. | Cálculo corregido el {fecha}. La utilización ahora descuenta pausas, las HH suman las horas de cada técnico y el tiempo por actividad usa el catálogo maestro. |
| `verOQueMudou` | Ver o que mudou | See what changed | Ver qué cambió |
| `mudouPausas` | Pausas não contam mais como horas trabalhadas. | Pauses no longer count as worked hours. | Las pausas ya no cuentan como horas trabajadas. |
| `mudouHH` | HH é a soma das horas reais de cada técnico, não duração × equipe. | MH is the sum of each technician's actual hours, not duration × crew. | HH es la suma de las horas reales de cada técnico, no duración × equipo. |
| `mudouFimExpediente` | Dia sem Fim de Expediente é cortado em check-in + 9 h e marcado como incompleto. | Days without End of Shift are capped at check-in + 9 h and flagged as incomplete. | Los días sin Fin de jornada se cortan en check-in + 9 h y se marcan como incompletos. |
| `mudouCatalogo` | Tempo por atividade agrupa por atividade do catálogo × família de cabo. | Activity time is grouped by catalog activity × cable family. | El tiempo por actividad se agrupa por actividad del catálogo × familia de cable. |
| `fechar` | Fechar | Close | Cerrar |

---

## 8. Dependências e pontos em aberto

1. **Data do banner** (`CALC_FIX_DATE`) — constante definida no deploy; não vem da API.
2. **RN-10 no seletor de período:** `DateRangeCalendar` e `OperationsReports.tsx` usam `toISOString()` para datas (`toIso`, `todayISO`, `daysAgoISO`). Precisam passar a usar a data local; senão o critério 9 falha às 21h+ em Brasília. Afeta também `DailyUpdates` e `ProjectUpdates`, que usam o mesmo componente.
3. **Rótulo traduzido de unidade** (cabo/porta/link): depende de existir mapeamento de `unit` no i18n; sem ele, mostrar o código cru.
4. **Ordem Hoje × Período:** proposta segue o briefing (Período primeiro). Validar com coordenadores.
5. **Limiares:** o alerta "> 40h improdutivas" foi removido. **Ocioso interno: limite aprovado de 30 min por técnico por dia (RN-26)** — ver §4.2.
6. **Fase 2** (projetos HH × orçado, lista de exceções expandida, tendência diária) fica fora deste layout; os lugares estão indicados na §1.

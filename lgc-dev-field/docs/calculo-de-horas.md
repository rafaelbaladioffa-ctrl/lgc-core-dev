# Cálculo de Horas — Mapeamento Completo

> Como o sistema computa horas em cada contexto: projetos, dashboard e relatórios.
> Última revisão: setembro/2026.

---

## 1. Fonte de dados — campos em `ProjectTask`

Todo cálculo de horas parte de três campos no modelo `ProjectTask`:

| Campo | Tipo | Quando é preenchido |
|-------|------|---------------------|
| `actual_hours` | `DecimalField` | Calculado automaticamente pelo `save()` ao setar `actual_end` |
| `actual_start` / `actual_end` | `DateTimeField` | Registrados quando o técnico inicia e conclui a tarefa |
| `planned_start` / `planned_end` | `DateTimeField` | Definidos no planejamento — usados como fallback |
| `paused_seconds` | `FloatField` | Acumulado a cada vez que a tarefa é pausada e retomada |

### Como `actual_hours` é calculado (`projects/models.py:349`)

```python
# dentro de ProjectTask.save()
if self.actual_start and self.actual_end and self.actual_hours is None:
    total_seconds = (self.actual_end - self.actual_start).total_seconds()
    total_seconds -= self.paused_seconds or 0
    if self.paused_at:
        total_seconds -= (now - self.paused_at).total_seconds()
    self.actual_hours = round(max(total_seconds, 0) / 3600, 2)
```

O cálculo desconta automaticamente todo o tempo em que a tarefa ficou pausada.

---

## 2. Propriedade `worked_hours` — porta de entrada de todos os cálculos

**Arquivo:** `projects/models.py:371`

```python
@property
def worked_hours(self):
    # 1. Prioridade: dado real apontado
    if self.actual_hours is not None:
        return float(self.actual_hours)
    # 2. Fallback: duração planejada (tarefa concluída sem apontamento)
    if self.status == self.STATUS_COMPLETED and self.planned_start and self.planned_end:
        return round(max((self.planned_end - self.planned_start).total_seconds(), 0) / 3600, 2)
    # 3. Sem dado disponível
    return 0.0
```

### Implicação do fallback

Tarefas concluídas sem `actual_hours` usam a duração planejada como estimativa. Se o planejamento previu vários dias e a tarefa foi concluída sem apontamento real, `worked_hours` devolve a duração planejada inteira — que pode ser muito maior do que o tempo efetivo trabalhado. Esse é o principal risco de imprecisão do sistema hoje.

---

## 3. Utilitário `merged_worked_hours(tasks)` — evita dupla contagem

**Arquivo:** `projects/models.py:413`

Recebe uma lista de tarefas e retorna o total de horas sem contar duas vezes o tempo em que houve sobreposição (ex.: técnico com duas tarefas iniciadas simultaneamente na mesma janela de tempo).

```python
def merged_worked_hours(tasks):
    intervals = []
    flat_hours = 0.0
    for task in tasks:
        if task.actual_start and task.actual_end:
            intervals.append((task.actual_start, task.actual_end))
        else:
            flat_hours += task.worked_hours  # sem timestamp: soma direto

    # Merge de intervalos sobrepostos
    intervals.sort(key=lambda i: i[0])
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    merged_seconds = sum((end - start).total_seconds() for start, end in merged)
    return round(merged_seconds / 3600 + flat_hours, 2)
```

**Limitação:** tarefas sem `actual_start`/`actual_end` entram como `flat_hours` — não é possível detectar sobreposição nelas.

---

## 4. Regra de negócio acordada — co-atribuição e tarefas paralelas

| Cenário | Comportamento correto |
|---------|----------------------|
| 4 técnicos × 1h numa tarefa | Cada técnico trabalhou **1h** no relógio. Para utilização individual: 1h cada. Para esforço total da atividade: **4 man-hours**. |
| 1 técnico, 4 atividades sequenciais de 1h | Técnico: **4h**. Projeto: **4h**. Cada atividade: **1h**. |
| 1 técnico, tarefas sobrepostas no mesmo período | Intervalos são mergeados — técnico conta o período efetivo, não N × período. |

---

## 5. Pontos de cálculo — mapeamento por contexto

### 5.1 Detalhe do Projeto (API)

**Arquivo:** `backend/api/serializers.py:1489`  
**Serializer:** `ProjectSerializer`

```python
def get_worked_hours(self, obj):
    return merged_worked_hours(self._tasks(obj))
    # _tasks = list(obj.project_tasks.all())
```

- **Escopo:** todas as tarefas do projeto (qualquer status)
- **Merge:** ✅ via `merged_worked_hours()`
- **Exibido em:** card de resumo do projeto na listagem e no detalhe

---

### 5.2 Horas por Técnico (aba Horas dentro do Projeto)

**Arquivo:** `backend/api/views.py:460`  
**Action:** `ProjectViewSet.hours_by_collaborator`

```python
"hours": merged_worked_hours(collaborator_tasks)
```

- **Escopo:** todas as tarefas do técnico no projeto (qualquer status)
- **Merge:** ✅ via `merged_worked_hours()`
- **Exibido em:** aba "Horas" dentro do detalhe do projeto

---

### 5.3 Tarefa individual (serializer de tarefa)

**Arquivo:** `backend/api/serializers.py:1612`  
**Serializer:** `ProjectTaskSerializer`

```python
def get_worked_hours(self, obj):
    return obj.worked_hours  # propriedade da tarefa
```

- **Escopo:** tarefa única
- **Merge:** — (não se aplica, é uma tarefa só)
- **Exibido em:** lista de tarefas, detalhe da tarefa, pool de despacho

---

### 5.4 Dashboard — Performance de Projetos

**Arquivo:** `backend/projects/analytics.py:51`  
**Função:** `build_projects_performance()`

```python
worked_hours = sum(t.worked_hours for t in tasks)
```

- **Escopo:** todas as tarefas do projeto (qualquer status)
- **Merge:** ❌ soma flat — não mergeia intervalos sobrepostos
- **Exibido em:** Dashboard > Performance de Projetos (card total de horas, ranking de projetos por horas)
- **⚠ Risco:** se o projeto tiver tarefas paralelas com `actual_start`/`actual_end` sobrepostos, esse total pode superestimar as horas reais.

---

### 5.5 Dashboard — Performance Técnica

**Arquivo:** `backend/projects/analytics.py:139`  
**Função:** `build_technical_performance()`

```python
# Separa tarefas com timestamp das sem timestamp
for task in completed_tasks:
    if task.actual_start and task.actual_end:
        intervals.append((task.actual_start, task.actual_end))
    else:
        flat_hours += task.worked_hours

# Merge manual dos intervalos
intervals.sort(key=lambda iv: iv[0])
merged_intervals = []
for start, end in intervals:
    if merged_intervals and start <= merged_intervals[-1][1]:
        merged_intervals[-1] = (merged_intervals[-1][0], max(merged_intervals[-1][1], end))
    else:
        merged_intervals.append((start, end))

hours_worked = round(interval_hours + flat_hours, 2)
```

- **Escopo:** somente tarefas **concluídas**, filtradas por `actual_end` no período
- **Merge:** ✅ merge manual de intervalos por técnico
- **Exibido em:** Dashboard > Performance Técnica (ranking de técnicos por horas, total geral)

---

### 5.6 Relatório de Utilização (Central de Operações)

**Arquivo:** `backend/api/operations.py`  
**View:** `OperationsReportsView`

#### Fase 1 — coleta por técnico

```python
for task in tasks_qs:
    hours = task.worked_hours
    task_assignments = list(task.assignments.all())
    num_assignees = len(task_assignments) or 1
    for assignment in task_assignments:
        if task.actual_start and task.actual_end:
            entry["intervals"].append((task.actual_start, task.actual_end))
        else:
            entry["flat_hours"] += hours  # cada técnico conta suas horas no relógio
        entry["completed_count"] += 1
```

#### Fase 2 — merge por técnico

```python
for coll_id, data in tech_data.items():
    # merge de intervalos sobrepostos do mesmo técnico
    interval_hours = ...  # soma das durações mergeadas
    tech_stats[coll_id]["worked_hours"] = round(interval_hours + data["flat_hours"], 2)
```

#### Cálculo de utilização %

```python
journey = dias_com_checkin × STANDARD_WORKDAY_HOURS  # 8h/dia
utilization_pct = round((worked_hours / journey) * 100)
```

- **Escopo:** tarefas **concluídas** com `actual_end` dentro do período selecionado
- **Merge:** ✅ intervalos mergeados por técnico
- **Jornada:** dias com check-in × 8h (não duração real entre check-in e check-out)
- **Exibido em:** Relatórios > Ranking de Utilização — Período

---

### 5.7 Tempo por Tipo de Atividade (Central de Operações)

**Arquivo:** `backend/api/operations.py`  
**View:** `OperationsReportsView` (mesmo endpoint do 5.6)

```python
if task.origin != ProjectTask.ORIGIN_SOW_TEMPLATE:
    continue  # somente tarefas geradas pelo cadastro mestre
key = task.custom_name or task.display_name
activity["hours"].append(hours * num_assignees)  # man-hours totais
```

Ao calcular médias e melhor tempo:

```python
"avg_hours": round(sum(hrs) / len(hrs), 2),
"best_hours": round(min(hrs), 2)
```

- **Escopo:** tarefas **concluídas**, apenas com `origin = SOW_TEMPLATE`
- **Unidade:** **man-hours** (`worked_hours × número de técnicos atribuídos`) — representa o esforço total investido na atividade, independente de quantos técnicos a executaram em paralelo
- **Exibido em:** Relatórios > Tempo por Tipo de Atividade — Histórico

---

### 5.8 Django Admin — Detalhe do Projeto

**Arquivo:** `backend/projects/admin.py:766`

```python
worked_seconds = sum(project_task.worked_hours for project_task in tasks) * 3600
```

- **Escopo:** todas as tarefas do projeto (qualquer status)
- **Merge:** ❌ soma flat — não mergeia intervalos sobrepostos
- **Exibido em:** tela de detalhe do projeto no Django Admin
- **⚠ Risco:** mesmo risco do 5.4 — pode superestimar se houver tarefas paralelas

---

## 6. Tabela consolidada

| # | Onde aparece | Arquivo | Método | Merge? | Escopo de tarefas |
|---|-------------|---------|--------|--------|-------------------|
| 5.1 | Detalhe do projeto (API) | `serializers.py:1489` | `merged_worked_hours()` | ✅ | Todas |
| 5.2 | Horas por técnico (aba) | `views.py:460` | `merged_worked_hours()` | ✅ | Todas do técnico |
| 5.3 | Tarefa individual | `serializers.py:1612` | `task.worked_hours` | — | Uma tarefa |
| 5.4 | Dashboard — Perf. Projetos | `analytics.py:51` | `sum(t.worked_hours)` | ❌ | Todas |
| 5.5 | Dashboard — Perf. Técnica | `analytics.py:139` | merge manual | ✅ | Concluídas no período |
| 5.6 | Relatório Utilização | `operations.py` | merge manual | ✅ | Concluídas com `actual_end` no período |
| 5.7 | Tempo por Atividade | `operations.py` | `hours × num_assignees` | — | Concluídas, origin=SOW |
| 5.8 | Admin — Detalhe projeto | `admin.py:766` | `sum(t.worked_hours)` | ❌ | Todas |

---

## 7. Inconsistências e pontos de atenção

### 7.1 Dois pontos sem merge de intervalos (5.4 e 5.8)

`build_projects_performance()` e o admin de detalhe somam `worked_hours` flat. Se um projeto tiver tarefas com `actual_start`/`actual_end` sobrepostos (dois técnicos trabalhando em paralelo na mesma janela de tempo), esses dois pontos somam as duas durações separadamente — o total pode ser maior que o tempo real de obra.

**Impacto prático:** baixo enquanto a maioria das tarefas não tiver timestamps reais (cai no fallback de planejado, que já é flat por natureza). Aumenta conforme o sistema passa a registrar `actual_start`/`actual_end` com frequência.

**Correção possível:** substituir `sum(t.worked_hours)` por `merged_worked_hours(tasks)` nesses dois pontos.

### 7.2 Fallback para duração planejada

Tarefas concluídas sem `actual_hours` usam `(planned_end - planned_start)`. Se o planejamento previu prazos longos (ex.: 5 dias), a tarefa aparece com 120h de duração mesmo que tenha sido executada em 4h. Esse dado nunca é recalculado retroativamente.

**Como mitigar:** garantir que `actual_end` seja sempre setado ao concluir uma tarefa (o sistema já faz isso via `save()` — desde que o técnico marque a conclusão pelo fluxo normal, e não por atualização direta no admin).

### 7.3 `flat_hours` sem merge nas duas fases de merge manual

Tarefas sem `actual_start`/`actual_end` que entram como `flat_hours` não passam pelo merge. Mesmo que duas dessas tarefas tenham sido executadas simultaneamente, as horas são somadas. Não há como detectar sobreposição sem os timestamps reais.

### 7.4 Tempo por Atividade — filtro por `origin`

Apenas tarefas com `origin = SOW_TEMPLATE` (geradas pelo cadastro mestre / importação de escopo) aparecem no Tempo por Tipo de Atividade. Tarefas manuais e de catálogo genérico são excluídas intencionalmente — o nome delas não é padronizado o suficiente para agrupar com segurança.

---

## 8. Fluxo completo de uma tarefa com apontamento real

```
Técnico inicia tarefa
    → actual_start = now
    → status = IN_PROGRESS

Técnico pausa (opcional)
    → paused_at = now
    → status = PAUSED

Técnico retoma
    → paused_seconds += (now - paused_at)
    → paused_at = None
    → status = IN_PROGRESS

Técnico conclui
    → actual_end = now
    → status = COMPLETED
    → save() calcula:
        actual_hours = (actual_end - actual_start - paused_seconds) / 3600

A partir daí:
    worked_hours → retorna actual_hours  ✔ dado real
    merged_worked_hours([task]) → usa intervalo [actual_start, actual_end]  ✔
    Relatório Utilização → soma merged, divide por journey_hours  ✔
    Tempo por Atividade → actual_hours × num_assignees = man-hours  ✔
```

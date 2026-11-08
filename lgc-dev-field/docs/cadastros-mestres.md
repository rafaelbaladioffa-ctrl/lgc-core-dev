# Cadastros Mestres — Documentação Técnica

> Módulo de catálogo mestre do ERP CSTR. Centraliza os dados de engenharia, operação e infraestrutura que alimentam o motor de geração automática de tarefas (SOW → ScopeItem → GeneratedTask).

---

## Visão Geral

O módulo **`master_data`** é a espinha dorsal técnica do ERP: mantém os catálogos normalizados de cabos, redes, templates de tarefa e itens de escopo que transformam um texto de SOW em tarefas executáveis por técnicos.

### Fluxo principal

```
SOW (texto/arquivo)
       │
       ▼
   SowImport
       │  parser determinístico → IA opcional → merge → warnings
       ▼
  SowParsedItem          ← prévia editável por humano
       │  aprovação manual
       ▼
   ScopeItem             ← item definitivo de escopo (código AUTO-XXXXXX)
       │  TaskRuleResolver (motor de regras)
       ▼
  TaskTemplateRule       ← regra ativa de maior especificidade
       │
       ▼
  TaskTemplate + TaskTemplateSteps
       │  task_generator.py
       ▼
  GeneratedTask[]        ← tarefas prontas para execução (código TASK-XXXXXX)
```

---

## Base Abstrata

### `MasterDataModel` (abstrata)

Herda de `TimestampedModel` (`created_at`, `updated_at`). Acrescenta:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `created_by` | FK → `CustomUser` (nullable) | Usuário que criou o registro |
| `updated_by` | FK → `CustomUser` (nullable) | Usuário da última edição |

Todos os modelos do módulo herdam de `MasterDataModel` (exceto modelos de sequência e `SowParsedItem`, que herda direto de `TimestampedModel`).

---

## Função `normalize_alias_text(text)`

Normalização canônica de aliases técnicos. Regras:

1. Strip de espaços nas bordas
2. Colapsa espaços múltiplos em um único
3. Converte para maiúsculas
4. Converte variantes de traço (`–`, `—`, `−`, `‑`, `‐`) para hífen ASCII `-`
5. Remove espaços ao redor de `-`, `/`, `<`, `>`

**Exemplos:**
- `" robust  2f "` → `"ROBUST 2F"`
- `"cat6a – 4p"` → `"CAT6A-4P"`
- `"fibra/om4"` → `"FIBRA/OM4"`

---

## Categorias de Navegação (Frontend)

O frontend organiza as entidades em 4 categorias no menu lateral:

| Categoria | Entidades |
|-----------|-----------|
| **Engenharia** | Família de Cabos, Especificações de Cabo, Tipo de Certificação, Atividade |
| **Operação** | Rede, Workstream, Caminho, Template de Tarefa, Regra de Template, Item de Escopo, **Simulador de Regras** (tool) |
| **Infraestrutura** | Site, Localização, Tipo de Dispositivo |
| **Planejamento** | Importação de SOW, Tarefa Gerada, **Importar SOW** (tool), **Plano de Projeto** (tool) |

---

## Módulo Engenharia

### `CableFamily` — Família de Cabos

| Campo | Tipo | Obs |
|-------|------|-----|
| `code` | CharField(30) | Único, uppercase |
| `name` | CharField(100) | |
| `description` | TextField | |
| `is_active` | BooleanField | |

### `CableAlias` — Alias de Cabo

Sinônimos normalizados para `CableFamily`. Permite que "Robust 2F", "ROBUST2F" e "ROBUST 2F" resolvam para a mesma família durante o parse de SOW.

| Campo | Tipo | Obs |
|-------|------|-----|
| `family` | FK → `CableFamily` (CASCADE) | |
| `alias` | CharField(100) | Texto original (editável) |
| `normalized_alias` | CharField(100) | Gerado por `normalize_alias_text()` no `save()` |

**Validação em `clean()`:** impede dois aliases com o mesmo `normalized_alias` na mesma família.  
**Validação em `save()`:** chama `normalize_alias_text(self.alias)` antes de gravar.

### `CableSpec` — Especificação de Cabo

Cabo físico específico (part number único).

| Campo | Tipo | Obs |
|-------|------|-----|
| `family` | FK → `CableFamily` (PROTECT) | |
| `code` | CharField(50) | Único |
| `part_number` | CharField(100) | Único, pode ser vazio (blank) |
| `description` | CharField(200) | |
| `medium` | CharField(20) | choices: `FIBER`, `COPPER`, `DAC`, `AOC`, `OTHER` |
| `fiber_count` | IntegerField | Nullable |
| `preterminated` | BooleanField | Default False |
| `connector_a` / `connector_b` | CharField(30) | Nullable |
| `length_type` | CharField(20) | choices: `CUT`, `FIXED`, `PREFAB` |
| `default_length_m` | DecimalField | Nullable |
| `color` | CharField(30) | |

**Validação em `clean()`:**
- `part_number` não pode conflitar com outro `CableSpec` existente
- Se `family` tem aliases, verifica se algum alias normalizado conflita com o `code` desta spec

### `CertificationType` — Tipo de Certificação

Catálogo simples: `code`, `name`, `description`, `standard` (ex: "TIA-568-C.2"), `is_active`.

### `Activity` — Tipo de Atividade de Campo

| Campo | Tipo | Obs |
|-------|------|-----|
| `code` | CharField(30) | Único |
| `name` | CharField(100) | |
| `description` | TextField | |
| `default_unit` | CharField(20) | Sugerido nas tarefas geradas |
| `is_active` | BooleanField | |

---

## Módulo Operação

### `Network` — Rede

`code`, `name`, `description`, `is_active`. Ex: "LAN", "SAN", "OOB".

### `Workstream` — Workstream

`code`, `name`, `description`, `is_active`. Ex: "DATA", "STORAGE", "MGMT".

### `Path` — Caminho

`code`, `name`, `description`, `is_active`. Representa rotas físicas predefinidas em planta.

### `TaskTemplate` — Template de Tarefa

| Campo | Tipo | Obs |
|-------|------|-----|
| `code` | CharField(30) | Único |
| `name` | CharField(150) | |
| `activity` | FK → `Activity` (PROTECT) | |
| `description` | TextField | |
| `default_unit` | CharField(20) | |
| `is_active` | BooleanField | |

### `TaskTemplateStep` — Etapa do Template

Cada template tem uma lista ordenada de etapas:

| Campo | Tipo | Obs |
|-------|------|-----|
| `template` | FK → `TaskTemplate` (CASCADE) | |
| `sequence` | IntegerField | Ordem da etapa |
| `name` | CharField(150) | |
| `description` | TextField | |
| `repeatable` | BooleanField | Se True → gera uma `GeneratedTask` por `ScopeItemPath` ativo (modo PATH) |
| `estimated_hours` | DecimalField | Nullable |
| `certification_type` | FK → `CertificationType` (nullable, PROTECT) | |

### `TaskTemplateRule` — Regra de Template

Motor de matching entre características de um `ScopeItem` e um `TaskTemplate`.

| Campo | Tipo | Obs |
|-------|------|-----|
| `template` | FK → `TaskTemplate` (CASCADE) | |
| `cable_family` | FK → `CableFamily` (nullable, PROTECT) | Critério opcional |
| `cable_spec` | FK → `CableSpec` (nullable, PROTECT) | Critério opcional |
| `network` | FK → `Network` (nullable, PROTECT) | Critério opcional |
| `workstream` | FK → `Workstream` (nullable, PROTECT) | Critério opcional |
| `medium` | CharField(20) | Critério textual opcional |
| `preterminated` | NullBooleanField | Tri-state: True/False/None (ignorado) |
| `priority` | IntegerField | Desempate quando dois matches têm mesmo `specificity_score` |

**Propriedade `specificity_score`:** conta quantos campos opcionais estão preenchidos (0–6). Regra mais específica sempre vence.

**Validação em `clean()`:**
- `cable_spec` deve pertencer à `cable_family` informada (se ambos preenchidos)
- Detecta regra duplicada: mesma combinação de critérios já existe para o mesmo template

#### `Simulador de Regras` (ToolConfig)

Não é uma entidade CRUD — é uma tela interativa onde o usuário seleciona `cable_family`, `cable_spec`, `network`, `workstream`, `medium`, `preterminated` e visualiza qual `TaskTemplateRule` seria ativada e quais tarefas seriam geradas. Implementado como `kind: "tool"` no `masterDataConfig.ts` e consumido pelo endpoint `TaskTemplateRuleViewSet.simulate`.

O `task_rule_resolver.py` (serviço isolado, read-only) nunca cria registros — só recebe instâncias de model e devolve resultado JSON.

---

## Módulo Infraestrutura

### `Site` (master_data) — Site Mestre

Diferente do `Site` do app `core`: este tem campos de endereçamento completo para o catálogo mestre.

| Campo | Tipo |
|-------|------|
| `code` | CharField(20), único |
| `name` | CharField(150) |
| `country` / `state` / `city` | CharField |
| `address` | CharField(300) |
| `is_active` | BooleanField |

### `Location` — Localização

Sub-localização dentro de um `Site` (sala, andar, corredor, rack).

| Campo | Tipo | Obs |
|-------|------|-----|
| `site` | FK → `Site` (master_data, CASCADE) | |
| `code` | CharField(30) | |
| `name` | CharField(150) | |
| `location_type` | CharField(20) | choices: ROOM, FLOOR, CORRIDOR, RACK, OTHER |
| `parent` | FK → `Location` (self, nullable, CASCADE) | Hierarquia |
| `address_detail` | CharField(200) | |

**Validação em `clean()`:** `parent` deve pertencer ao mesmo `Site` que `self` (previne cross-site).

### `DeviceType` — Tipo de Dispositivo

Catálogo de tipos de equipamento: `code`, `name`, `description`, `is_active`.

---

## Módulo Planejamento

### `ScopeItem` — Item de Escopo

Unidade atômica de escopo que mapeia para um template de tarefa.

| Campo | Tipo | Obs |
|-------|------|-----|
| `code` | CharField(30) | Auto-gerado: `AUTO-XXXXXX` via `ScopeItemSequence` |
| `description` | CharField(300) | |
| `cable_family` | FK → `CableFamily` (nullable, PROTECT) | |
| `cable_spec` | FK → `CableSpec` (nullable, PROTECT) | |
| `network` | FK → `Network` (nullable, PROTECT) | |
| `workstream` | FK → `Workstream` (nullable, PROTECT) | |
| `medium` | CharField(20) | |
| `preterminated` | NullBooleanField | |
| `quantity` | DecimalField | |
| `unit` | CharField(20) | |
| `length_type` | CharField(20) | |
| `length_m` | DecimalField | Nullable |
| `color` | CharField(30) | |
| `fiber_count` | IntegerField | Nullable |
| `origin` | FK → `Location` (nullable, PROTECT) | |
| `destination` | FK → `Location` (nullable, PROTECT) | |
| `expansion_mode` | CharField(10) | `NONE` / `PATH` / `MANUAL` |
| `tasks_outdated` | BooleanField | Marcado quando algo muda que invalida as tasks geradas |
| `notes` | TextField | |

**Geração de código em `save()`:** atomic — `SELECT ... FOR UPDATE` no `ScopeItemSequence` para garantir unicidade em concorrência.

**`operational_status` (campo derivado no frontend):**

| Status | Condição |
|--------|----------|
| `AWAITING_RESOLUTION` | Nenhum `TaskTemplateRule` ativo bate |
| `READY_TO_GENERATE` | Há regra ativa, nenhuma task gerada ainda |
| `TASKS_GENERATED` | Tasks geradas e não desatualizadas |
| `REQUIRES_REVIEW` | `tasks_outdated = True` |
| `NO_MATCH` | Motor de regras sem resultado |

#### Modos de Expansão (`expansion_mode`)

| Modo | Comportamento |
|------|--------------|
| `NONE` | Geração direta pelo template, sem repetição por caminho |
| `PATH` | Steps com `repeatable=True` geram uma `GeneratedTask` por cada `ScopeItemPath` ativo |
| `MANUAL` | Usuário controla quais tarefas existem manualmente |

### `ScopeItemPath` — Caminho de Escopo

Associa um `ScopeItem` (no modo `PATH`) a um `Path` específico.

| Campo | Tipo |
|-------|------|
| `scope_item` | FK → `ScopeItem` (CASCADE) |
| `path` | FK → `Path` (PROTECT) |
| `is_active` | BooleanField |
| `notes` | CharField |

**Em `save()` e `delete()`:** marca `scope_item.tasks_outdated = True` automaticamente.

### `GeneratedTask` — Tarefa Gerada

Snapshot da tarefa no momento da geração — nunca atualizada retroativamente.

| Campo | Tipo | Obs |
|-------|------|-----|
| `code` | CharField(30) | Auto-gerado: `TASK-XXXXXX` via `GeneratedTaskSequence` |
| `scope_item` | FK → `ScopeItem` (CASCADE) | |
| `template_step` | FK → `TaskTemplateStep` (PROTECT) | |
| `path` | FK → `Path` (nullable, PROTECT) | Preenchido no modo PATH |
| `name` | CharField(200) | Snapshot do nome da etapa |
| `description` | TextField | Snapshot da descrição |
| `sequence` | IntegerField | Ordem dentro do ScopeItem |
| `estimated_hours` | DecimalField | Snapshot |
| `quantity` | DecimalField | Snapshot do ScopeItem |
| `unit` | CharField(20) | Snapshot |
| `status` | CharField(20) | choices: PENDING, ACTIVE, COMPLETED, CANCELLED |
| `notes` | TextField | |

**Criação bloqueada via API (`disableCreate: true` no frontend):** tarefas só são criadas pelo serviço `task_generator.py`, nunca manualmente.

**Geração de código em `save()`:** mesmo padrão atômico do `ScopeItem`.

### `GeneratedTaskDependency` — Dependência entre Tarefas Geradas

| Campo | Tipo |
|-------|------|
| `task` | FK → `GeneratedTask` (CASCADE) |
| `depends_on` | FK → `GeneratedTask` (CASCADE) |

**Validação em `clean()`:** detecção de ciclo — percorre o grafo de dependências e rejeita se encontrar um ciclo (prevents TASK-A → TASK-B → TASK-A).

---

## Fluxo de Importação de SOW

### `SowImport` — Importação de SOW

Registro de uma importação, do texto bruto até a aprovação final.

| Campo | Tipo | Obs |
|-------|------|-----|
| `code` | CharField(30) | Auto-gerado: `SOW-XXXXXX` via `SowImportSequence` |
| `project_ref` | CharField(100) | Referência livre ao projeto |
| `source_type` | CharField(20) | `TEXT`, `FILE` |
| `raw_text` | TextField | Texto original (fonte da verdade) |
| `status` | CharField(20) | `PENDING`, `PROCESSING`, `DONE`, `FAILED`, `FINALIZED` |
| `parser_version` | CharField(20) | Versão do parser determinístico usada |
| `ai_assisted` | BooleanField | Se a IA foi chamada nesta importação |
| `ai_model` | CharField(100) | Slug do modelo usado |
| `error_message` | TextField | Preenchido em `FAILED` |
| `finalized_at` | DateTimeField | Preenchido em `FINALIZED` |
| `requested_by` | FK → `CustomUser` | |

### `SowParsedItem` — Item Parseado

Prévia de cada linha do SOW para revisão humana.

| Campo | Tipo | Obs |
|-------|------|-----|
| `import_ref` | FK → `SowImport` (CASCADE) | |
| `line_number` | IntegerField | Posição no texto original |
| `raw_line` | CharField(500) | Linha crua |
| `item_type` | CharField(20) | `CABLE`, `LINK`, `OTHER` |
| `status` | CharField(20) | `PENDING`, `APPROVED`, `REJECTED`, `NEEDS_REVIEW` |
| `cable_family_code` / `cable_spec_code` / `network_code` / `workstream_code` | CharField | Resolvidos pelo parser |
| `quantity` | DecimalField | |
| `unit` | CharField(20) | |
| `length_type` | CharField(20) | |
| `length_m` | DecimalField | |
| `medium` / `preterminated` / `color` / `fiber_count` | vários | |
| `warnings` | JSONField | Lista de warnings do parser (ex: `PARSER_AI_CONFLICT`) |
| `approved_scope_item` | FK → `ScopeItem` (nullable, SET_NULL) | Preenchido após aprovação |

**Pipeline de parsing (`sow_parser/service.py`):**

1. **Parser determinístico** (`deterministic_parser.py`): resolve `cable_family`, `cable_spec`, `network`, `workstream`, `quantity`, `unit`, `length_type`, `length_m`, `medium`, `preterminated`, `color`, `fiber_count` linha a linha
2. **IA opcional** (`ai_parser.py` via OpenRouter): enriquece campos que o parser determinístico não resolveu
3. **Merge**: determinístico sempre vence quando ambos resolvem um campo — conflito gera warning `PARSER_AI_CONFLICT` (a IA nunca sobrescreve silenciosamente)
4. **Normalizer** (`normalizer.py`): valida e gera warnings adicionais por item

**Bloqueios de aprovação (`ApprovalBlockedError`):**
- `quantity <= 0`
- `cable_family` não resolvida em item do tipo `CABLE`
- Item já aprovado anteriormente

**Reprocessamento bloqueado (`ReprocessBlockedError`):** se já existe pelo menos 1 item `APPROVED`, o SowImport não pode ser reprocessado do zero (evita destruição de trabalho de revisão).

**Finalização bloqueada (`FinalizeBlockedError`):** se ainda há item com status `PENDING` ou `NEEDS_REVIEW`.

#### `Importar SOW` (ToolConfig)

Tela dedicada de importação acessível em Planejamento → Importar SOW. Formulário com textarea para colar o texto, upload de arquivo `.txt`, seleção de projeto, e revisão linha a linha dos `SowParsedItem` antes da aprovação.

---

## Contadores de Sequência

Três modelos de sequência garantem unicidade atômica dos códigos automáticos, mesmo sob concorrência:

| Modelo | Campo | Prefixo |
|--------|-------|---------|
| `ScopeItemSequence` | `last_value` | `AUTO-` |
| `GeneratedTaskSequence` | `last_value` | `TASK-` |
| `SowImportSequence` | `last_value` | `SOW-` |

Padrão de geração (em `save()` com `SELECT ... FOR UPDATE`):
```python
with transaction.atomic():
    seq = ScopeItemSequence.objects.select_for_update().get(pk=1)
    seq.last_value += 1
    seq.save()
    self.code = f"AUTO-{seq.last_value:06d}"
```

---

## Serviços Internos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `services/task_rule_resolver.py` | Motor de match read-only: dado os critérios de um `ScopeItem`, retorna a `TaskTemplateRule` de maior `specificity_score`/`priority`. Nunca cria registros. |
| `services/task_generator.py` | Lê a regra vencedora, itera os `TaskTemplateStep` e cria os `GeneratedTask`. Respeita `expansion_mode` (PATH gera uma task por `ScopeItemPath` ativo para steps `repeatable=True`). |
| `services/task_dependency_generator.py` | Gera `GeneratedTaskDependency` entre as tasks criadas, baseado nas dependências definidas no template. |
| `services/scope_item_normalizer.py` | Resolve códigos textuais (`cable_family_code` etc.) para instâncias de model — usado no fluxo de aprovação de `SowParsedItem`. Só resolve existentes, nunca cria catálogo novo. |
| `services/sow_parser/service.py` | Orquestrador completo do fluxo de importação (parser → IA → merge → preview). |
| `services/sow_parser/deterministic_parser.py` | Parser line-by-line sem IA. |
| `services/sow_parser/ai_parser.py` | Client OpenRouter para enriquecimento por IA. |
| `services/sow_parser/normalizer.py` | Validação e geração de warnings por `SowParsedItem`. |

---

## Padrão EntityConfig (Frontend)

Todas as entidades CRUD reaproveitam o mesmo componente genérico `CadastrosPage` via `EntityConfig`:

```ts
export const cableFamilyEntity: EntityConfig = {
  key: "cable-families",
  label: "Família de Cabos",
  apiPath: "/api/master-data/cable-families/",
  fields: [
    { key: "code", label: "Código", type: "text", required: true },
    { key: "name", label: "Nome", type: "text", required: true },
    { key: "is_active", label: "Ativo", type: "boolean" },
  ],
  defaultSort: "code",
};
```

Itens não-CRUD (Simulador de Regras, Importar SOW, Plano de Projeto) usam `ToolConfig`:

```ts
export const ruleSimulatorTool: ToolConfig = {
  key: "rule-simulator",
  label: "Simulador de Regras",
  kind: "tool",
  component: RuleSimulatorPage,
};
```

### Helpers de opções reutilizadas no frontend

| Helper | Busca |
|--------|-------|
| `cableFamilyOptions()` | `/api/master-data/cable-families/?is_active=true` |
| `cableSpecOptions(familyId?)` | `/api/master-data/cable-specs/?family=...` |
| `networkOptions()` | `/api/master-data/networks/?is_active=true` |
| `workstreamOptions()` | `/api/master-data/workstreams/?is_active=true` |
| `pathOptions()` | `/api/master-data/paths/?is_active=true` |
| `taskTemplateOptions()` | `/api/master-data/task-templates/?is_active=true` |
| `activityOptions()` | `/api/master-data/activities/?is_active=true` |
| `masterDataSiteOptions()` | `/api/master-data/sites/?is_active=true` |

---

## Auto-commit

```bash
git add backend/master_data/ frontend/src/pages/master-data/
git commit -m "descrição da alteração"
git push origin main
```

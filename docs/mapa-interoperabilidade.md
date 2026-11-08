# Mapa de interoperabilidade entre Core, Logística, Financeiro e Field

Levantamento feito em 2026-11-08 sobre o código dos quatro sistemas (Core em `backend/`/`frontend/`, `lgc-dev-logistica/`,
`lgc-dev-financeiro/`, `lgc-dev-field/`). Objetivo: listar **todo cadastro que existe em mais de um sistema** e dizer como ele
fica casado com o Core, que é a base principal. Os contratos já em uso continuam descritos em
[integracao-core-logistica.md](integracao-core-logistica.md), [integracao-core-financeiro.md](integracao-core-financeiro.md),
[integracao-core-field.md](integracao-core-field.md) e [integracao-centros-de-custo.md](integracao-centros-de-custo.md).
Este documento é o mapa geral e o plano para fechar as lacunas.

## 1. Regra de casamento (vale para os quatro)

1. **Um dono por cadastro.** Pessoas, clientes, sites, projetos, centros de custo, cargos, jornadas, feriados e
   certificações NR são do **Core**. Material e almoxarifado são da **Logística**. Orçamento, custo e fornecedor
   (F-01, a decidir) são do **Financeiro**. Tarefas, despacho, catálogo técnico (cabos, testes, localizações de rack) são do **Field**.
2. **O satélite guarda o id do dono** (`axis_*_id` / `*AxisId`, UUID do Core) e um **cache** com nome, código e ativo,
   alimentado pelos eventos do Core, pelo botão **Reenviar cadastros** e pela carga inicial do satélite.
3. **Registro casado não é editado no satélite** nos campos que vêm do Core: a tela mostra "Mantido no Axis Core" e só
   deixa editar o que é do satélite (ex.: sites atendidos pelo técnico no Field, sala/rack).
4. **Seleção, não digitação.** Onde o usuário escolhe pessoa, projeto, CC, cliente ou site, a tela oferece a lista do
   cache. Texto livre só para quem não está no Core (ex.: recebedor do cliente na entrega).
5. **Id do Core é validado contra o cache** na escrita (ausente gera aviso; inativo bloqueia, conforme a regra de cada fluxo).

## 2. Matriz por cadastro

Legenda: **casado** = guarda o id do Core e recebe atualizações; **cache** = guarda nome/código vindo do Core;
**solto** = existe no satélite sem vínculo; **—** = não existe.

| Cadastro (dono) | Logística | Financeiro | Field |
|---|---|---|---|
| Usuário (Core) | `axisUserId` nos papéis; cache `USER` **sempre vazio** (Core não emite `user.*`) | `axisUserId` nos papéis; cache `USER` **sempre vazio** | `users.User.axis_user_id`, casado por e-mail só no `axis_sync`; usuários criados no Django admin |
| Papel/permissão (Core) | mapa `axisRole → papel` por nome, sem validação | mapa `axisRole → papel` por nome, sem validação | grupos Django, sem vínculo (decisão: permissões ficam no satélite) |
| Colaborador (Core) | cache `COLLABORATOR` (nome, ativo); custodiante e recebedor por id | cache `COLLABORATOR`; alocação no CC com vigência (copiada) | `core.Collaborator` + `core.Person` **casados** (`axis_collaborator_id`), mas nome, e-mail, telefone, matrícula, cargo, supervisor e ativo continuam **editáveis e soltos** |
| Supervisor/hierarquia (Core `supervisorId`) | — | — | `Collaborator.manager` **solto** (define o escopo do Supervisor) |
| Cargo (Core `JobTitle`) | — | `JobTitleRoleMap` com **nome copiado do navegador** (fica velho se o Core renomear) | `core.JobTitle` **solto** (por empresa), sem id do Core |
| Jornada (Core `WorkSchedule`) | — | `hoursPerDay` digitado nos parâmetros | fixo no código (8 h, 7 h, 07:30–16:40) |
| Feriado (Core `Holiday`) | — | **não usa** (conta seg–sex; a especificação pede o calendário do Core) | **não usa** (painel de sites conta seg–sex) |
| Certificação NR / ASO (Core) | — | — | — (o despacho não confere NR nem ASO) |
| Ausência (Core `status` férias/afastado) | — | — | `TechnicianAbsence` **solto**, digitado na Operação do Dia |
| Setor (Core) | — | — | — |
| Centro de custo (Core) | cache `COST_CENTER` | cache `COST_CENTER` + orçamento | cache + `axis_cost_center_id` em colaborador e obra |
| Cliente (Core) | cache `CLIENT` **sem nome** (evento magro) | cache `CLIENT`; nome só pelo botão PJ2 | `core.Client` **casado** por CNPJ/nome, mas razão social, CNPJ, endereço e ativo **soltos** |
| Contato do cliente (Core `contacts`, legado) | — | — | `core.Responsible` tipo cliente **solto** |
| Site do cliente (Core) | cache `SITE`; destino da ordem | **não assina** `site.*`; `BudgetDestination` (km, pedágio) **solto** | `core.Site` **casado** (`axis_site_id`), mas nome, endereço e coordenadas **soltos** (o Field geocodifica de novo) |
| Site técnico (`master_data.Site`, Field) | — | — | mesmo código do site do Core (`GRU65`), **sem vínculo** com `core.Site` |
| Projeto (Core) | cache `PROJECT`; ordens por id | `ProjectBudget.axisProjectId` validado no cache | `projects.Project.axis_project_id` (nasce do `project.approved`); obra manual fica sem vínculo |
| Responsável LGC do projeto (Core) | `recipient_id` da ordem | — | `core.Responsible` tipo LGC **solto**, ligado à `Person` |
| Empresa (multiempresa) | cache `COMPANY` previsto, nunca preenchido | — | `core.Company` **solto** (Core é unidade única, A3) |
| Material (Logística) | dona | `BudgetMaterial` **solto** (catálogo próprio com preço); linha da revisão guarda o código da Logística, **sem reconferir na aprovação** | `master_data.CableSpec` (fabricante, part number) **solto** |
| Unidade de medida (Logística) | dona (seed) | texto livre | texto livre |
| Almoxarifado (Logística) | dono; endereço em texto, responsável por id sem validação | — | — |
| Fornecedor (F-01) | `supplierAxisId` em lote/recebimento, sem cadastro em lugar nenhum | planejado, não existe; `CcPurchase.groups[].supplier` texto | — |
| Transportadora, motorista, veículo | texto livre no romaneio e no recebimento | — | — |
| Horas reais (Field) | — | `FieldLaborDay` por `axis_project_id` × `axis_collaborator_id` | dono |

## 3. Lacunas por sistema

### 3.1 Core (fonte): eventos incompletos

| # | Lacuna | Efeito |
|---|---|---|
| C1 | `client.created` só leva `client_id` e `code`; `client.updated` só `changed_fields` | Logística e Financeiro ficam com cliente sem nome; o Field precisa consultar o Core para casar |
| C2 | `collaborator.*` sem `email`, `matricula`, `supervisor_id`, `phone`, `management_level` | Field não casa sozinho nem recebe a hierarquia |
| C3 | Não existe `user.created/updated/disabled` | Desligar usuário no Core não bloqueia ninguém nos satélites; caches `USER` vazios |
| C4 | Não existe `job_title.*`, `holiday.*`, `work_schedule.*`, `sector.*`, `certification.*` | Cargos, feriados, jornadas e NR não chegam a nenhum satélite |
| C5 | **Reenviar cadastros** não reenvia clientes, projetos, usuários nem cargos | Satélite novo fica com cache incompleto |
| C6 | API de consulta sem `users` (lista), `job-titles`, `holidays`, `work-schedules`, `certifications` | `axis_sync` do Field marca "indisponível" |
| C7 | Tela de satélite oferece só 10 eventos (sem `site.*`, `cost_center.*`, `project.updated/deleted/approved`, `material_request.*`…) e não há edição da assinatura | Satélite cadastrado pela tela não recebe metade dos eventos |
| C8 | Ao desligar, `collaborator.updated` e `collaborator.offboarded` saem no mesmo instante; o despacho ordena só por `created_at` | Ordem de chegada indefinida (ver L2) |

### 3.2 Logística

| # | Lacuna |
|---|---|
| L1 | Ids do Core (`projectAxisId`, `costCenterAxisId`, `clientAxisId`, `custodianAxisId`) **não são validados** em movimento de estoque, devolução, almoxarifado e recebimento |
| L2 | `collaborator.updated` sempre grava `active = true` (ignora `status` do payload); o reenvio de cadastros **reativa desligados** |
| L3 | Custódia guarda id de **colaborador** (vem do Core) mas "minha custódia" filtra por id de **usuário**; o relatório `custody-value` do Financeiro pode partir a mesma pessoa em duas linhas |
| L4 | Telas e PDFs mostram UUID truncado de projeto, CC, solicitante e custodiante, em vez do nome do cache; não há rota que exponha o cache |
| L5 | Espera `purchase_order.approved/changed`; o Core emite `purchase.approved`/`purchase.order_registered` (nomes não batem) |
| L6 | Romaneio guarda destino em texto (sem `site_id`); transportadora, motorista e veículo em texto |
| L7 | Almoxarifado: endereço em texto e responsável sem validação; caches `COMPANY`/`UNIT` previstos e nunca preenchidos |

### 3.3 Financeiro

| # | Lacuna |
|---|---|
| F1 | Não trata `site.*` (vai como `IGNORED`); `BudgetDestination` (km ida e volta, pedágio) não aponta para o site do Core |
| F2 | `JobTitleRoleMap.jobTitleName` vem do navegador e envelhece; não há cache de cargo |
| F3 | Cálculo de dias úteis da cotação ignora feriados do Core |
| F4 | Linha de material da revisão não reconfere o código na Logística ao aprovar o envio; catálogo próprio `BudgetMaterial` sem código da Logística |
| F5 | Importações (`purchase.*`, consumo da Logística) gravam ids de CC e projeto sem conferir o cache |
| F6 | Colaborador só fica inativo com `offboarded`, não com `updated` de status desligado |
| F7 | `payable.*` não existe ainda (F6 do Financeiro); o receptor do Core já existe mas não tem handler |

### 3.4 Field

| # | Lacuna |
|---|---|
| D1 | Cliente, site e colaborador casados continuam **editáveis** em Cadastros Gerais, CSV e Django admin; o webhook não copia nada de negócio (decisão pendente §7.5 do doc do Field) |
| D2 | Cliente e colaborador **novos** no Core não são criados no Field (só casa o que já existe); técnico admitido no Core não aparece no despacho |
| D3 | Supervisor (`manager`) solto; o escopo do Supervisor no Field não segue o Core |
| D4 | `core.JobTitle` solto; `Person` duplica nome/e-mail/telefone do colaborador |
| D5 | Usuários criados no Django admin; desligar no Core não desativa no Field |
| D6 | `master_data.Site` (catálogo técnico) usa o mesmo código do site do Core sem vínculo |
| D7 | Feriados, jornada, férias/afastamento e NR/ASO do Core não chegam (despacho pode escalar técnico de férias ou com NR vencida) |
| D8 | `core.Company` (multiempresa) sem equivalente no Core |

## 4. Plano de vínculos (ondas)

Cada onda é um PR por sistema (regra 4 do AGENTS.md); quando a onda muda contrato, o PR do Core vai primeiro e diz isso
na mensagem. Mudanças nos satélites são aditivas (campos novos nulos), sem apagar dado.

| Onda | Sistema | Entrega | Fecha |
|---|---|---|---|
| **V1 – Contrato do Core** | Core | `client.*` com estado completo (razão social, fantasia, CNPJ, endereço, ativo); `collaborator.*` com `email`, `matricula`, `supervisor_id`, `management_level`, `phone`, `status`; novos `user.created/updated/disabled`, `job_title.created/updated`, `holiday.created/deleted`, `certification.changed`; **Reenviar cadastros** inclui clientes, projetos, usuários, cargos e feriados; API de consulta `users`, `job-titles`, `holidays`; tela de satélite com a lista completa de eventos e edição da assinatura; desempate da ordem do outbox por `id` | C1–C8 |
| **V2 – Caches dos satélites** | Logística, Financeiro | Ler `status` do colaborador (desligado = inativo), `user.*` preenchendo o cache `USER`, nome do cliente, `site.*` e `job_title.*` no Financeiro; custódia guardando o id do colaborador | L2, L3, L5, F1 (cache), F2, F6 |
| **V3 – Field: Core manda** | Field | Webhook passa a **criar e atualizar** cliente, site, colaborador/pessoa, cargo e supervisor (campos do Core); campos do Core somem do formulário e do CSV para registro casado ("Mantido no Axis Core"); usuário desativado no Core vira `is_active=False`; férias/afastamento do Core vira ausência; feriados no cálculo de dias úteis | D1–D5, D7 (parcial) |
| **V4 – Seleção e validação** | Logística, Financeiro | Rota que expõe o cache (busca por nome/código); seletores de projeto, CC, colaborador e site no lugar de texto/UUID; validação dos ids nas escritas; romaneio com `site_id`; `BudgetDestination` ligado ao site do Core; reconferir material na aprovação do envio | L1, L4, L6, F1, F4, F5 |
| **V5 – Decisões de negócio** | todos | Fornecedor (F-01), multiempresa (D8), NR/ASO no despacho, transportadora/veículo como cadastro, vínculo `master_data.Site` ↔ site do Core, `payable.*` | L7, D6, D8, F7 |

## 5. Decisões do dono do produto

Decididas em 2026-11-08:

| # | Decisão |
|---|---|
| MI-01 | **O Field cria sozinho** cliente, site, cargo e colaborador que o Core cadastrar (não só casa os existentes). Colaborador entra no Field quando o cargo é técnico (`job_title_is_technician`) ou o nível de gestão não é `colaborador`; usa a empresa padrão do Field. Revisa a FD-02 e resolve a §7.5 de [integracao-core-field.md](integracao-core-field.md). |
| MI-02 | **Registro casado tem os campos do Core bloqueados no Field** (tela, CSV e Django admin), com o aviso "Mantido no Axis Core". Registro sem vínculo continua editável até casar. |
| MI-03 | Implementar agora as ondas **V1 a V4**; V5 fica para decisão. |

A decidir (V5):

1. **Fornecedor (F-01):** dono é o Financeiro (proposta da especificação) ou o Core?
2. **Multiempresa:** o Core passa a ter empresa, ou o Field fica com uma empresa só?
3. **NR/ASO vencidos bloqueiam o despacho no Field** ou só avisam?
4. **Usuário do Field:** o Core cria o usuário no Field (depende do login pelo Core, F1) ou o Field só espelha ativo/inativo?

## 6. Contrato V1 (eventos e consultas novos do Core)

Mesmo envelope, assinatura e entrega dos eventos atuais. Todo evento de cadastro leva o **estado completo** (quem recebe
pode substituir o cache inteiro) e um campo `name` e `active`, que os caches genéricos dos satélites já leem.

| Evento | Quando | Payload |
|---|---|---|
| `client.created`, `client.updated` | criar/editar cliente | `client_id`, `code` (número), `name` (= razão social), `legal_name`, `trade_name`, `cnpj`, `phone`, `email`, `cep`, `address_street`, `address_number`, `address_complement`, `address_district`, `address_city`, `address_state`, `active` (`true`); `updated` mantém `changed_fields` |
| `client.deleted` | excluir cliente (se a exclusão existir) | `client_id`, `code`, `active: false`, `deleted: true` |
| `collaborator.created`, `collaborator.updated` | como hoje | o estado atual (`collaborator_id`, `name`, `status`, `sector_id`, `cost_center_id`, `job_title_id`, `job_title_name`, `admission_date`) **mais** `email` (corporativo), `matricula`, `phone`, `yellow_badge`, `supervisor_id`, `management_level`, `job_title_is_technician`, `active` (`status != desligado`) |
| `collaborator.offboarded` | desligamento | o mesmo estado completo (com `status: desligado`, `active: false`) mais `offboarded_at`. Como `updated` e `offboarded` saem juntos, a ordem de chegada não importa: os dois dizem `desligado` |
| `user.created`, `user.updated` | criar usuário; mudar e-mail, papéis ou reativar | `user_id`, `email`, `name` (nome do colaborador ou o e-mail), `status` (`active`/`disabled`), `active`, `collaborator_id`, `roles` (nomes) |
| `user.disabled` | usuário desativado | o mesmo payload, `status: disabled`, `active: false` |
| `job_title.created`, `job_title.updated` | criar/editar cargo | `job_title_id`, `name`, `is_technician`, `active: true` |
| `job_title.deleted` | excluir cargo | `job_title_id`, `name`, `active: false`, `deleted: true` |
| `holiday.created`, `holiday.updated` | criar/editar feriado | `holiday_id`, `date` (`AAAA-MM-DD`), `name`, `active: true` |
| `holiday.deleted` | excluir feriado | `holiday_id`, `date`, `name`, `active: false`, `deleted: true` |

**Reenviar cadastros** passa a reenviar também `client.updated` (cada cliente), `project.updated` (cada projeto, estado
completo de `project.*`), `user.updated`/`user.disabled` (cada usuário que não é de sistema), `job_title.updated` (cada
cargo) e `holiday.updated` (cada feriado). A resposta ganha `clients`, `projects`, `users`, `jobTitles`, `holidays`.

**API de consulta por API key** ganha `GET /integration/users` (paginado como as demais listas; mesmo formato de
`users/:id` mais `collaborator_id`), `GET /integration/job-titles` e `GET /integration/holidays?from=&to=`; e
`collaborators` passa a devolver `supervisor_id`, `management_level` e `job_title_is_technician`.

**Assinaturas:** a tela de satélite oferece todos os eventos que o Core emite (lista única no backend,
`GET /integration/event-types`) e permite editar a assinatura de um satélite já cadastrado.

## 7. Estado em 2026-11-08 (V1 a V4 implementadas, sem commit)

| Lacuna | Situação |
|---|---|
| C1–C7 | **Feitas.** Eventos `client.*` completos (e `client.deleted`), `collaborator.*` com e-mail, matrícula, telefone, Yellow Badge, supervisor, nível e `job_title_is_technician`; `user.created/updated/disabled`; `job_title.*`; `holiday.created/deleted` (`holiday.updated` só no reenvio: não há edição de feriado). Reenviar cadastros cobre clientes, projetos, usuários, cargos e feriados. API de consulta com `users`, `job-titles`, `holidays` e colaborador completo. Catálogo de eventos (`backend/src/integration/event-catalog.ts`, `GET /integration/event-types`) e edição da assinatura (`PATCH /integration/satellites/:id`, tela **Integrações → Editar assinatura**). Detalhe em [cadastros.md](dominio/cadastros.md). |
| C8 | **Feita** pelo payload: `updated` e `offboarded` dizem os dois `desligado`. |
| L1–L4, L6 | **Feitas.** Cache respeita `status`/`active`; custódia por pessoa (usuário + colaborador); `GET /axis/lookup` e seletores; nomes no lugar de UUID nas telas e PDFs; validação dos ids na escrita; romaneio e almoxarifado com site do Core. Migração `20261109090000_cadastros_core_site_romaneio`. Detalhe em [integracao-core-logistica.md §3.2–3.3](integracao-core-logistica.md). |
| L5 | **Decidido diferente:** a compra do Core vai ao solicitante, não ao almoxarifado; só entra na reposição se o evento trouxer `warehouse_code` (hoje não traz). |
| L7 | Parcial: responsável e site do almoxarifado por seletor; empresa/unidade ficam para a V5. |
| F1–F6 | **Feitas.** Caches `SITE`, `JOB_TITLE`, `HOLIDAY`; destino da cotação ligado ao site do Core; dias úteis sem feriados; nome do cargo vindo do Core; material reconferido na Logística ao aprovar o envio (bloqueia se faltar ou se a Logística estiver fora); ids desconhecidos geram aviso, sem perder lançamento. `GET /master-data/:kind` e seletor. Migração `20261109110000_v4_destino_site_core`. Detalhe em [integracao-core-financeiro.md §2.2](integracao-core-financeiro.md). |
| F7 | Fora do escopo (V5). |
| D1–D5, D7 (feriados) | **Feitas** (MI-01, MI-02): o Field cria e atualiza cliente, site, cargo e técnico/gestor; espelha ativo do usuário; feriados entram nos dias úteis; campos do Core bloqueados na API, CSV, admin e tela. Migrações `core.0038_axis_v3_cargo_feriado` e `axis_integration.0003_cargo_feriado`. Detalhe em [integracao-core-field.md §3.1](integracao-core-field.md). |
| D7 (férias, NR/ASO), D6, D8 | Pendentes: o Core não manda datas de férias (fica `axis_status` no técnico); NR/ASO, site técnico e multiempresa são V5. |

### Para ativar

1. Aplicar as migrações novas: Core nenhuma (além da `20261125000000_clientes_dados_cadastrais`, já pendente na árvore);
   Logística e Financeiro com o `migrate deploy` de cada um; Field com `manage.py migrate`.
2. No Financeiro, rodar `prisma generate` de novo com o servidor parado (o arquivo do motor estava preso).
3. No Field, definir `AXIS_DEFAULT_COMPANY_ID` (opcional; vazio usa a primeira empresa ativa).
4. No Core, **Integrações → Editar assinatura** de cada satélite: Logística, Financeiro e Field assinam `client.*`,
   `collaborator.*`, `user.*`, `site.*`, `cost_center.*`, `project.*`; Financeiro e Field também `job_title.*` e `holiday.*`.
5. **Integrações → Reenviar cadastros** e, no Field, `manage.py axis_sync` para casar e criar o que já existe.

### Não verificado

Testes e2e (banco `_test`), migrações num banco real, testes do Field no Docker/Postgres (rodaram em SQLite: 130 da
integração passam; 13 erros da suíte completa são do manifest de estáticos antigo, `lgc-logo-light.png`) e as telas no
navegador.

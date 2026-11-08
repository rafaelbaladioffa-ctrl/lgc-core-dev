# Integração Core ↔ Field

Plano de integração entre o Axis Core e o satélite **Axis Field** (`lgc-dev-field/`, antigo ERP
CSTR), escrito em 2026-11-08 quando o código entrou no repositório. **Estado:** os cadastros do Core chegam
ao Field (webhook, carga inicial e casamento: F2/F3, PT-03 do
plano `docs/plano-projeto-aprovado-ponta-a-ponta.md`, que ainda não está versionado); login pelo Core (F1), obra a
partir do Core (F4) e retorno ao Core (F5) seguem pendentes.

Decisões do dono do produto em 2026-11-08:

| # | Decisão |
|---|---|
| FD-01 | O Field entra como satélite em `lgc-dev-field/`, **mantendo Django**, banco próprio (decisão A10 em [arquitetura.md](arquitetura.md#8-decisões-de-arquitetura)). |
| FD-02 | **O Core é a fonte da verdade** para usuários (login), colaboradores, clientes e projetos. O Field recebe esses dados pelos webhooks do Core e casa os registros que já existem. **Revisada em 2026-11-08 pela PA-05** (abaixo): o site também passa a ser cadastro do Core. |
| FD-03 | Nome e identidade visual: **Axis Field**, com a marca do Axis (`scripts/sync-design.mjs`). |
| FD-04 | Só o código foi trazido do `erp-cstr` (commit `c27ef24`), sem o histórico do Git. |
| PA-05 | **Site vira cadastro do Core** (ligado ao cliente: código como `GRU53`, nome, endereço, latitude/longitude; eventos `site.created/updated`). O Field casa os sites dele por `axis_site_id` e continua dono das localizações internas (sala, rack). **Revisa a FD-02**, que deixava o site só no Field. Decisão do plano do projeto aprovado (`docs/plano-projeto-aprovado-ponta-a-ponta.md` §3). |

## Resumo dos canais (alvo)

| Canal | Direção | Estado |
|---|---|---|
| Login no Core pelo navegador (CORS) e access token do Core na API do Field | Core → Field | **A fazer** (F1) |
| Webhook de dados mestres (`collaborator.*`, `client.*`, `project.*`, `cost_center.*`, `site.*`) | Core → Field | **Feito** (F2, §3). `project.*` só guarda cache e vínculo; não cria obra |
| Carga inicial e casamento dos cadastros já existentes no Field | Core → Field | **Feito** (F3, `manage.py axis_sync`, §3) |
| Projeto ganho no Core vira obra no Field | Core → Field | **A decidir** (F4, §4) |
| Horas reais por técnico, projeto e dia (mão de obra realizada) | Field → Financeiro | **Feito** (PT-10, §5.1): `GET /api/integration/labor-hours`, puxado pelo Financeiro |
| Avanço, HH e status da obra | Field → Core | **A fazer**; depende do receptor `POST /integration/inbound` no Core, que ainda não existe (F5) |

## 1. Sobreposição de cadastros

| Field (`lgc-dev-field/backend`) | Core | Regra proposta |
|---|---|---|
| `users.User` (e-mail único, grupos Django) | `User` | Login só no Core; o Field casa por e-mail e guarda `axis_user_id`. Permissões do Field continuam nos grupos Django (como a Logística e o Financeiro resolvem os próprios papéis). |
| `core.Person` + `core.Collaborator` (cargo, `manager`) | `Collaborator` | Core manda; Field guarda `axis_collaborator_id`. A hierarquia (`manager`), usada no escopo de Supervisor, passa a vir do Core. |
| `core.Client` | `Client` | Core manda; casar por CNPJ, senão por nome normalizado. |
| `core.Site` (site do cliente, o da obra: `Project.site`) | `Site` (PA-05) | Casa por cliente + código; o Field guarda `axis_site_id`. Endereço e nome do Field não são sobrescritos. |
| `core.Region`, `master_data.Site` (catálogo técnico/topologia, único por código, sem cliente) | — | **Ficam no Field.** `master_data.Site` não recebe `axis_site_id`: o site da obra é o `core.Site`. |
| `core.Company` (multiempresa) | — (A3: unidade única) | **A decidir** (§7). |
| `core.JobTitle` | `JobTitle` | Core manda (vem junto no colaborador). |
| `projects.Project` (`CSTR-PROJ-…`) | `Project` (`PROP-…`) | Vínculo `axis_project_id`; ver §4. |
| Catálogo técnico (`master_data`), tarefas, despacho, presença, HH | — | **Ficam no Field.** |

Todas as mudanças de modelo no Field são **aditivas** (campos `axis_*_id` nulos primeiro), seguindo
a regra do próprio ERP CSTR. Campos criados no PT-03 (todos `UUID`, nulos, não editáveis no admin, sem FK):

| Modelo | Campos |
|---|---|
| `users.User` | `axis_user_id` (único; criado aqui porque o F1 ainda não o tinha no código) |
| `core.Client` | `axis_client_id` (único) |
| `core.Collaborator` | `axis_collaborator_id` (único), `axis_cost_center_id` (cache do CC vigente no Core) |
| `core.Site` | `axis_site_id` (único) |
| `projects.Project` | `axis_project_id` (único), `axis_cost_center_id` (cache) |

## 2. F1 — Identidade

Mesmo modelo do Financeiro ([integracao-core-financeiro.md §1](integracao-core-financeiro.md#1-identidade)):

- `JWT_SECRET` do Field = `JWT_ACCESS_SECRET` do Core, `HS256` fixo; recusar tokens com `iss` (os de
  sessão própria da Logística).
- Nova classe de autenticação DRF que valida o token do Core e resolve o `User` local pelo
  `axis_user_id` (ou e-mail na primeira vez). Usuário sem vínculo → 403 com mensagem em pt-BR.
- O frontend do Field faz login/refresh no Core (`VITE_AXIS_URL`); o Core lista `http://localhost:5176`
  e o domínio de produção do Field em `CORS_ALLOWED_ORIGINS`.
- Durante a transição, o login local (`/api/token/`) continua só para superusuário, até a
  produção migrar.
- O bot do WhatsApp continua com `X-Bot-Secret` (não usa login).

## 3. F2/F3 — Webhooks e carga inicial

**Implementado** no app Django `axis_integration` (PT-03). Nada é apagado, e nenhum dado de negócio do
Field é sobrescrito: o Core só grava os vínculos `axis_*_id`, o centro de custo (cache) e o cache dos
cadastros.

### Receptor `POST /api/v1/webhooks/axis`

- **Assinatura:** `X-Axis-Signature: sha256=<hex>` = HMAC-SHA256 do corpo bruto com `AXIS_WEBHOOK_SECRET`,
  conferida com `hmac.compare_digest`. Sem segredo configurado → `503`; assinatura ausente ou errada → `401`.
- **Anti-replay:** `occurred_at` mais velho que `AXIS_WEBHOOK_MAX_AGE_HOURS` (72 h, o Core reentrega com
  backoff) ou mais de 5 min no futuro → `400`. Envelope inválido, JSON inválido ou id do cadastro que não é
  UUID → `400` (não adianta reentregar).
- **Idempotência:** tabela `axis_integration_axisinboxevent`, `event_id` único. O registro do evento e a
  atualização do cache acontecem **na mesma transação**. Repetido → `200 {"status": "duplicate"}` sem
  reprocessar. Falha ao aplicar → `500`, a transação é desfeita, o evento fica `failed` e é reprocessado na
  reentrega. Tipo de evento que o Field não consome (`purchase.*`, `request.*`…) → `200 ignored`.
- **Ordem:** o cache guarda a ocorrência do último evento aplicado; evento mais velho não sobrescreve
  (`note = out_of_order`). Eventos parciais (`client.updated` só com `changed_fields`) são mesclados.

| Evento | Efeito no Field |
|---|---|
| `collaborator.created/updated/offboarded` | Cache + casamento. `offboarded` marca o cache inativo, **mas não desativa o colaborador do Field** (decisão pendente, §7). |
| `collaborator.cost_center_changed` | `Collaborator.axis_cost_center_id` (ou o cache, se o colaborador ainda não casou; é aplicado quando casar). |
| `client.created/updated` | Cache + casamento por CNPJ, senão nome normalizado. |
| `project.created/updated/status_changed/deleted` | **Só cache e vínculo**: se uma obra já tiver `axis_project_id` igual, recebe `axis_cost_center_id`. **Não cria obra** (isso é o PT-08). Não há casamento automático de projeto: `PROP-…` e `CSTR-PROJ-…` não têm chave comum. |
| `cost_center.created/updated` | Cache (`code`, `short_code`, `name`, `active`…). |
| `site.created/updated` | Cache + casamento por cliente já vinculado + código. Site cujo cliente ainda não casou fica sem vínculo e casa sozinho quando o cliente casar. |

**Eventos magros.** Hoje o Core manda `client.created` só com `client_id` e `code`, e `collaborator.*` sem
e-mail nem matrícula: sozinhos não bastam para casar. Se `AXIS_API_URL`/`AXIS_API_KEY` estiverem
configuradas, o receptor completa o cadastro com `GET /integration/clients|collaborators/:id` (fora da
transação, timeout de 5 s). Falha na consulta **não** derruba o evento: o registro entra sem vínculo e o
`axis_sync` resolve depois. Contatos e endereço do cliente (dados pessoais) não ficam no cache. **Pendência
no Core (contrato, não alterado aqui):** incluir `cnpj`/`name` em `client.*` e `email`/`registration` em
`collaborator.*` evitaria a consulta.

### Casamento

| Cadastro | Chave | Observações |
|---|---|---|
| Cliente | CNPJ (só dígitos); senão nome normalizado (sem acento, pontuação nem `Ltda/S.A.`) contra razão social e fantasia | Mais de um candidato → sem vínculo (ambíguo). Cliente do Field já vinculado a outro id não é reaproveitado. |
| Colaborador | e-mail corporativo × e-mail da `Person`; senão matrícula | O Core ainda não expõe a matrícula na API de consulta. |
| Site | cliente vinculado + código (sem diferenciar maiúsculas) | Sites do mesmo código em outro cliente não casam. |
| Usuário | e-mail | Só pelo `axis_sync` (o Core não emite `user.*` e a consulta de lista de usuários não existe ainda). |
| Projeto | `axis_project_id` já gravado | Quem grava é o PT-08. |

Sem par único: o registro **fica sem vínculo e aparece no relatório**; nada é criado nem apagado.

### Carga inicial: `manage.py axis_sync`

```bash
docker compose run --rm field-backend python manage.py axis_sync
docker compose run --rm field-backend python manage.py axis_sync --resources clients sites
docker compose run --rm field-backend python manage.py axis_sync --report-only --json
```

Lê `GET /integration/{clients,collaborators,users,projects,cost-centers,sites}` (paginado, `Authorization:
Bearer <AXIS_API_KEY>`), grava no cache, casa e imprime o relatório: registros do Core sem par (com o motivo) e
registros **ativos** do Field sem par. Recurso que o Core ainda não tem (`404`: `sites` antes do PT-01, `users`
em lista) vira "indisponível" e não interrompe os outros; erro de API key termina com código de saída ≠ 0 depois
de processar o resto. `--report-only` não consulta o Core. Pode ser rodado de novo sem duplicar nada. Evento
mais novo que a consulta prevalece sobre ela.

### Variáveis (`lgc-dev-field/.env.example`)

`AXIS_WEBHOOK_SECRET`, `AXIS_WEBHOOK_MAX_AGE_HOURS`, `AXIS_API_URL` (termina em `/api/v1`), `AXIS_API_KEY`,
`AXIS_API_TIMEOUT`, `FIELD_INTEGRATION_API_KEY` (chave que o Financeiro envia em `X-Api-Key`, §5.1). No Core, o satélite precisa assinar os eventos da tabela acima e apontar o webhook para
`<url do Field>/api/v1/webhooks/axis`; depois, o botão **Integrações → Reenviar cadastros** reenvia
colaboradores e centros de custo (clientes e sites entram pelo `axis_sync`).

## 4. Projeto do Core × obra do Field

No Core, `Project` nasce como proposta comercial (`PROP-{cliente}.{seq}-{MMAA}`, cotação com o
Financeiro). No Field, `Project` é a obra em execução (tarefas, despacho, HH). Proposta: quando o
projeto do Core passa para execução (`project.status_changed`), o Field cria ou vincula a obra com
`axis_project_id`; o código `CSTR-PROJ-…` continua como código da obra. **Pendente de decisão:** em
que status do Core a obra nasce, se uma proposta pode gerar várias obras (uma por site) e quem
cadastra a obra se não houver proposta no Core.

## 5. F5 — Field → Core

O Core não tem receptor de eventos de satélite (mesmo bloqueio da Logística e do Financeiro). Quando
existir, candidatos: `field.project.progress` (% de avanço, HH real × orçado) e
`field.project.completed`. O Financeiro (módulo Projetos, resultado por projeto) é o principal
interessado no HH real.

### 5.1 Horas reais para o Financeiro (PT-10)

Não passa pelo Core: o Financeiro consulta o Field direto (mesmo padrão do consumo da Logística).

`GET /api/integration/labor-hours?from=AAAA-MM-DD&to=AAAA-MM-DD` com o cabeçalho `X-Api-Key`
(`FIELD_INTEGRATION_API_KEY`; sem a variável a rota responde `503`, chave errada `401`, período inválido ou
acima de 62 dias `400`). Resposta: lista de
`{ axis_project_id, axis_collaborator_id, date, hours, adjusted }`.

- **Fonte:** a mesma do HH do projeto (regra 1): o `actual_hours` de cada despacho (`ProjectTaskAssignment`),
  que já desconta as pausas. Tarefa com apontamento completo mas sem horas por técnico (dado histórico)
  segue o mesmo fallback do `real_man_hours`: cada técnico vinculado recebe as horas de relógio da tarefa.
- **Dia:** São Paulo. Despacho que atravessa a meia-noite reparte as horas pelos dias na proporção do tempo
  de execução de cada um, com arredondamento a 2 casas que preserva o total do despacho.
- **Fora:** tarefa sem técnico vinculado (regra 8), horas da planilha do supervisor (`ProjectHourEntry`,
  regra 9) e despacho ainda aberto (sem término).
- **`adjusted`:** `true` quando algum despacho do dia (técnico × projeto) teve ajuste de timeline.
- **`hours`:** string decimal com 2 casas; uma linha por (projeto, técnico, dia).
- **Vínculo:** só entram projetos com `axis_project_id` e colaboradores com `axis_collaborator_id`. O que
  ficou de fora por falta de vínculo é somado por motivo (`projeto_sem_vinculo`, `colaborador_sem_vinculo`)
  no log do Field (`WARNING`) e no cabeçalho de resposta `X-Unlinked-Hours`, não na lista.

Contrato e tratamento no Financeiro: [integracao-centros-de-custo.md](integracao-centros-de-custo.md).
Sem migração nova.

## 6. Migração da produção

A produção do ERP CSTR (VPS própria, domínio próprio) continua rodando do repositório `erp-cstr`.
Para migrar: backup do banco, F1–F3 concluídas e ensaiadas numa cópia do banco, restauração no
servidor do Axis como `field-postgres`, troca de DNS e congelamento do repositório antigo. **Não
faça deploy deste diretório na produção antiga.**

## 7. Pendências de decisão

1. **Marca nas comunicações a clientes:** remetente de e-mail (`DEFAULT_FROM_EMAIL`), timbrado dos
   PDFs (`backend/core/static/core/img/letterhead-consultimer.png`), "Tipo de Projeto Consultimer" e
   `responsible_cstr` continuam com o nome Consultimer. Trocar exige migração e afeta o que o cliente
   recebe.
2. **Multiempresa:** o Field tem `Company`; o Core é unidade única (A3).
3. **Status de nascimento da obra** e relação proposta → obras (§4).
4. **Identidade visual completa:** adotar `axis-tokens.css`/`axis-shell.css` no frontend do Field
   (hoje só nome, logotipo e ícones são do Axis).
5. **Efeito dos eventos sobre dados do Field:** hoje o webhook não altera dado de negócio (nem desativa colaborador desligado, nem copia nome/CNPJ do cliente, nem a hierarquia `manager`). Decidir, ao revisar a FD-02, quais campos o Core passa a mandar de fato.

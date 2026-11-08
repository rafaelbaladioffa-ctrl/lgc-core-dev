# Cadastros base do Axis Core

Propósito: descrever como os cadastros base (usuários, papéis, setores, centros de custo, cargos, jornadas, colaboradores, certificações, clientes e projetos) funcionam **hoje** no código, com regras, endpoints e eventos.
Data: 2026-11-07. Fontes: [schema.prisma](../../backend/prisma/schema.prisma), [seed.ts](../../backend/prisma/seed.ts), módulos em [backend/src](../../backend/src), páginas em [frontend/src/pages](../../frontend/src/pages) e [planning-v0.2.md](../arquivo/planning-v0.2.md) §4.2–4.7 e §5 (fonte das regras originais; divergências apontadas abaixo).

Convenções gerais (valem para todas as entidades):

- Prefixo global da API: `/api/v1` ([main.ts](../../backend/src/main.ts)). Rotas abaixo omitem o prefixo.
- Todo controller usa `@UseGuards(JwtAuthGuard, PermissionsGuard)`; a permissão exigida vem de `@RequirePermissions('recurso:ação')` ([permissions.guard.ts](../../backend/src/rbac/permissions.guard.ts)). As permissões vão dentro do JWT, então mudança de papel só vale após novo login/refresh.
- IDs são UUID; `created_at`/`updated_at` em todas as tabelas.
- Exclusões (`DELETE`) são físicas. Quando há FK apontando para o registro, o Prisma devolve `P2003` e o serviço converte em `409 Conflict`.
- Eventos de integração são gravados em `integration_outbox` **na mesma transação** da escrita via [OutboxService.record](../../backend/src/integration/outbox.service.ts).
- Auditoria (`audit_logs`) só é gravada nas rotas com `@AuditAction`, pelo interceptor global [audit-log.interceptor.ts](../../backend/src/audit/audit-log.interceptor.ts), depois da resposta e fora da transação. Não há endpoint de leitura de `audit_logs`.

---

## 1. Usuários (login)

**Propósito.** Credencial de acesso, separada da pessoa física (`Collaborator`). Um colaborador pode existir sem login.

**Campos-chave** (`users`): `email` (único), `password_hash` (bcrypt, custo 12), `status` (`active`/`disabled`), `last_login_at`, `must_change_password` (default `false`), `collaborator_id` (único, opcional no schema).

**Regras** ([users.service.ts](../../backend/src/users/users.service.ts)):

- Criação exige `collaboratorId` existente e sem login prévio (`409` se já tiver) e ao menos um `roleId` válido.
- `email` default = `corporate_email` do colaborador; pode ser informado.
- Senha temporária: informada (mín. 8) ou gerada no servidor (`randomBytes(9)` em base64url). Criação e reset gravam `must_change_password = true`.
- A senha temporária é **devolvida na resposta** de `POST /users` e de `POST /users/:id/reset-password` (campo `temporaryPassword`), para o admin/RH copiar. Não é recuperável depois. Não há envio por e-mail (sem SMTP).
- Com `must_change_password = true`, o `JwtAuthGuard` bloqueia tudo exceto rotas marcadas com `@AllowWhilePasswordChangeRequired` (`/auth/change-password`, `/auth/logout`); o frontend redireciona para `/change-password`.
- Usuário `disabled` não loga nem renova token ([auth.service.ts](../../backend/src/auth/auth.service.ts)). O access token já emitido continua válido até expirar.
- `PUT /users/:id/roles` substitui todas as roles (delete + createMany em transação).

**Endpoints** ([users.controller.ts](../../backend/src/users/users.controller.ts)):

| Método | Rota | Permissão | Auditoria |
|---|---|---|---|
| POST | `/users` | `user:create` | `create_user` |
| GET | `/users?status&roleId&search` | `user:read` | — |
| GET | `/users/:id` | `user:read` | — |
| PUT | `/users/:id/roles` | `user:update` | `update_user_roles` |
| POST | `/users/:id/reset-password` | `user:reset_password` | `reset_user_password` |
| PUT | `/users/:id/status` | `user:update` | `set_user_status` |
| POST | `/auth/login`, `/auth/refresh` | pública | — |
| POST | `/auth/change-password`, `/auth/logout` | autenticado | — |

**Eventos de outbox:** nenhum. O planning (§3.3) previa `user.created`, `user.updated`, `user.disabled`; **não implementados**.

**Frontend:** `/users`, `/users/new`, `/users/:id/edit` ([UsersPage](../../frontend/src/pages/UsersPage.tsx), [UserFormPage](../../frontend/src/pages/UserFormPage.tsx)); `/change-password`.

## 2. Papéis e permissões (RBAC)

**Modelo.** `roles` (nome único), `permissions` (`resource` + `action`, únicos juntos, formato `recurso:ação`), `role_permissions` e `user_roles` (PK compostas).

**Endpoints** ([roles.controller.ts](../../backend/src/users/roles.controller.ts)):

| Método | Rota | Permissão | Observação |
|---|---|---|---|
| GET | `/roles` | `user:read` | com permissões de cada papel |
| GET | `/roles/permissions` | `user:read` | catálogo de permissões |
| POST | `/roles` | `user:update` | cria papel e define permissões |
| PUT | `/roles/:id` | `user:update` | substitui permissões do papel |

Criar/editar papel **não** gera auditoria nem evento. Não há exclusão de papel. O catálogo de permissões só muda pelo seed (a tela não cria permissões).

**Frontend:** `/roles` ([RolesPage](../../frontend/src/pages/RolesPage.tsx)).

### 2.1 Papéis seedados ([seed.ts](../../backend/prisma/seed.ts))

| Papel | Resumo das permissões |
|---|---|
| `admin` | todas as permissões do catálogo |
| `rh` | leitura de setor/CC/cargo/jornada; `collaborator:create/read/read_sensitive/update/delete`; `certification:*`; `request:create/read/comment/approve`; `delegation:create/read`; `user:create/read/update/reset_password` |
| `gestor` | leitura de setor/CC/cargo/jornada/certificação/cliente; `collaborator:read/update`; `project:create/read/update/read_documents`; `request_category:read`; `request:create/read/update/assign/approve/comment`; `delegation:create/read` |
| `tecnico` | `sector:read`, `collaborator:read`, `certification:read`, `request:create/read/update/comment` |
| `analista_suprimentos` | `sector:read`, `collaborator:read`, `request_category:read`, `request:create/read/update/assign/comment` |
| `colaborador` | `sector:read`, `collaborator:read`, `request:create/read/comment` |
| `compliance` | `sector:read`, `collaborator:read`, `request_category:read`, `request:read/update/approve/comment/view_whistleblower_identity` (não atribuído a ninguém por padrão) |

O seed também cria: setor `ADM` (código legado em texto), cargo `Administrador`, jornada `Comercial (8h-18h)`, o colaborador/usuário admin (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_CPF`; senha gerada e impressa no console se não informada) e uma fila padrão por setor.

### 2.2 Permissões seedadas sem rota correspondente

- `collaborator:delete` ("Desligar colaboradores"): nenhuma rota exige. O desligamento (`POST /collaborators/:id/offboard`) exige `collaborator:update`.

## 3. Setores

**Propósito.** Estrutura organizacional hierárquica; base de filas de requisição, delegações e alçadas.

**Campos-chave** (`sectors`): `code` (único, gerado), `name`, `parent_sector_id` (auto-referência, opcional), `responsible_collaborator_id` (opcional).

**Regras** ([sectors.service.ts](../../backend/src/sectors/sectors.service.ts)):

- `code` nunca é aceito do cliente.
- Raiz: `nextval('sector_root_code_seq')` (sequence com `START 100 INCREMENT 100`) → `100`, `200`, `300`…
- Filho: `<código do pai>.<n>`, `n` = quantidade de irmãos + 1, calculado dentro da transação após `SELECT code FROM sectors WHERE id = $pai FOR UPDATE` (serializa criações concorrentes sob o mesmo pai). Recursivo (`100.1.1`).
- Troca de pai não é suportada (`parentSectorId` é omitido do DTO de update).
- Códigos legados (ex.: `ADM`) não são recalculados.
- Exclusão bloqueada (`409`) se houver colaboradores, CCs, subsetores, requisições etc. vinculados.

**Risco não tratado:** `n` é contagem de irmãos, não o maior sufixo. Se um irmão do meio for excluído (ex.: existem `100.1` e `100.2`, exclui-se `100.1`), a próxima criação calcula `100.2` e falha por unicidade de `code` (erro Prisma `P2002`, não convertido em mensagem amigável). Vale também para centros de custo.

**Endpoints** ([sectors.controller.ts](../../backend/src/sectors/sectors.controller.ts)): `POST /sectors` (`sector:create`), `GET /sectors` e `GET /sectors/:id` (`sector:read`), `PUT /sectors/:id` (`sector:update`), `DELETE /sectors/:id` (`sector:delete`, 204). Sem auditoria, sem eventos.

**Frontend:** `/sectors` (árvore), `/sectors/new`, `/sectors/:id/edit`.

## 4. Centros de custo

**Campos-chave** (`cost_centers`): `code` (único, gerado), `name`, `sector_id` (obrigatório), `parent_cost_center_id` (opcional), `responsible_collaborator_id` (opcional), `kind` (`divisao`, `administrativo`, `operacional`, `equipe_tecnica`; padrão `administrativo`; a migração `20261124000000` marcou as raízes como `divisao`), `short_code` (sigla legível opcional e única, ex.: `DC-001-JAI`; maiúsculas, dígitos e hífen, até 30 caracteres; a API normaliza para maiúsculas, vazio limpa; não substitui o `code`). Situação do orçamento informada pelo Financeiro, **só leitura** na API pública: `budget_status` (`ok`/`alerta`/`estourado`), `budget_percent` (0–999), `budget_year`, `budget_status_at` (instante do cálculo). Contrato: [integracao-centros-de-custo.md §1 e §4](../integracao-centros-de-custo.md).

**Regras** ([cost-centers.service.ts](../../backend/src/cost-centers/cost-centers.service.ts)): mesmo esquema de setores, com a sequence `cost_center_root_code_seq` (100, 200…) e `FOR UPDATE` na linha do pai. Sem reparenting. Exclusão bloqueada com `409` se houver projetos, sub-CCs, requisições, histórico de alocação de colaboradores ou outros vínculos. O mesmo risco de colisão após exclusão de irmão se aplica. Sigla repetida → `409` ("Já existe um centro de custo com esta sigla."); formato inválido → `400` (também há `CHECK` no banco).

**Situação do orçamento (Financeiro → Core).** `PUT /api/v1/integration/cost-centers/:id/budget-status` ([cost-centers-integration.controller.ts](../../backend/src/cost-centers/cost-centers-integration.controller.ts)), autenticado pela API key do satélite (`Authorization: Bearer`, mesmo mecanismo da devolução da cotação do projeto) e limitado a 100/min por satélite; só o satélite que assina `cost_center.updated` pode enviar (senão `403`). Corpo `year`, `budget`, `committed`, `realized` (string com até 2 casas; número é aceito e convertido), `percent` (0–999, até 2 casas), `status`, `computed_at` (ISO 8601). Grava `budget_status`, `budget_percent`, `budget_year` e `budget_status_at = computed_at`; os valores em reais não são guardados. Cálculo mais antigo que o gravado (retry fora de ordem) é ignorado com `200` e `applied: false`. Sem usuário, não há `@AuditAction`: o serviço grava `audit_events` (`cost_center.budget_status_received` ou `cost_center.budget_status_ignored`, `source = integration:<satélite>`). Não emite evento de volta. Efeito: compra de CC `estourado` no ano corrente ganha a etapa `orcamento_cc` ([requisicoes-estado-atual.md §6](requisicoes-estado-atual.md#6-compra-de-material-kind--compra_material)).

**Divergência com o planning:** `responsible_collaborator_id` existe no schema, no DTO e no formulário, mas não está no planning §5.6.

**Endpoints:** `POST /cost-centers` (`cost_center:create`), `GET /cost-centers`, `GET /cost-centers/:id` (`cost_center:read`, incluem setor, responsável, `kind`, `shortCode` e `budget*`), `PUT /cost-centers/:id` (`cost_center:update`; aceita `kind` e `shortCode`, nunca `budget*`), `DELETE /cost-centers/:id` (`cost_center:delete`). Auditoria: `create_cost_center`, `update_cost_center`, `delete_cost_center`. Satélite: `PUT /integration/cost-centers/:id/budget-status` (acima).

**Eventos de outbox** (desde 2026-11-07, para o rateio do Financeiro): `cost_center.created` e `cost_center.updated`, sempre com o estado completo: `cost_center_id`, `code`, `name`, `sector_id`, `parent_cost_center_id`, `responsible_collaborator_id`, `kind`, `short_code` (desde 2026-11-08), `active`. A exclusão emite `cost_center.updated` com `active: false`. A situação do orçamento não gera evento.

**Frontend:** `/cost-centers` (árvore com código, sigla, tipo, setor e selo do orçamento; KPI de CCs estourados), `/cost-centers/new`, `/cost-centers/:id/edit` (tipo, sigla e, na edição, a situação do orçamento em leitura).

## 5. Cargos

**Campos-chave** (`job_titles`): `name` (único), `is_technician` (default `false`). Quando o cargo é técnico, o formulário de colaborador exibe a seção de certificações NR.

**Regras** ([job-titles.service.ts](../../backend/src/job-titles/job-titles.service.ts)): nome duplicado → `409`; exclusão com colaboradores vinculados → `409`.

**Endpoints:** `POST/GET/GET :id/PUT :id/DELETE :id` em `/job-titles` com `job_title:create|read|update|delete`. Sem auditoria, sem eventos.

**Frontend:** `/job-titles`, `/job-titles/new`, `/job-titles/:id/edit`.

## 6. Jornadas de trabalho

**Campos-chave** (`work_schedules`): `name` (não único), `start_time` e `end_time` (`HH:mm`, texto), `break_minutes` (opcional, ≥ 0), `days_of_week` (lista não vazia de `seg|ter|qua|qui|sex|sab|dom`).

**Regras** ([create-work-schedule.dto.ts](../../backend/src/work-schedules/dto/create-work-schedule.dto.ts)): validação de formato por regex. Não valida `end_time > start_time` (escalas noturnas ficam possíveis, mas também erros de digitação). Exclusão com colaboradores vinculados → `409`.

**Endpoints:** `POST/GET/GET :id/PUT :id/DELETE :id` em `/work-schedules` com `work_schedule:create|read|update|delete`. Sem auditoria, sem eventos.

**Frontend:** `/work-schedules`, `/work-schedules/new`, `/work-schedules/:id/edit`.

## 7. Colaboradores

**Propósito.** Pessoa física (funcionário/terceiro). Base de organograma, solicitantes/aprovadores de requisição, responsáveis de setor/CC/projeto.

**Campos-chave** (`collaborators`):

| Grupo | Campos |
|---|---|
| Identificação | `matricula` (única, gerada), `full_name`, `corporate_email` (único), `personal_email` |
| Sensíveis (criptografados) | `rg_enc`, `cpf_enc`, `ctps_enc`, `pis_enc` + `cpf_hash` (único) |
| Vínculo | `job_title_id`, `sector_id`, `supervisor_id` (auto-referência), `cost_center_id`, `work_schedule_id`, `management_level` (`colaborador`…`diretor`, default `colaborador`), `contract_type`, `admission_date` |
| Situação | `status` (`ativo`, `afastado`, `ferias`, `desligado`), `offboarded_at` |
| Saúde/segurança | `aso_date`, `aso_validity`, `yellow_badge` (texto, identificador do crachá) |
| Pessoais/contato | `phone`, `emergency_contact_*`, `birth_date`, `marital_status`, `gender`, `cep`, `address_*` |
| Documentos | `cnh_category`, `cnh_number`, `cnh_expires_at`, `uniform_size`, `photo_filename`, `photo_storage_path` (só metadado; não há upload binário) |

**Regras** ([collaborators.service.ts](../../backend/src/collaborators/collaborators.service.ts)):

- Matrícula: `nextval('collaborator_matricula_seq')` (começa em 0) com `padStart(4,'0')` → `0000`, `0001`… Nunca aceita do cliente.
- RG, CPF, CTPS e PIS são criptografados na aplicação com **AES-256-GCM** (IV aleatório de 12 bytes; armazena `base64(iv + authTag + ciphertext)`), chave `FIELD_ENCRYPTION_KEY` (64 hex) — [field-encryption.service.ts](../../backend/src/common/crypto/field-encryption.service.ts).
- Unicidade de CPF via `cpf_hash = sha256(chave ‖ cpf)`. CPF duplicado → `409`. O hash é calculado sobre a string recebida, sem normalização: o frontend envia o CPF **com máscara** (`000.000.000-00`); uma chamada de API com CPF só em dígitos geraria outro hash e escaparia da checagem.
- Leitura padrão (`GET /collaborators`, `/:id`, `/me`, `/org-chart`) devolve a visão segura, sem RG/CPF/CTPS/PIS.
- `GET /collaborators/:id/sensitive` (`collaborator:read_sensitive`) descriptografa e grava `sensitive_data_access_logs` (colaborador, usuário, campos `rg,cpf,ctps,pis`) — log de acesso exigido pela LGPD. Consulta em `GET /sensitive-access-logs` (filtros `collaboratorId`, `actorUserId`, `from`, `to`, paginação até 200).
- Supervisor: não pode ser o próprio colaborador nem criar ciclo (percorre a cadeia para cima).
- Organograma: floresta montada a partir de colaboradores `ativo`/`afastado`/`ferias`.
- Desligamento: `POST /collaborators/:id/offboard` grava `status = desligado` e `offboarded_at = now()` e emite `collaborator.offboarded`. Desde 2026-11-08 o `PUT` com `status = desligado` (caminho da tela) tem o mesmo efeito: preenche `offboarded_at` e emite `collaborator.offboarded` além de `collaborator.updated`. Não desativa o usuário de login vinculado.
- **Alocação em centro de custo com vigência** (desde 2026-11-08, [integracao-centros-de-custo.md §2](../integracao-centros-de-custo.md#2-core-alocação-do-colaborador-no-cc-com-vigência)): tabela `collaborator_cost_center_allocations` (`collaborator_id`, `cost_center_id`, `valid_from`, `valid_to` — datas `DATE`; `valid_to` exclusivo, o último dia é o anterior; nulo = vigente; índice único parcial garante uma vigente por colaborador). `cost_center_id` do colaborador continua sendo o CC atual.
  - Criação com CC abre a alocação a partir de `admission_date` (ou de hoje em São Paulo).
  - `PUT` que troca o CC fecha a vigente e abre outra a partir de `costCenterEffectiveFrom` (opcional, `AAAA-MM-DD`; padrão = hoje em São Paulo); data anterior ao início da vigente → `400`. Mesma data do início da vigente fecha a anterior com período vazio. `costCenterId: null` fecha a vigente sem abrir outra. Colaborador desligado: trocar o CC não abre alocação.
  - Desligamento (`POST /:id/offboard` ou `PUT` com `status = desligado`) fecha a vigente na data do desligamento (São Paulo). Reativar (`desligado` → outro status) abre nova alocação no CC atual a partir de `costCenterEffectiveFrom` ou de hoje.
  - A migração `20261124000001` criou uma alocação para quem já tinha CC, a partir de `admission_date` (ou `created_at` no dia de São Paulo); desligados ganharam a alocação já fechada em `offboarded_at` (ou `updated_at`).
- Retenção: **indefinida**. Não há exclusão de colaborador nem rotina de expurgo/anonimização (decisão registrada no planning §4.2 e §7).

**Divergências e lacunas verificadas:**

- `cnh_number`, `phone`, `emergency_contact_phone`, endereço completo e `birth_date` ficam em **texto puro**. O planning também pedia ASO criptografado; `aso_date`/`aso_validity` estão em texto puro.
- O frontend **não chama** `GET /collaborators/:id/sensitive` (`getSensitive` existe em [api/collaborators.ts](../../frontend/src/api/collaborators.ts), sem uso). Na edição, RG/CPF chegam vazios e só são regravados se o usuário digitar novos valores.
- O frontend **não chama** `POST /:id/offboard`. A tela de edição oferece `status = desligado` num select e grava via `PUT /collaborators/:id` (desde 2026-11-08 com o mesmo efeito do `offboard`, ver Regras).
- A tela não permite limpar o centro de custo (o select vazio não envia `costCenterId`); a API aceita `costCenterId: null`.
- No update, `ctps`/`pis` são regravados sempre que vierem no corpo (`!== undefined`), inclusive string vazia — limpar o campo na tela grava a criptografia de `''`.
- RG com dígito `X` não é digitável: a máscara aceita só dígitos (ver [diretrizes](../diretrizes-desenvolvimento.md#10-backlog-de-padronização-de-campos)).

**Endpoints** ([collaborators.controller.ts](../../backend/src/collaborators/collaborators.controller.ts), [sensitive-access-log.controller.ts](../../backend/src/collaborators/sensitive-access-log.controller.ts)):

| Método | Rota | Permissão | Auditoria |
|---|---|---|---|
| GET | `/collaborators/me` | `collaborator:read` | — |
| POST | `/collaborators` | `collaborator:create` | `create_collaborator` |
| GET | `/collaborators` | `collaborator:read` | — |
| GET | `/collaborators/org-chart` | `collaborator:read` | — |
| GET | `/collaborators/:id` | `collaborator:read` | — |
| GET | `/collaborators/:id/cost-center-history` | `collaborator:read` | — |
| GET | `/collaborators/:id/sensitive` | `collaborator:read_sensitive` | log em `sensitive_data_access_logs` |
| PUT | `/collaborators/:id` | `collaborator:update` | `update_collaborator` |
| POST | `/collaborators/:id/offboard` | `collaborator:update` | `offboard_collaborator` |
| GET | `/sensitive-access-logs` | `collaborator:read_sensitive` | — |

**Eventos de outbox:**

| Evento | Quando | Payload |
|---|---|---|
| `collaborator.created` | criação | estado: `collaborator_id`, `name`, `status`, `sector_id`, `cost_center_id`, `job_title_id`, `job_title_name`, `admission_date` (`AAAA-MM-DD` ou `null`) |
| `collaborator.updated` | `PUT` | o mesmo estado + `changed_fields` (chaves do corpo) |
| `collaborator.offboarded` | `POST /:id/offboard`; `PUT` que muda o status para `desligado` | `collaborator_id`, `offboarded_at` |
| `collaborator.cost_center_changed` | criação com CC, troca de CC, desligamento, reativação com CC | `collaborator_id`, `name`, `job_title_id`, `job_title_name`, `previous_cost_center_id` (ou `null`), `cost_center_id` (`null` no desligamento ou ao limpar), `valid_from` (`AAAA-MM-DD`) |

O planning previa flags de provisionamento no `collaborator.created`; não estão no payload.

**Frontend:** `/collaborators` (lista + organograma), `/collaborators/new`, `/collaborators/:id/edit` (formulário em etapas; em "Dados funcionais", ao trocar o CC aparece "No novo centro de custo a partir de" e, na edição, o histórico de centros de custo), `/sensitive-access-log`.

## 8. Certificações técnicas (NR)

**Campos-chave** (`technician_certifications`): `collaborator_id` (cascade on delete), `type` (`NR10`, `NR35`, `NR12`, `NR18`), `issued_at`, `expires_at` (indexado).

**Regras** ([certifications.service.ts](../../backend/src/certifications/certifications.service.ts)):

- Não valida `expires_at > issued_at` nem se o cargo do colaborador é técnico.
- `GET /certifications/expiring?windowDays=N` lista vencidas ou vencendo em N dias (default 30).
- Cron diário às 06:00 (`EVERY_DAY_AT_6AM`) só **escreve no log** da aplicação; não notifica ninguém. O alerta visível é o dropdown de notificações do frontend, que consulta `expiring(30)`.

**Endpoints:** `POST /certifications` (`certification:create`), `GET /certifications/expiring` e `GET /certifications/collaborator/:collaboratorId` (`certification:read`), `PUT /certifications/:id` (`certification:update`), `DELETE /certifications/:id` (`certification:delete`). Sem auditoria, sem eventos.

**Frontend:** sem rota própria; criadas na etapa de certificações do formulário de colaborador. A UI só cria e lista; editar/excluir certificação não tem tela.

## 9. Clientes

**Campos-chave** (`clients`): `code` (inteiro único, gerado), `legal_name`, `cnpj` (único, opcional, até 18 caracteres), `contacts` (JSON), `address` (JSON).

**Regras** ([clients.service.ts](../../backend/src/clients/clients.service.ts)):

- `code = nextval('client_code_seq')` (`START 100 INCREMENT 100`) → `100`, `200`, `300`…
- Exclusão com projetos vinculados → `409`.
- CNPJ não tem validação de dígito verificador nem de formato no backend.

**Divergências e lacunas:**

- `contacts` é tipado como lista no DTO, mas validado com `@IsObject()`, que no class-validator **rejeita arrays**: enviar uma lista de contatos resulta em `400`. A UI não exercita isso, porque o formulário só tem razão social e CNPJ — contatos e endereço não são editáveis pela tela.
- Sem auditoria em criação/edição/exclusão.

**Endpoints:** `POST /clients` (`client:create`), `GET /clients`, `GET /clients/:id` (`client:read`), `PUT /clients/:id` (`client:update`), `DELETE /clients/:id` (`client:delete`).

**Eventos de outbox:** `client.created` (`client_id`, `code`); `client.updated` (`client_id`, `changed_fields`).

**Frontend:** `/clients`, `/clients/new`, `/clients/:id/edit`. A edição do cliente tem a seção **Sites** (§9.1).

### 9.1 Sites

Local de obra ou de entrega de um cliente (ex.: `GRU53`). Cadastro do Core usado pela Logística (endereço de entrega), pelo Financeiro e pelo Field, que precisam falar do mesmo site (decisão PA-05 do plano "projeto aprovado → obra"). Um projeto tem um site; proposta com vários sites vira vários projetos (PA-06).

**Campos-chave** (`sites`, [schema.prisma](../../backend/prisma/schema.prisma)):

- `client_id` (obrigatório; **não muda** depois de criado);
- `code` (texto informado por quem cadastra, em maiúsculas, `^[A-Z0-9][A-Z0-9._-]{0,19}$`, ex.: `GRU53`) e `name`. O par (`client_id`, `code`) é único. O código **não é gerado**: é um código de negócio do cliente, por isso entra no DTO (exceção consciente à regra de códigos gerados das [diretrizes §6](../diretrizes-desenvolvimento.md));
- endereço no mesmo padrão de colunas do cliente: `cep` (só os 8 dígitos), `address_street`, `address_number`, `address_complement`, `address_district`, `address_city`, `address_state` (UF com 2 letras). Todos opcionais;
- `latitude` (−90 a 90) e `longitude` (−180 a 180), opcionais, `DOUBLE PRECISION` (a API devolve número, não texto);
- `active` (padrão `true`) e `created_at`/`updated_at`.

**Regras** ([sites.service.ts](../../backend/src/sites/sites.service.ts)):

- Cliente inexistente na criação → `400`. Código repetido no mesmo cliente (criar ou editar) → `409` "Já existe um site com este código para o cliente.".
- **Não há exclusão.** Site sai de uso inativado (`PUT /sites/:id` com `active: false`; reativar é `active: true`). Site inativo não pode ser escolhido num projeto (`400`), mas projeto que já o guarda continua editável.
- `PUT` só grava o que veio no corpo **e mudou de verdade**; sem mudança real não grava nem emite evento. `code` e `name` não aceitam `null`; os demais campos opcionais aceitam `null` para limpar.

**Endpoints** ([sites.controller.ts](../../backend/src/sites/sites.controller.ts)): `GET /sites` (filtros `?clientId=` e `?active=true|false`) e `GET /sites/:id` (`site:read`), `POST /sites` (`site:create`, auditado como `create_site`), `PUT /sites/:id` (`site:update`, auditado como `update_site`).

**Permissões:** `site:read`, `site:create`, `site:update` (não existe `site:delete`). A migração `20261126000000_sites` e o [seed.ts](../../backend/prisma/seed.ts) dão cada uma aos papéis que já têm a permissão equivalente de clientes: `admin` (todas) e `gestor` (`site:read`, pois só tem `client:read`).

**Eventos de outbox** (mesma transação da escrita; estado completo em todos): `site.created` e `site.updated` (este traz também `changed_fields`), com `site_id`, `client_id`, `code`, `name`, `cep`, `address_street`, `address_number`, `address_complement`, `address_district`, `address_city`, `address_state`, `latitude`, `longitude`, `active`. Inativar vai como `site.updated` com `active: false`. O botão **Integrações → Reenviar cadastros** também reenvia todos os sites como `site.updated` ([integracao-centros-de-custo.md §6](../integracao-centros-de-custo.md#6-core-reenvio-dos-cadastros-carga-inicial-do-satélite)).

**Consulta por API key** (satélites): `GET /api/v1/integration/sites` (filtros `client_id`, `code`, `active`, `page`, `per_page`; envelope `{data, meta}`) e `GET /api/v1/integration/sites/:id`.

**Frontend:** a seção **Sites** na edição do cliente lista os sites (código, nome, endereço, situação) com **+ Novo site**, **Editar** e **Inativar/Reativar**; o formulário fica em `/clients/:clientId/sites/new` (`site:create`) e `/clients/:clientId/sites/:id/edit` (`site:update`), com busca de endereço por CEP (ViaCEP) e coordenadas opcionais (aceita vírgula decimal).

## 10. Projetos

**Campos-chave** (`projects`): `code` (único, gerado), `name`, `client_id`, `cost_center_id`, `responsible_collaborator_id`, `site_id` (opcional, ver abaixo), `planned_start_date` e `planned_end_date` (`DATE`, opcionais), `status` (`proposta`, `aprovado`, `em_execucao`, `encerrado`; default `proposta`), `proposal_sequence`.

**Regras** ([projects.service.ts](../../backend/src/projects/projects.service.ts)):

- Código `PROP-{código do cliente}.{seq}-{MMAA}`: `seq = nextval('project_proposal_seq')`, global (não por cliente), com 3 dígitos (`padStart(3,'0')`); `MMAA` do momento da criação **em `America/Sao_Paulo`** (antes vinha do fuso do processo). Ex.: `PROP-100.001-1126`.
- Nome (até 200 caracteres) obrigatório na API para criar e editar; a edição não aceita apagar o nome. A coluna é opcional no banco: projetos criados antes de 2026-11-07 ficam sem nome até alguém editar (a lista mostra "Sem nome — editar" e um indicador "Sem nome").
- Datas previstas em `AAAA-MM-DD`; a conclusão não pode ser antes do início (`400` e `CHECK` no banco). Na edição, `null` apaga a data.
- O cliente não muda depois de criado (faz parte do código).
- **Site do projeto** (`site_id`, PA-05): opcional na criação e na edição (`siteId` no corpo; `null` desvincula). O servidor confere que o site **existe, está ativo e é do mesmo cliente do projeto**; senão `400` ("Site não encontrado.", "O site não pertence ao cliente do projeto.", "O site está inativo. Escolha outro site ou reative este."). Na edição só confere quando o site muda, então projeto cujo site foi inativado depois segue editável. **Hoje o site não é exigido para aprovar**: a exigência entra com o PT-06 do plano de aprovação, que vai validar `site_id` na transição para `aprovado`.
- Transições de status permitidas: `proposta → aprovado | encerrado`; `aprovado → em_execucao | encerrado`; `em_execucao → encerrado`; `encerrado` é final. Outras → `400`.
- A criação aceita `status` arbitrário (não passa pela máquina de transição).
- `PUT /projects/:id` altera nome, centro de custo, responsável, site e datas previstas.
- `DELETE /projects/:id` é exclusão física e só vale para projeto em `proposta` sem requisições; nos outros casos responde `409` e o caminho é encerrar o projeto.

**Endpoints:** `POST /projects` (`project:create`, auditoria `create_project`), `GET /projects`, `GET /projects/:id` (`project:read`), `PUT /projects/:id` (`project:update`, `update_project`), `PUT /projects/:id/status` (`project:update`, `change_project_status`), `DELETE /projects/:id` (`project:delete`, `delete_project`).

**Eventos de outbox.** Todo evento `project.*` leva o estado completo do projeto, para o cache dos satélites (o Financeiro usa nome e centro de custo no orçamento e no rateio — decisão P-07 da especificação de Projetos do Financeiro):

`project_id`, `code`, `name`, `status`, `client_id`, `cost_center_id`, `cost_center_code`, `cost_center_name`, `responsible_collaborator_id`, `site_id`, `site_code`, `site_name` (os três `null` enquanto o projeto não tem site; o endereço do site **não** vai aqui, está nos eventos `site.*` do §9.1), `planned_start_date`, `planned_end_date` (`AAAA-MM-DD` ou `null`).

| Evento | Quando | Campos extras |
|---|---|---|
| `project.created` | criação | — |
| `project.updated` | `PUT /projects/:id` | `changed_fields` (inclui `siteId` quando o site muda) |
| `project.status_changed` | `PUT /projects/:id/status` | `previous_status` |
| `project.deleted` | exclusão de proposta | `deleted: true`; `status` vai como `encerrado` para os satélites marcarem o projeto inativo sem mudança do lado deles |

No formulário do projeto, o seletor **Site** (visível com `site:read`) lista só os sites do cliente escolhido e oferece os ativos mais o site atual do projeto (marcado "(inativo)" se for o caso); trocar o cliente na criação limpa o site. Sem `site:read` o formulário não mexe no site do projeto.

### 10.1 Documentos do projeto (SOW e Bid Template)

A SOW do cliente e o Bid Template do RFQ ficam anexados ao projeto do Core e são consumidos pelo módulo Projetos do Financeiro (importação da SOW, §7.1, e Bid preenchida, §7.4, da especificação de Projetos do Financeiro).

- **Tipos:** `sow` e `bid_template` (desde 2026-11-08, migração `20261123000003_projetos_bid_template`). O Bid Template é a planilha da proposta que o cliente manda em cada RFQ, já com os dados do projeto; só aceita `.xlsx`/`.xlsm` (ZIP pelos bytes), senão `400`.

- Tabela `project_documents`: `project_id`, `kind` (`sow` ou `bid_template`), `version`, `filename` (nome original sem caminho, só para exibição), `mime_type`, `size_bytes`, `content_hash` (SHA-256), `content` (`BYTEA`), `uploaded_by_user_id`, `created_at`. Único por (`project_id`, `kind`, `version`).
- **Versões:** cada envio do mesmo tipo cria a versão seguinte; nenhuma versão é sobrescrita nem apagada. A mais recente é a vigente. Os documentos só somem com a exclusão do projeto (que só vale para proposta sem requisições).
- **Arquivo:** mesmas regras dos anexos de requisição ([attachment-security.ts](../../backend/src/requests/attachment-security.ts)): tipo detectado pelos bytes (PDF, PNG, JPG e ZIP, que cobre DOCX/XLSX), executáveis bloqueados, até 25MB, conteúdo em base64 no corpo JSON. **Não há antivírus de verdade.**
- **Permissões:** enviar exige `project:update`; listar e baixar exige `project:read_documents` (nova; dada a `admin` e `gestor` pela migração `20261123000001_projetos_documentos` e pelo seed), porque a SOW é documento do cliente.

| Método | Rota | Permissão | Auditoria |
|---|---|---|---|
| POST | `/projects/:id/documents` (`kind`, `filename`, `contentBase64`) | `project:update` | `upload_project_document` |
| GET | `/projects/:id/documents` (metadados, sem conteúdo) | `project:read_documents` | — |
| GET | `/projects/:id/documents/:documentId/content` | `project:read_documents` | `download_project_document` |

O download devolve o arquivo com `Content-Disposition` (nome original) e `X-Content-SHA256`.

**Evento `project.document_added`** (na mesma transação do envio): `project_id`, `code`, `document_id`, `kind`, `version`, `filename`, `mime_type`, `size_bytes`, `content_hash`, `uploaded_at`. Não leva o conteúdo.

**Satélites (API key):** `GET /api/v1/integration/projects/:id/documents` e `GET /api/v1/integration/projects/:id/documents/:documentId/content`. Só respondem ao satélite que **assina** `project.document_added`; os outros recebem `403`. O Financeiro também pode baixar com o token do usuário (rotas acima), respeitando `project:read_documents`.

**Frontend:** `/projects` (lista com nome, prazo previsto, troca de status na linha e exclusão de propostas), `/projects/new` (SOW opcional, enviada logo depois de criar o projeto; se o envio falhar, abre a edição com o aviso), `/projects/:id/edit` (o nome na lista abre a edição; seção "SOW do cliente" com envio de nova versão, lista de versões e download), `/projects/dashboard`. A seleção de projeto na nova requisição mostra `código — nome`.

### 10.2 Cotação pelo Financeiro

O comercial pede a cotação no Core e o módulo Projetos do Financeiro devolve, a cada revisão aprovada
para envio, a **Bid preenchida** e a **equipe orçada** (quantidade por função × dias). Custo, salário e
lucro nunca vêm para o Core. Contrato: [integracao-core-financeiro.md §4](../integracao-core-financeiro.md#4-cotação-do-projeto).

- **Pedido** (`project_quote_requests`): `project_id`, `sow_document_id` e `bid_template_document_id`
  (as versões vigentes no momento), `notes` (recado para o orçamentista, até 2000 caracteres),
  `requested_by_user_id`, `created_at`. Só projeto em `proposta` e com SOW **e** Bid Template (`400`
  nos outros casos). Pode ser repetido (ex.: SOW nova); cada
  pedido fica no histórico e emite `project.quote_requested`.
- **Cotação** (`project_quotes`): uma por revisão do Financeiro, única por (`satellite_id`,
  `external_revision_id`). Guarda `revision_number`, a SOW usada, `work_days`, início e conclusão
  previstos da cotação (não mudam o prazo do projeto), `team` (por função: `role_key`, `role_name`,
  `field_role`, `people`, `days`, `hours`), `field_people` e `total_hours` somados, quem aprovou o
  envio no Financeiro e a Bid (`bid_*`, `BYTEA`, SHA-256; **opcional**, nula no modelo `generico`, e as cinco
  colunas `bid_*` ficam todas nulas ou todas preenchidas, migração `20261125000001_projetos_cotacao_bid_opcional`).
  A de maior revisão é a vigente.
- **Materiais da cotação** (`project_quote_materials`, migração `20261125000000_projetos_cotacao_materiais`):
  `project_quote_id`, `material_code` (código do catálogo da Logística; único por cotação), `description`,
  `unit`, `quantity` (`NUMERIC(14,3)`) e `logistics_material_id` (nulo por enquanto; o servidor o resolverá
  consultando a Logística no PT-06). Sem preço, custo nem frete. Apagados junto com a cotação. Alimentam,
  no PT-06, a requisição de envio de material ao aprovar o projeto.
- **Situação** mostrada na tela: `nao_solicitada`, `aguardando` (há pedido mais novo que a última
  cotação) e `recebida`.
- **Permissões:** pedir exige `project:update`; ver a cotação e baixar a Bid exige
  `project:read_documents` (a Bid traz os valores cobrados do cliente).

| Método | Rota | Permissão | Auditoria |
|---|---|---|---|
| POST | `/projects/:id/quote-requests` (`notes?`) | `project:update` | `request_project_quote` |
| GET | `/projects/:id/quotes` (situação, pedidos e cotações com `materials[]`, sem a Bid) | `project:read_documents` | — |
| GET | `/projects/:id/quotes/:quoteId/bid` | `project:read_documents` | `download_project_bid` |

**Evento `project.quote_requested`** (na mesma transação do pedido): estado completo do projeto (§10)
mais `quote_request_id`, `sow_document_id`, `sow_version`, `sow_filename`, `sow_content_hash`,
`bid_template_document_id`, `bid_template_version`, `bid_template_filename`, `bid_template_content_hash`, `notes`,
`requested_by_user_id`, `requested_by_email`, `requested_at`.

**Satélite (API key):** `POST /api/v1/integration/projects/:id/quotes`, só para o satélite que
**assina** `project.quote_requested` (`403` para os outros). `materials[]` é opcional (`material_code`,
`description`, `unit`, `quantity` em texto com até 3 casas; `material_code` repetido, quantidade zero ou campo
extra como preço → `400`). Reenviar a mesma revisão com a mesma Bid e os mesmos materiais devolve a cotação
gravada; com outros materiais → `409`. `bid` também é opcional: sem ele a idempotência compara equipe, dias,
datas, SOW, revisão e materiais (diferença → `409`), e `GET /projects/:id/quotes/:quoteId/bid` responde `404`. Sem `@AuditAction`, porque não há usuário: a
cotação guarda o satélite que enviou.

**Frontend:** seção "Bid Template do cliente" (envio de versões e download, como a SOW) e seção "Cotação do Financeiro" em `/projects/:id/edit`: situação, botão "Solicitar
cotação" (com recado opcional; só em proposta), cartões por revisão (dias, pessoas em campo, horas,
equipe por função, **lista de materiais** com código, descrição, unidade e quantidade, download da Bid; sem Bid, "Sem Bid (orçamento genérico)") e histórico de pedidos.

---

## 11. Divergências em relação ao planning v0.2

| Tema | Planning | Código |
|---|---|---|
| Rotas de formulário | `/<módulo>/novo`, `/<módulo>/:id/editar` | `/new` e `/:id/edit` ([App.tsx](../../frontend/src/App.tsx)) |
| Edição de projeto | prevista na convenção de formulário | sem rota de edição no frontend |
| `cost_centers.responsible_collaborator_id` | não existe | existe (schema, DTO, tela) |
| Dados sensíveis criptografados | CPF, RG, CTPS, PIS, ASO | CPF, RG, CTPS, PIS; ASO, CNH, telefone e endereço em texto puro |
| Eventos `user.*` | `user.created/updated/disabled` | não emitidos |
| Desligamento | `POST /collaborators/:id/offboard` | existe, mas a UI usa `PUT` com `status = desligado` |
| Permissões | — | `collaborator:delete` seedada sem rota |
| `users.collaborator_id` | nullable (contas de serviço) | nullable no schema, mas obrigatório no DTO de criação |
| Auditoria | criação de usuário, troca de role, (des)ativação | implementada para usuários e colaboradores; ausente em papéis, setores, CCs, cargos, jornadas, certificações, clientes e projetos |
| Contatos/endereço de cliente | JSON editável | sem campo na tela; `contacts` em lista é rejeitado pela validação |

## 12. Não verificado

- Drift das tabelas `bpm_*` (ver [arquitetura.md](../arquitetura.md)). `migrate deploy` em banco vazio foi exercitado em 2026-11-08 num banco `_test` e aplicou todas as migrações, inclusive `20261126000000_sites`, sem diferença para o schema.
- Se o `OutboxDispatcherService` entrega os eventos acima a satélites reais em produção.
- Testes automatizados: não há testes de backend nem de frontend cobrindo os cadastros (só `test/a24-auth-refresh-password.e2e-spec.ts` cobre refresh/troca de senha). Exceção: sites e o site do projeto têm testes de serviço com Prisma simulado (`sites.service.spec.ts`, `projects.service.spec.ts`).
- Sites: o trecho de permissões da migração foi testado no banco `_test` (concede aos papéis certos e reaplicar não duplica). **Não** foram exercitados com HTTP real nem no navegador: `/sites`, `/integration/sites`, o `PermissionsGuard` nas rotas novas e as telas (seção Sites do cliente, formulário do site, seletor no projeto).

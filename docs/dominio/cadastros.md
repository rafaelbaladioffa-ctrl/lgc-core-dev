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
| `gestor` | leitura de setor/CC/cargo/jornada/certificação/cliente; `collaborator:read/update`; `project:create/read/update`; `request_category:read`; `request:create/read/update/assign/approve/comment`; `delegation:create/read` |
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

**Campos-chave** (`cost_centers`): `code` (único, gerado), `name`, `sector_id` (obrigatório), `parent_cost_center_id` (opcional), `responsible_collaborator_id` (opcional).

**Regras** ([cost-centers.service.ts](../../backend/src/cost-centers/cost-centers.service.ts)): mesmo esquema de setores, com a sequence `cost_center_root_code_seq` (100, 200…) e `FOR UPDATE` na linha do pai. Sem reparenting. Exclusão bloqueada com `409` se houver projetos, sub-CCs ou outros vínculos. O mesmo risco de colisão após exclusão de irmão se aplica.

**Divergência com o planning:** `responsible_collaborator_id` existe no schema, no DTO e no formulário, mas não está no planning §5.6.

**Endpoints:** `POST /cost-centers` (`cost_center:create`), `GET /cost-centers`, `GET /cost-centers/:id` (`cost_center:read`, incluem setor e responsável), `PUT /cost-centers/:id` (`cost_center:update`), `DELETE /cost-centers/:id` (`cost_center:delete`). Sem auditoria, sem eventos.

**Frontend:** `/cost-centers`, `/cost-centers/new`, `/cost-centers/:id/edit`.

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
- Desligamento: `POST /collaborators/:id/offboard` grava `status = desligado` e `offboarded_at = now()` e emite `collaborator.offboarded`. Não desativa o usuário de login vinculado.
- Retenção: **indefinida**. Não há exclusão de colaborador nem rotina de expurgo/anonimização (decisão registrada no planning §4.2 e §7).

**Divergências e lacunas verificadas:**

- `cnh_number`, `phone`, `emergency_contact_phone`, endereço completo e `birth_date` ficam em **texto puro**. O planning também pedia ASO criptografado; `aso_date`/`aso_validity` estão em texto puro.
- O frontend **não chama** `GET /collaborators/:id/sensitive` (`getSensitive` existe em [api/collaborators.ts](../../frontend/src/api/collaborators.ts), sem uso). Na edição, RG/CPF chegam vazios e só são regravados se o usuário digitar novos valores.
- O frontend **não chama** `POST /:id/offboard`. A tela de edição oferece `status = desligado` num select e grava via `PUT /collaborators/:id`: nesse caminho `offboarded_at` **não é preenchido** e o evento emitido é `collaborator.updated`, não `collaborator.offboarded`.
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
| GET | `/collaborators/:id/sensitive` | `collaborator:read_sensitive` | log em `sensitive_data_access_logs` |
| PUT | `/collaborators/:id` | `collaborator:update` | `update_collaborator` |
| POST | `/collaborators/:id/offboard` | `collaborator:update` | `offboard_collaborator` |
| GET | `/sensitive-access-logs` | `collaborator:read_sensitive` | — |

**Eventos de outbox:**

| Evento | Quando | Payload |
|---|---|---|
| `collaborator.created` | criação | `collaborator_id`, `name`, `sector_id` |
| `collaborator.updated` | `PUT` | `collaborator_id`, `changed_fields` (chaves do corpo) |
| `collaborator.offboarded` | `POST /:id/offboard` | `collaborator_id`, `offboarded_at` |

O planning previa `cost_center_id` e flags de provisionamento no `collaborator.created`; não estão no payload.

**Frontend:** `/collaborators` (lista + organograma), `/collaborators/new`, `/collaborators/:id/edit` (formulário em etapas), `/sensitive-access-log`.

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

**Frontend:** `/clients`, `/clients/new`, `/clients/:id/edit`.

## 10. Projetos

**Campos-chave** (`projects`): `code` (único, gerado), `client_id`, `cost_center_id`, `responsible_collaborator_id`, `status` (`proposta`, `aprovado`, `em_execucao`, `encerrado`; default `proposta`), `proposal_sequence`.

**Regras** ([projects.service.ts](../../backend/src/projects/projects.service.ts)):

- Código `PROP-{código do cliente}.{seq}-{MMAA}`: `seq = nextval('project_proposal_seq')`, global (não por cliente), com 3 dígitos (`padStart(3,'0')`); `MMAA` do momento da criação. Ex.: `PROP-100.001-1126`.
- O mês/ano vem de `new Date()` no **fuso do processo** do backend. Não há `TZ` definido no `docker-compose.yml`; em container UTC, um projeto criado após 21:00 (horário de Brasília) do último dia do mês recebe o mês seguinte.
- Transições de status permitidas: `proposta → aprovado | encerrado`; `aprovado → em_execucao | encerrado`; `em_execucao → encerrado`; `encerrado` é final. Outras → `400`.
- A criação aceita `status` arbitrário (não passa pela máquina de transição).
- `PUT /projects/:id` só altera `cost_center_id` e `responsible_collaborator_id`; não emite evento nem audita.
- `DELETE /projects/:id` é exclusão física.

**Endpoints:** `POST /projects` (`project:create`), `GET /projects`, `GET /projects/:id` (`project:read`), `PUT /projects/:id` e `PUT /projects/:id/status` (`project:update`), `DELETE /projects/:id` (`project:delete`). Sem auditoria.

**Eventos de outbox:** `project.created` (`project_id`, `code`, `status`, `client_id`); `project.status_changed` (`project_id`, `code`, `status`).

**Frontend:** `/projects` (lista com troca de status na linha), `/projects/new`, `/projects/dashboard`. **Não existe `/projects/:id/edit`**: `PUT /projects/:id` e `DELETE /projects/:id` não têm tela.

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

- Comportamento de `migrate deploy` em banco vazio e drift das tabelas `bpm_*` (ver [arquitetura.md](../arquitetura.md)).
- Se o `OutboxDispatcherService` entrega os eventos acima a satélites reais em produção.
- Testes automatizados: não há testes de backend nem de frontend cobrindo os cadastros (só `test/a24-auth-refresh-password.e2e-spec.ts` cobre refresh/troca de senha).

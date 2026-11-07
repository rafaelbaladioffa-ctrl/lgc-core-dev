# Checklist de QA por rota

Propósito: inventário de QA de cada rota do frontend do Core — permissão, migração de tema, tratamento de erro de API, teste e responsividade — e lacunas de navegação.
Data: 2026-11-07. Fontes: [App.tsx](../../frontend/src/App.tsx), [AppLayout.tsx](../../frontend/src/components/layout/AppLayout.tsx), páginas em [frontend/src/pages](../../frontend/src/pages), testes em `frontend/tests` e `frontend/e2e`; substitui [design-migration-checklist.md](../arquivo/design-migration-checklist.md) (as rotas `/requests/bpm/**` foram removidas do código e saíram da lista).

## Critérios das colunas

- **Permissão:** valor de `PrivateRoute permission` em `App.tsx`. "autenticado" = só login. Sem a permissão, a rota redireciona para `/dashboard` sem mensagem.
- **Tema migrado:** `sim` = usa componentes/tokens e no máximo 3 estilos inline, sem hex fixo; `parcial` = mais de 3 blocos `style={{...}}` ou cores hex fixas na página (contagem por busca estática).
- **Trata erro de API:** `sim` = todas as chamadas da página têm `try/catch` ou `.catch` com mensagem; `parcial` = só algumas (tipicamente o submit ou a exclusão); `não` = nenhuma. Não existe tratamento global: o interceptor do axios só cuida de 401/refresh.
- **Testado:** `não` salvo teste automatizado da tela. Os testes atuais de `frontend/tests` (exceto `mobile-navigation`) e `frontend/e2e/a23-mobile.spec.ts` cobrem o BPM removido e importam módulos inexistentes (`src/features/requisicoes-bpm/...`).
- **Responsivo:** `não verificado`, salvo evidência. Único indício: `tests/mobile-navigation.test.tsx` testa o botão de menu do `AppLayout` a 390px (vale para o shell, não para o conteúdo; esse teste mocka um módulo BPM que não existe mais — execução não verificada).

## Rotas

| Rota | Página | Permissão | Tema migrado | Trata erro de API | Testado | Responsivo |
|---|---|---|---|---|---|---|
| `/login` | LoginPage | pública | parcial (23 inline, hex) | sim | não | não verificado |
| `/change-password` | ChangePasswordPage | autenticado (`RequireAuthOnly`) | parcial (13 inline) | sim | não (API coberta por `backend/test/a24-auth-refresh-password.e2e-spec.ts`) | não verificado |
| `/dashboard` | DashboardPage | autenticado | parcial (13 inline, cores fixas de gráfico) | não | não | não verificado |
| `/collaborators` | CollaboratorsPage | `collaborator:read` | parcial (6 inline) | parcial (organograma sim; lista não) | não | não verificado |
| `/collaborators/new` | CollaboratorFormPage | `collaborator:create` | parcial (70 inline) | parcial (submit sim; carga das listas não) | não | não verificado |
| `/collaborators/:id/edit` | CollaboratorFormPage | `collaborator:update` | parcial (70 inline) | parcial (carga do registro sem catch: erro deixa a tela em "carregando") | não | não verificado |
| `/job-titles` | JobTitlesPage | `job_title:read` | sim | parcial (exclusão sim; lista não) | não | não verificado |
| `/job-titles/new` | JobTitleFormPage | `job_title:create` | sim | sim | não | não verificado |
| `/job-titles/:id/edit` | JobTitleFormPage | `job_title:update` | sim | parcial (carga sem catch) | não | não verificado |
| `/work-schedules` | WorkSchedulesPage | `work_schedule:read` | sim | parcial (exclusão sim; lista não) | não | não verificado |
| `/work-schedules/new` | WorkScheduleFormPage | `work_schedule:create` | parcial (5 inline) | sim | não | não verificado |
| `/work-schedules/:id/edit` | WorkScheduleFormPage | `work_schedule:update` | parcial (5 inline) | parcial (carga sem catch) | não | não verificado |
| `/sectors` | SectorsPage | `sector:read` | parcial (6 inline) | parcial (exclusão sim; lista não) | não | não verificado |
| `/sectors/new` | SectorFormPage | `sector:create` | sim | parcial (submit sim; lista de setores pai não) | não | não verificado |
| `/sectors/:id/edit` | SectorFormPage | `sector:update` | sim | parcial (carga sem catch) | não | não verificado |
| `/cost-centers` | CostCentersPage | `cost_center:read` | parcial (7 inline) | parcial (exclusão sim; lista não) | não | não verificado |
| `/cost-centers/new` | CostCenterFormPage | `cost_center:create` | sim | parcial (submit sim; listas não) | não | não verificado |
| `/cost-centers/:id/edit` | CostCenterFormPage | `cost_center:update` | sim | parcial (carga sem catch) | não | não verificado |
| `/clients` | ClientsPage | `client:read` | sim | parcial (exclusão sim; lista não) | não | não verificado |
| `/clients/new` | ClientFormPage | `client:create` | sim | sim | não | não verificado |
| `/clients/:id/edit` | ClientFormPage | `client:update` | sim | parcial (carga sem catch) | não | não verificado |
| `/projects` | ProjectsPage | `project:read` | sim | não (lista e troca de status sem catch; transição inválida retorna 400 sem aviso) | não | não verificado |
| `/projects/new` | ProjectFormPage | `project:create` | sim | parcial (submit sim; listas não) | não | não verificado |
| `/projects/dashboard` | ProjectsDashboardPage | `project:read` | parcial (18 inline, cores fixas) | não | não | não verificado |
| `/requests` | MyActivitiesPage | `request:read` | parcial (12 inline) | não | não | não verificado |
| `/requests/new` | NewRequestPage | `request:create` | parcial (16 inline) | parcial (submit e catálogo da Logística sim; carga inicial não) | não | não verificado |
| `/requests/mine` | MyRequestsPage | `request:read` | sim | não | não | não verificado |
| `/requests/queue` | RequestsQueuePage | `request:read` | parcial (4 inline) | não | não | não verificado |
| `/requests/dashboard` | RequestsDashboardPage | `request:read` | parcial (24 inline, cores fixas) | não | não | não verificado |
| `/requests/:id` | RequestDetailPage | `request:read` | parcial (64 inline) | parcial (análise/cotação de compra sim; ações de fluxo via `run()` e comentário não) | não | não verificado |
| `/my-approvals` | MyRequestApprovalsPage | `request:read` | parcial (11 inline) | não | não | não verificado |
| `/delegations` | DelegationsPage | `delegation:read` | parcial (9 inline) | parcial (criação sim; carga e revogação não) | não | não verificado |
| `/integrations` | IntegrationsPage | `integration:read` | parcial (24 inline) | parcial (abrir satélite sim; lista, outbox e teste de webhook não) | não | não verificado |
| `/integrations/new` | SatelliteFormPage | `integration:manage` | parcial (16 inline) | sim | não | não verificado |
| `/sensitive-access-log` | SensitiveAccessLogPage | `collaborator:read_sensitive` | parcial (20 inline) | não | não | não verificado |
| `/users` | UsersPage | `user:read` | parcial (8 inline) | parcial (status e reset sim; lista não) | não | não verificado |
| `/users/new` | UserFormPage | `user:create` | parcial (8 inline) | parcial (submit sim; papéis/colaboradores não) | não | não verificado |
| `/users/:id/edit` | UserFormPage | `user:update` | parcial (8 inline) | parcial (carga sem catch) | não | não verificado |
| `/roles` | RolesPage | `user:read` | parcial (31 inline) | parcial (salvar sim; carga não) | não | não verificado |
| `*` | redireciona para `/dashboard` | — | — | — | — | — |

Resumo: 39 rotas; nenhuma com teste de tela; 6 com tratamento de erro completo; responsividade de conteúdo não verificada em nenhuma.

## Lacunas de navegação

1. **`/requests/dashboard` não tem link** em lugar nenhum (menu, dashboard ou botões). Só acessível digitando a URL.
2. **`/requests/mine` e `/requests/queue` só via botões** da página `/requests` (Minhas Atividades); não estão no menu lateral. `/requests/new` também só por botão.
3. **`/projects/dashboard` só via botão** em `/projects`.
4. **Busca da topbar sem lógica:** o `<input placeholder="Buscar no Axis...">` do `AppLayout` não tem `onChange` nem ação.
5. **Submenu morto:** `AppLayout` tem lógica para `children` de item de menu sob `/requests`, mas nenhum item de `NAV_ITEMS` define `children`.
6. **Sem edição de projeto:** não existe `/projects/:id/edit`; o backend tem `PUT /projects/:id` e `DELETE /projects/:id` sem tela.
7. **Sem edição de satélite:** só `/integrations/new`; não há rota para editar/desativar satélite.
8. **Certificações sem tela própria:** só são criadas dentro do formulário de colaborador; editar/excluir não existe na UI.
9. **Notificação de certificação leva a rota que o usuário pode não ter:** o dropdown aparece para quem tem `certification:read` (ex.: `tecnico`) e navega para `/collaborators/:id/edit`, que exige `collaborator:update` — o usuário é jogado para `/dashboard` sem explicação.
10. **Permissão negada é silenciosa:** `PrivateRoute` redireciona para `/dashboard` sem aviso; rota inexistente (`*`) também — não há página 403/404.
11. **Dados sensíveis sem tela:** nenhuma rota exibe CPF/RG/CTPS/PIS (`GET /collaborators/:id/sensitive` não é chamado), apesar de existir `/sensitive-access-log`.
12. **Desligamento sem botão dedicado:** a UI troca o status para "Desligado" via edição em vez de chamar `POST /collaborators/:id/offboard` (ver [cadastros.md §7](../dominio/cadastros.md#7-colaboradores)).
13. **Atalhos do dashboard incompletos:** `MODULE_SHORTCUTS` cobre 7 módulos; faltam Cargos, Jornadas, Aprovações, Delegações, Usuários, Grupos e Log de acesso sensível (presentes no menu).

## Como executar o QA de uma rota

1. Logar com um usuário de cada papel relevante (ver [cadastros.md §2](../dominio/cadastros.md#2-papéis-e-permissões-rbac)) e confirmar menu e acesso direto pela URL.
2. Exercitar listar, criar, editar e excluir; derrubar o backend durante a carga e durante o submit para ver a mensagem de erro.
3. Alternar tema claro/escuro e conferir contraste.
4. Repetir em 390px e 768px de largura (menu, tabelas, formulários em etapas).
5. Atualizar esta tabela no mesmo PR que corrigir uma lacuna.

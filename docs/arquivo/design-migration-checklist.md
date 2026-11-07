# AXIS — Industrial Flow Graphite: checklist de migração

Inventário produzido a partir de `frontend/src/App.tsx`. A coluna de UI registra a fundação visual aplicada (tokens, shell e componentes compartilhados); a validação funcional por rota permanece explícita até a execução de jornada autenticada.

| Rota | Módulo | UI migrada | Funcionalidade testada | Responsivo | Status |
|---|---|---:|---:|---:|---|
| `/login` | Autenticação | Sim | Não | Sim | Pendente validação autenticada |
| `/change-password` | Autenticação | Sim | Não | Sim | Pendente validação autenticada |
| `/dashboard` | Dashboard | Sim | Não | Sim | Pendente validação autenticada |
| `/collaborators`, `/collaborators/new`, `/collaborators/:id/edit` | Colaboradores | Sim | Não | Sim | Pendente validação autenticada |
| `/job-titles`, `/job-titles/new`, `/job-titles/:id/edit` | Cargos | Sim | Não | Sim | Pendente validação autenticada |
| `/work-schedules`, `/work-schedules/new`, `/work-schedules/:id/edit` | Jornadas | Sim | Não | Sim | Pendente validação autenticada |
| `/sectors`, `/sectors/new`, `/sectors/:id/edit` | Setores | Sim | Não | Sim | Pendente validação autenticada |
| `/cost-centers`, `/cost-centers/new`, `/cost-centers/:id/edit` | Centros de custo | Sim | Não | Sim | Pendente validação autenticada |
| `/clients`, `/clients/new`, `/clients/:id/edit` | Clientes | Sim | Não | Sim | Pendente validação autenticada |
| `/projects`, `/projects/new`, `/projects/dashboard` | Projetos | Sim | Não | Sim | Pendente validação autenticada |
| `/requests`, `/requests/new`, `/requests/mine`, `/requests/queue`, `/requests/dashboard`, `/requests/:id` | Requisições | Sim | Não | Sim | Pendente validação autenticada |
| `/requests/bpm`, `/requests/bpm/new`, `/requests/bpm/:id`, `/requests/bpm/sla` | BPM operacional | Sim | Não | Sim | Pendente validação autenticada |
| `/requests/bpm/admin`, `/requests/bpm/admin/versions/:id` | Administração BPM | Sim | Não | Sim | Pendente validação autenticada |
| `/my-approvals` | Aprovações | Sim | Não | Sim | Pendente validação autenticada |
| `/delegations` | Delegações | Sim | Não | Sim | Pendente validação autenticada |
| `/integrations`, `/integrations/new` | Integrações | Sim | Não | Sim | Pendente validação autenticada |
| `/sensitive-access-log` | Log de acesso sensível | Sim | Não | Sim | Pendente validação autenticada |
| `/users`, `/users/new`, `/users/:id/edit` | Usuários | Sim | Não | Sim | Pendente validação autenticada |
| `/roles` | Grupos e permissões | Sim | Não | Sim | Pendente validação autenticada |

## Evidências técnicas

- Tema único em `frontend/src/styles/axis-tokens.css`.
- Shell responsivo e navegação por permissões em `frontend/src/components/layout/AppLayout.tsx`.
- Componentes compartilhados: `Button`, `DataTable`, `KpiCard`, `FormPage` e campos BPM.
- `npm run build` executado em 02/11/2026: sucesso (TypeScript e Vite). A duplicação de `padding`, `borderRadius` e `fontSize` em `BpmPages.tsx:404` foi removida sem alterar os valores finais de `versionBadge`.
- `npm run test:journey` executado em 02/11/2026: 23 testes aprovados e 3 falharam. Falhas: mocks sem `bpmApi.queues` em dois testes de rascunho e expectativa de duas opções de setor no cenário administrativo. Não foram ocultadas nem tratadas como aprovação.

## Ativos de marca Industrial Flow Graphite

Os SVGs navy/azul/violeta fornecidos foram preservados em `frontend/public/axis`. As versões novas, vetoriais e isoladas estão em `frontend/public/brand-industrial`: horizontal clara/escura, símbolo, favicon e ícone de aplicativo. O shell, login e favicon utilizam as novas versões.

## Situação de aceite

**Não concluído em 100%.** A cobertura de tema e componentes compartilhados alcança todas as rotas inventariadas, mas faltam jornadas autenticadas por rota, migração dos estilos inline remanescentes no BPM e centralização/validação completa de documentos e máscaras.

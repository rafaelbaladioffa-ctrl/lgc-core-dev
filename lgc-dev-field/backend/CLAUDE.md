# Módulo: Backend Django

Django 4 + Django REST Framework. API e lógica de negócio do ERP CSTR.

> Herda as regras de deploy e segurança de `/CLAUDE.md` na raiz do repositório.

---

## Apps e responsabilidades

| App | Modelos principais | Responsabilidade |
|-----|--------------------|-----------------|
| `core` | Site, Category, ActivityType, ProjectType, ProjectItemType, GenerationRule | Catálogos base do sistema |
| `projects` | Project, ProjectTask, WorkBlock, ProjectItem, TaskDependency, TaskExecutionEvent | Projetos e tarefas de obra |
| `api` | — | Todos os endpoints REST (views.py 2400 linhas, operations.py 600 linhas) |
| `dispatch` | DispatchQueue | Fila de despacho de tarefas para técnicos |
| `technical` | MyTask (proxy de ProjectTask) | Visão simplificada para o técnico no campo |
| `bot` | BotSubscriber, ProjectProgressSnapshot | Bot WhatsApp — subscribers e snapshots de progresso |
| `users` | Collaborator, CustomUser | Usuários, perfis, permissões |
| `audit` | AuditLog | Diff automático de campos via signal (apps em AUDITED_APPS) |
| `updates` | ProjectUpdate | Atualizações ao cliente por e-mail |
| `master_data` | MasterDataEntry | Catálogo mestre com assistência de IA |
| `scope_import` | ScopeImport | Importação de escopo de projeto via IA (OpenRouter) |

---

## Arquivos mais importantes

```
backend/
  api/
    views.py          — ViewSets e APIViews de todos os recursos (~2400 linhas)
    operations.py     — build_board_data(), Central de Operações (~600 linhas)
    serializers.py    — todos os serializers (~2000 linhas)
    dashboard.py      — analytics e métricas
    permissions.py    — BotSharedSecretPermission, ViewAwareModelPermissions
    urls.py           — router e urlpatterns
  projects/
    models.py         — Project, ProjectTask, WorkBlock, ProjectItem (~544 linhas)
    services.py       — lógica de negócio: create_task, generate_tasks_from_rule, record_task_transition
    analytics.py      — build_projects_performance, build_activity_productivity
  config/
    settings.py       — configurações Django, INSTALLED_APPS, env vars
    urls.py           — urlpatterns raiz
```

---

## Padrões do projeto

### ViewSets
Usar `ModelViewSet` para CRUD completo. Actions extras com `@action`:

```python
@action(detail=True, methods=["get"], url_path="planning-summary")
def planning_summary(self, request, pk=None):
    ...
```

### Permissões
- `IsAuthenticated` para endpoints normais.
- `ViewAwareModelPermissions` para CRUD com controle granular (herdado de DRF `DjangoModelPermissions`).
- `BotSharedSecretPermission` para todos os endpoints `/api/bot/*`.

### Serializers
- `validators = []` quando o serializer precisa de validação personalizada via `validate()`.
- Nunca expor campos com `_SECRET` ou `_KEY` em nenhum serializer.

### Migrações
**Sempre aditivas.** Padrão do projeto (já seguido em 0022–0026):
1. Adicionar campo com `null=True, blank=True`
2. Migrar dados se necessário
3. Tornar obrigatório numa migration separada (se for o caso)

**Nunca** dropar coluna ou tabela diretamente.

### Services
Lógica de negócio fica em `projects/services.py`, não nas views. Views chamam services.

### Bulk update
`apply_bulk_task_update` usa `.update()` que **pula** `save()` e signals. Ao adicionar lógica em `save()`, verificar se o bulk também precisa ser atualizado.

---

## Variáveis de ambiente importantes

| Variável | Descrição |
|----------|-----------|
| `WHATSAPP_BOT_SECRET` | Segredo do bot WhatsApp — nunca exibir |
| `OPENROUTER_API_KEY` | Chave da API de IA — nunca exibir |
| `OPENROUTER_MODEL` | Slug do modelo (ex: `minimax/minimax-m3:free`) |
| `EMAIL_HOST_PASSWORD` | Senha do e-mail — nunca exibir |
| `SECRET_KEY` | Django secret key — nunca exibir |
| `DATABASE_URL` | Conexão PostgreSQL |

Trocar `OPENROUTER_MODEL` no `.env` exige `up -d --force-recreate backend` — não apenas `restart`.

---

## Testes

Suíte atual: ~700 testes. Rodar antes de deployar (no container de produção) ou localmente com SQLite (receita no `CLAUDE.md` da raiz, §10):

```bash
ssh vps-deploy 'cd ~/erp/erp-cstr && docker compose exec -T backend python manage.py test'
```

Ao adicionar feature, adicionar testes cobrindo:
- Fluxo feliz
- Campos opcionais (não quebrar com campos ausentes)
- Regressão dos endpoints existentes

---

## Deploy do backend

Produção = **VPS** (não é mais o notebook/WSL). Procedimento completo, aliases SSH e armadilhas: `CLAUDE.md` da raiz (§9) e `CLAUDE.local.md`.

```bash
ssh vps-deploy 'cd ~/erp/erp-cstr && git pull --ff-only origin main'
# build leva minutos: rode em segundo plano com log (ver CLAUDE.md §9)
ssh vps-deploy 'cd ~/erp/erp-cstr && docker compose -f compose.yaml -f compose.prod.yaml build backend'
ssh vps-deploy 'cd ~/erp/erp-cstr && docker compose -f compose.yaml -f compose.prod.yaml up -d --force-recreate backend && docker compose ps backend'
```

### Migrações em produção

**Rodam sozinhas** no `entrypoint.sh` a cada início do container (`migrate --noinput`). Antes de migração, faça backup do banco. Para conferir: `docker compose exec -T backend python manage.py showmigrations <app>` e `makemigrations --check --dry-run`.

---

## Auto-commit

```bash
git add backend/
git commit -m "descrição da alteração"
git push origin main
```

Nunca incluir `backend/media/`, `backend/staticfiles/`, `backend/tmp/` no commit.

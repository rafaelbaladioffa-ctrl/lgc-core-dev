# Axis Field

Satélite do Axis para **gestão de projetos de campo**: projetos, tarefas, atividades, despacho de
técnicos (Operação do Dia), presença e timeline, apontamento por bloco, relatórios de HH e
produtividade, painel de sites, catálogo técnico (cabos, SOW) e bot de WhatsApp.

Incorporado ao repositório do Axis em 2026-11-08 a partir do ERP CSTR
(`github.com/rafaelbaladioffa-ctrl/erp-cstr`, commit `c27ef24`), **só o código, sem o histórico
do Git**. O ERP CSTR em produção continua rodando do repositório antigo até a migração
([../docs/integracao-core-field.md §6](../docs/integracao-core-field.md#6-migração-da-produção)).

## Stack

Diferente dos outros satélites, o Field **continua em Django** (decisão de 2026-11-08: reescrever
em NestJS custaria meses e arriscaria as regras de HH já aprovadas em produção).

| Camada | Tecnologia |
|---|---|
| Backend | Django 5.2 + DRF, simplejwt, django-axes, django-unfold (admin), gunicorn |
| Frontend | React 18 + TypeScript + Vite 5 + Leaflet |
| Bot | Node 22 + Baileys (WhatsApp Web) + Puppeteer |
| Banco | PostgreSQL 17, **banco próprio** (nunca o do Core) |

## Portas (desenvolvimento)

| Serviço | Porta | Observação |
|---|---|---|
| `field-backend` | 8000 | API em `/api/`, admin em `/admin/` |
| `field-frontend` | 5176 | 5173 é do Core, 5174 da Logística, 5175 do Financeiro |
| `field-whatsapp-bot` | 3001 | só em 127.0.0.1 |
| `field-postgres` | — | sem porta publicada |

## Como rodar

```bash
cd lgc-dev-field
cp .env.example .env   # troque senhas e DJANGO_SECRET_KEY
docker compose up --build
```

As migrações rodam sozinhas no `entrypoint.sh` do backend. Testes:

```bash
docker compose run --rm field-backend python manage.py test
```

O Django cria o banco `test_<POSTGRES_DB>` para os testes; nunca rode testes apontando
`POSTGRES_DB` para o banco de produção. Só a integração com o Core: `... manage.py test axis_integration`.

## Estado da integração com o Core

Os cadastros do Core chegam ao Field (F2/F3, app `backend/axis_integration`); login pelo Core (F1), obra a partir
do Core (F4) e retorno ao Core (F5) ainda não existem. Detalhes e decisões: [../docs/integracao-core-field.md](../docs/integracao-core-field.md).

- **Webhook** `POST /api/v1/webhooks/axis`: HMAC-SHA256 em `X-Axis-Signature`, janela anti-replay, deduplicação por
  `event_id` na mesma transação. Atualiza só vínculos `axis_*_id` e um cache (`AxisMasterRecord`); não cria obra e
  não sobrescreve dado de negócio do Field.
- **Casamento:** cliente por CNPJ (senão nome normalizado), colaborador por e-mail/matrícula, site por cliente + código.
  Sem par único, o registro fica sem vínculo e aparece no relatório; nada é apagado.
- **Carga inicial e relatório dos sem par:**

```bash
docker compose run --rm field-backend python manage.py axis_sync
```

- **Variáveis** (`.env.example`): `AXIS_WEBHOOK_SECRET`, `AXIS_API_URL` (termina em `/api/v1`), `AXIS_API_KEY`. Sem
  `AXIS_WEBHOOK_SECRET` o receptor responde 503.

O restante do sistema (login, usuários, projetos e obras) continua independente do Core por enquanto.

## Identidade visual

Nome, logotipo e ícones já são do Axis (`public/brand-industrial/`, `favicon-*.png`, copiados por
`node scripts/sync-design.mjs` na raiz — não edite as cópias). O CSS ainda é o próprio do ERP CSTR
(`src/index.css`); `src/styles/axis-tokens.css` e `axis-shell.css` já estão sincronizados, mas não
são importados. Os textos "Consultimer" que ainda existem são **dados de negócio** (tipo de projeto
Consultimer, `responsible_cstr`, remetente e timbrado dos e-mails e PDFs enviados a clientes) e só
mudam com decisão do dono do produto (§7 do documento de integração).

## Documentação herdada

- [CLAUDE.md](CLAUDE.md) — guia completo do ERP CSTR (regras de HH, features, telas). As regras de
  negócio da seção 8 continuam valendo. As seções de deploy e infraestrutura descrevem a produção
  antiga.
- [docs/](docs/) — arquitetura antiga, cadastros mestres, cálculo de horas, relatórios v2, painel de
  sites.
- [memory/](memory/) — glossário e modelos do "segundo cérebro" de negócio.

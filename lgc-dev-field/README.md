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
`POSTGRES_DB` para o banco de produção.

## Estado da integração com o Core

Por enquanto o Field é um sistema **independente dentro do repositório**: tem login, usuários,
clientes, sites e colaboradores próprios. O plano para o Core virar a fonte da verdade (login do
Core, cadastros pelos webhooks, casamento dos registros existentes) está em
[../docs/integracao-core-field.md](../docs/integracao-core-field.md).

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

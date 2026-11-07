# Axis Core — Web

SPA do Axis Core: React 19, Vite 8, React Router 7 e TypeScript, sem biblioteca de UI ou de estado.
O mapa de rotas e o estado de QA estão em [../docs/design/checklist-qa-rotas.md](../docs/design/checklist-qa-rotas.md).
Tokens visuais e marca: [../docs/design/identidade-visual.md](../docs/design/identidade-visual.md).

## Rodando

```bash
npm install
```

```bash
npm run dev
```

Abre em http://localhost:5173. A API do Core precisa estar em `VITE_API_BASE_URL`.

### Variáveis (`.env.local`, embutidas no build)

| Variável | Padrão | Uso |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000/api/v1` | API do Core |
| `VITE_LOGISTICA_API_BASE_URL` | `/logistica-api` | API da Logística (catálogo de compra e disponibilidade). No `npm run dev` não há proxy para esse caminho: use `http://localhost:3100/api/v1` |

Em Docker, o `nginx.conf` serve a SPA e faz proxy de `/logistica-api/` para `logistica-backend:3100/api/v1/`.

## Scripts

| Script | O que faz |
|---|---|
| `dev` / `build` / `preview` | Vite (o `build` roda `tsc -b` antes) |
| `lint` | oxlint. Hoje falha porque também analisa `.vite-codex-cache/`; use `npx oxlint src` |
| `test:journey` | Vitest. 3 de 4 arquivos quebrados (importam o BPM removido) |
| `test:a23` | Playwright. Obsoleto (mira `/requests/bpm`) |

## Estrutura

```
src/
  main.tsx, App.tsx          roteamento e PrivateRoute (login, troca de senha, permissão)
  api/                       um módulo por recurso sobre o axios (client.ts: token e refresh)
  context/                   AuthContext (JWT, permissões), ThemeContext (claro/escuro)
  components/                Button, DataTable, KpiCard, SlideOver, MaskedInput, charts, árvores
  components/layout/         AppLayout (menu por permissão), FormPage, NotificationsDropdown
  pages/                     uma página por rota
  styles/axis-tokens.css     tokens do tema (fonte única de cores, tipografia e espaçamento)
  utils/                     formatBRL, formatDate, máscaras, tradução de erro da API
```

## Typecheck

```bash
npx tsc -p tsconfig.app.json --noEmit
```

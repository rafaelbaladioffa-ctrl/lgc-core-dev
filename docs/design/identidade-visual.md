# Identidade visual do Axis

Propósito: registrar a marca documentada (kit v3), o tema que o app usa de fato e os arquivos órfãos, para que a decisão sobre a identidade oficial possa ser tomada e aplicada.
Data: 2026-11-07. Fontes: [arquivo/branding-v3/](../arquivo/branding-v3/BRANDING.md), [branding/](../../branding), [axis-tokens.css](../../frontend/src/styles/axis-tokens.css), [index.css](../../frontend/src/index.css), [index.html](../../frontend/index.html), [frontend/public/](../../frontend/public).

> **Há duas identidades no repositório.** O kit v3 (navy/azul/violeta) é o que a documentação chama de "definitivo"; o app em produção usa o tema **Industrial Flow Graphite** (grafite/teal). **Qual é a oficial é decisão pendente do dono do produto.** Até a decisão, código novo segue os tokens de `axis-tokens.css` (o que está em uso), sem hex fixo, para que a troca futura seja só de tokens.

## 1. Kit v3 (documentado, não aplicado ao Core)

Assets em [branding/](../../branding): `logos/` (primary, dark, white, horizontal, stacked, monochrome navy/white — SVG e PNG), `icons/` (símbolo, app icon, favicons, apple-touch, 192/512), `implementation/` (`axis-tokens.json`, `axis-theme.css`, `axis-brand.ts`, `tailwind.axis.config.js`, `manifest.webmanifest`) e `social/` (banner, OG, perfil). A pasta `branding/docs/` está vazia; os textos foram para [arquivo/branding-v3/](../arquivo/branding-v3/).

| Token | Valor | Uso previsto |
|---|---|---|
| Navy | `#0A1740` | base institucional, navegação |
| Azul | `#3B82F6` | ações, links, dados |
| Violeta | `#8B5CF6` | automação, destaques |
| Lavanda | `#C4B5FD` | apoio em fundo escuro |
| Prata | `#94A3B8` | texto secundário |
| Cloud | `#E5E7EF` | bordas e superfícies |
| Gradiente | `linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)` | botão primário |
| Fonte | Inter 400/500/600/700, fallback Segoe UI | — |
| Raio | 8 / 12 / 20 px | — |
| Sombra de card | `0 8px 24px rgba(10,23,64,.12)` | — |

Regras de marca do kit:

- Símbolo: três planos que convergem num eixo ascendente (direção, integração, fluxo de dados).
- Espaço de proteção: área livre de 25% da altura do símbolo ao redor da marca.
- Tamanho mínimo: 120 px para a assinatura completa; 24 px para o símbolo.
- Fundo claro → `axis_logo_primary.svg`; fundo navy/escuro → `axis_logo_dark.svg` ou `axis_logo_white.svg`; avatar/app → `axis_app_icon.svg`; espaço compacto → `axis_symbol.svg`; impressão a uma cor → monochrome.
- Não distorcer, recolorir, aplicar sombra nem alterar proporção, tipografia ou espaçamento entre símbolo e nome. SVG na interface; PNG só onde vetor não é aceito.

## 2. Tema em uso: Industrial Flow Graphite

Definido em [frontend/src/styles/axis-tokens.css](../../frontend/src/styles/axis-tokens.css), importado por [index.css](../../frontend/src/index.css). O tema escuro é ativado por `data-theme="dark"` no `<html>`, controlado pelo botão da topbar e salvo em `localStorage` (`axis_theme`) — [ThemeContext.tsx](../../frontend/src/context/ThemeContext.tsx). O padrão é claro; **não segue `prefers-color-scheme`**.

### 2.1 Paleta base

| Token | Valor |
|---|---|
| `--axis-graphite-900` | `#0e1114` |
| `--axis-graphite-800` | `#1a1f24` |
| `--axis-graphite-700` | `#262c32` |
| `--axis-graphite-600` | `#3a424a` |
| `--axis-graphite-400` | `#66707a` |
| `--axis-graphite-200` | `#d4dae0` |
| `--axis-graphite-100` | `#eef2f4` |
| `--axis-teal` | `#14b8a6` |
| `--axis-teal-action` | `#0f766e` |
| `--axis-teal-hover` | `#115e59` |
| `--axis-teal-subtle` | `#ccfbf1` |
| `--axis-teal-dark` | `#153e3b` |

### 2.2 Tokens semânticos (claro → escuro)

| Token | Claro | Escuro (`[data-theme="dark"]`) |
|---|---|---|
| `--background` | graphite-100 | graphite-900 |
| `--surface` | `#ffffff` | graphite-800 |
| `--surface-secondary` | `#f8fafb` | graphite-700 |
| `--surface-dark` | graphite-800 | (igual) |
| `--foreground` | graphite-800 | `#f8fafc` |
| `--foreground-muted` | graphite-400 | `#a9b4bd` |
| `--foreground-inverse` | `#f8fafc` | (igual) |
| `--border` | graphite-200 | graphite-600 |
| `--border-subtle` | `#e5e9ed` | graphite-700 |
| `--primary` / `--focus-ring` | teal-action `#0f766e` | (igual) |
| `--primary-hover` | teal-hover `#115e59` | (igual) |
| `--primary-foreground` | `#ffffff` | (igual) |
| `--success` / `--warning` / `--danger` / `--info` | `#15803d` / `#b45309` / `#b91c1c` / `#2563eb` | (iguais) |
| `--row-hover`, `--table-head` | `--surface-secondary` | graphite-700 |

Os tons `*-soft` (`--success-soft #dcfce7`, `--warning-soft #fef3c7`, `--danger-soft #fee2e2`, `--accent-soft` = teal-subtle) **não mudam no escuro** — fundos claros sobre superfície escura.

### 2.3 Tipografia, raios, espaço, sombras, movimento

| Grupo | Tokens |
|---|---|
| Fonte | `--font-family: "Inter", "Segoe UI", sans-serif`; `--mono: ui-monospace, "Cascadia Code", Consolas, monospace`. Inter carregada do Google Fonts nos pesos **400, 600, 700, 800** ([index.html](../../frontend/index.html)) — o peso 500 usado pelo `Button` não é carregado |
| Tamanhos | `--text-xs .75rem`, `--text-sm .875rem` (corpo), `--text-base 1rem`, `--text-lg 1.125rem`, `--text-xl 1.25rem`, `--text-2xl 1.5rem` |
| Raios | `--radius-xs 4px`, `--radius-sm 6px`, `--radius-md 8px` (= `--radius`), `--radius-lg 10px`, `--radius-xl 12px` |
| Espaço | `--space-1 4px` … `--space-6 24px`, `--space-8 32px` |
| Layout | `--sidebar-width 248px`, `--sidebar-collapsed-width 64px`, `--header-height 60px`, `--control-height 36px` |
| Sombras | `--shadow-sm 0 1px 2px rgba(14,17,20,.04)` (= `--shadow`, `--shadow-card`), `--shadow-md 0 3px 10px rgba(14,17,20,.06)` |
| Transições | `--transition-fast 120ms ease`, `--transition-default 180ms ease` |

Aliases de compatibilidade (`--bg`, `--bg-elevated`, `--bg-topbar`, `--bg-sidebar`, `--bg-sidebar-active`, `--text`, `--text-muted`, `--text-sidebar`, `--text-sidebar-active`, `--text-topbar`, `--accent`, `--accent-contrast`, `--sans`) apontam para os tokens acima. Código novo deve usar os nomes semânticos (`--primary`, `--foreground`...), não os aliases.

### 2.4 Logos usados pelo app

Em [frontend/public/brand-industrial/](../../frontend/public/brand-industrial), paleta grafite + teal `#14B8A6`:

| Arquivo | Onde |
|---|---|
| `axis-logo-dark.svg` | topbar ([AppLayout](../../frontend/src/components/layout/AppLayout.tsx)); login no tema escuro |
| `axis-logo-light.svg` | login no tema claro ([LoginPage](../../frontend/src/pages/LoginPage.tsx)) |
| `axis-symbol.svg` | rodapé da sidebar |
| `axis-app-icon.svg` | login |
| `axis-favicon.svg` | favicon (`index.html`) |

Regras de espaço de proteção e tamanho mínimo para estes logos: **não definidas** (só existem para o kit v3).

## 3. Arquivos órfãos ou inconsistentes

Conferido por busca em `frontend/src` e `frontend/index.html` em 2026-11-07:

| Arquivo | Situação |
|---|---|
| [frontend/src/axis-theme.css](../../frontend/src/axis-theme.css) | cópia idêntica de `branding/implementation/axis-theme.css` (kit v3); **não importado** por nenhum arquivo |
| [branding/implementation/axis-theme.css](../../branding/implementation/axis-theme.css), `axis-brand.ts`, `tailwind.axis.config.js`, `axis-tokens.json` | não usados pelo Core (o projeto não usa Tailwind) |
| `index.html` `<meta name="theme-color" content="#0A1740">` | navy do kit v3, destoa do tema grafite |
| [frontend/public/manifest.webmanifest](../../frontend/public/manifest.webmanifest) | `theme_color` e `background_color` `#0A1740` (kit v3); ícones `favicon-192.png`/`favicon-512.png` — paleta dos PNGs não verificada |
| `index.html` `og:image` → `/axis/social/axis_og_image.png` | única referência a `frontend/public/axis/**`; imagem do kit v3 |
| `frontend/public/axis/icons/**`, `frontend/public/axis/logos/**`, demais `frontend/public/axis/social/**` | sem uso |
| `frontend/public/favicon.svg`, `frontend/public/favicon-32.png`, `frontend/public/icons.svg` | sem referência |
| `frontend/src/assets/brand/axis-icon.svg`, `axis-wordmark-dark.svg`, `axis-wordmark-light.svg` | kit v3 (navy/azul/violeta); sem import |
| `frontend/src/assets/hero.png`, `react.svg`, `vite.svg` | restos do template Vite; sem import |
| Cores fixas em páginas | `DashboardPage`, `ProjectsDashboardPage`, `RequestsDashboardPage` usam hex fixos para séries de gráfico (ex.: `#5b8def`, `#3fbf80`, `#e2605f`), fora dos tokens |

## 4. Satélite Logística

[lgc-dev-logistica/frontend/src/styles.css](../../lgc-dev-logistica/frontend/src/styles.css) copiou os tokens **do kit v3** (`--axis-navy #0a1740`, `--axis-blue`, `--axis-violet`, gradiente, raio 12px, sombra navy), não os do tema Graphite, e adiciona alto contraste e alvos de 52px para uso com luvas. Diferente do Core, o modo escuro da Logística segue `prefers-color-scheme` além de `data-theme`. O comentário do arquivo diz que o shell espelha o `AppLayout` do Core, mas as cores não batem. Qualquer decisão de identidade precisa ser replicada lá manualmente — não há pacote de tokens compartilhado.

## 5. Decisões pendentes (dono do produto)

1. Identidade oficial: kit v3 (navy/azul/violeta) ou Industrial Flow Graphite (grafite/teal).
2. Conforme a escolha: atualizar `theme-color`, manifest, `og:image`, favicons e a Logística; remover os assets da identidade descartada.
3. Se Graphite for a oficial: produzir manual de uso (proteção, tamanhos mínimos, versões monocromáticas) e kit de exportação equivalente ao v3.
4. Paleta de gráficos como tokens (`--chart-1`…), substituindo os hex fixos dos dashboards.

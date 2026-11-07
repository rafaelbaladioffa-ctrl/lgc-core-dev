# Axis — Design System (v3, kit definitivo)

Kit de identidade visual completo aprovado pelo usuário, importado para `branding/`.

## Estrutura
- `logos/` — `axis_logo_primary`, `axis_logo_dark`, `axis_logo_white`, `axis_logo_horizontal`, `axis_logo_stacked`, `axis_logo_monochrome_navy`, `axis_logo_monochrome_white` (svg + png)
- `icons/` — `axis_symbol` (svg/png), `axis_app_icon`, `favicon.ico/svg/png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`
- `implementation/` — **usar isso diretamente no código**:
  - `axis-tokens.json` — tokens de design (cor, raio, sombra, tipografia)
  - `axis-theme.css` — tema pronto em CSS custom properties
  - `axis-brand.ts` — constantes de marca para TS/React
  - `tailwind.axis.config.js` — extensão do Tailwind com a paleta Axis
  - `manifest.webmanifest` — PWA manifest com os ícones corretos
- `social/` — banner, OG image, foto de perfil (uso em redes/README, não no produto)
- `docs/` — `MANUAL_IDENTIDADE_AXIS.md`, `USO_DOS_LOGOTIPOS.md`, `GUIA_AXIS_VIBE_CODING.md` (guia de como aplicar a marca ao codificar), `README.md`

## Tokens principais (de `implementation/axis-tokens.json`)
| Token | Valor |
|---|---|
| `brand.navy` | `#0A1740` |
| `brand.blue` | `#3B82F6` |
| `brand.violet` | `#8B5CF6` |
| `brand.lavender` | `#C4B5FD` |
| `brand.silver` | `#94A3B8` |
| `brand.cloud` | `#E5E7EF` |
| `gradient` | `linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)` |
| `font.family` | `Inter, Segoe UI, sans-serif` |
| `radius` | sm 8px / md 12px / lg 20px |
| `shadow.card` | `0 8px 24px rgba(10,23,64,.12)` |

## Instrução para a implementação
A sessão de codificação deve seguir `docs/GUIA_AXIS_VIBE_CODING.md` e `docs/USO_DOS_LOGOTIPOS.md` como fonte da verdade de como aplicar a marca no código (qual logo usar em fundo claro/escuro, como importar `axis-theme.css`/`axis-brand.ts`/`tailwind.axis.config.js`), substituindo o rascunho de branding anterior (v2) por este kit definitivo.

## Módulos reais do Axis (não usar nomes do mockup de referência)
Dashboard, Colaboradores, Setores, Centros de Custo, Clientes, Projetos, Chamados, Integrações, Configurações/Admin.

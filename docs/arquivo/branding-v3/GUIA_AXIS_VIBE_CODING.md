# Guia Axis para Vibe Coding

Use esta pasta como fonte oficial da identidade visual do Axis ERP + SGI.

1. Copie `logos/` e `icons/` para a pasta pública do sistema.
2. Importe `implementation/axis-theme.css` no estilo global.
3. Use `axis_logo_primary.svg` em fundos claros e `axis_logo_dark.svg` em fundos escuros.
4. Configure favicon, Apple Touch Icon e o manifesto usando os arquivos de `icons/`.
5. Aplique Inter (pesos 400–700), com Segoe UI como fallback.
6. Preserve módulos, permissões, banco de dados e regras de negócio; altere apenas a camada visual.

Priorize SVG na interface e PNG para integrações que não aceitam vetor. Nunca distorça, recolora ou aplique sombras ao logotipo.
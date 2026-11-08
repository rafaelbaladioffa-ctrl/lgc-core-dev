# Documentação do Axis

Índice da documentação do Core e dos satélites Logística, Financeiro e Field. Reorganizada em 2026-11-07: cada
documento abaixo foi conferido contra o código da branch `rafaelbaladioffa-ctrl/minhas-atividades`.
O que descreve código removido ou entregas passadas está em [arquivo/](arquivo/README.md).

## Comece aqui

- [avaliacao-2026-11-07.md](avaliacao-2026-11-07.md) — diagnóstico do código, riscos e prioridades.
- [arquitetura.md](arquitetura.md) — visão geral, módulos, segurança, integração e decisões.
- [operacao.md](operacao.md) — como subir, variáveis de ambiente, migrações, backup.
- [diretrizes-desenvolvimento.md](diretrizes-desenvolvimento.md) — padrões obrigatórios e Definition of Done.
- [integracao-core-logistica.md](integracao-core-logistica.md) — contratos entre Core e Logística.
- [plano-projeto-aprovado-ponta-a-ponta.md](plano-projeto-aprovado-ponta-a-ponta.md) — plano: projeto aprovado → requisição à Logística → custos no CC → obra no Field (em implantação).

## Domínio

| Documento | Natureza |
|---|---|
| [dominio/cadastros.md](dominio/cadastros.md) | Como o código funciona hoje (colaboradores, setores, CC, clientes, projetos, usuários) |
| [dominio/requisicoes-estado-atual.md](dominio/requisicoes-estado-atual.md) | Como o módulo Requisições funciona **hoje** |
| [dominio/requisicoes-spec.md](dominio/requisicoes-spec.md) | Especificação funcional **alvo** (nem tudo está implementado) |
| [dominio/requisicoes-regras-motor.md](dominio/requisicoes-regras-motor.md) | Regras normativas para a reescrita do motor de processos |
| [dominio/requisicoes-roadmap.md](dominio/requisicoes-roadmap.md) | Pré-requisitos, entregas E0–E6, lacunas e critérios de aceite |
| [dominio/decisoes-negocio.md](dominio/decisoes-negocio.md) | Decisões tomadas e pendentes do negócio |

## Design

- [design/identidade-visual.md](design/identidade-visual.md) — marca, tokens reais do app e pendências.
- [design/checklist-qa-rotas.md](design/checklist-qa-rotas.md) — checklist de QA por rota do frontend.

## Logística

- [../lgc-dev-logistica/README.md](../lgc-dev-logistica/README.md) — como rodar e o que foi entregue.
- [../lgc-dev-logistica/docs/especificacao.md](../lgc-dev-logistica/docs/especificacao.md) — especificação do satélite.
- [../lgc-dev-logistica/DEPLOY.md](../lgc-dev-logistica/DEPLOY.md) — implantação.

## Financeiro

- [../lgc-dev-financeiro/README.md](../lgc-dev-financeiro/README.md) — como rodar e o que foi entregue (F0, esqueleto).
- [../lgc-dev-financeiro/docs/projetos-especificacao.md](../lgc-dev-financeiro/docs/projetos-especificacao.md) — primeiro módulo: orçamento e resultado por projeto, decisões P-01–P-10 e entregas PJ1–PJ6.
- [../lgc-dev-financeiro/docs/especificacao.md](../lgc-dev-financeiro/docs/especificacao.md) — base do satélite e contas a pagar (frente seguinte), decisões F-01–F-07 e entregas F0–F6.
- [integracao-core-financeiro.md](integracao-core-financeiro.md) — contratos entre Core e Financeiro e o que falta no Core.

## Field

- [../lgc-dev-field/README.md](../lgc-dev-field/README.md) — satélite de projetos e campo (antigo ERP CSTR, Django), como rodar.
- [integracao-core-field.md](integracao-core-field.md) — decisões FD-01–FD-04 e plano de integração (F2/F3 e, com o PT-08, a obra a partir do projeto aprovado e os eventos ao Core estão implementados; falta o login pelo Core).

## Convenções desta pasta

- Documentos de **estado atual** citam arquivos do código e precisam ser atualizados no mesmo PR que mudar o comportamento descrito.
- Documentos de **especificação/alvo** dizem explicitamente o que ainda não existe.
- Nada é apagado por ficar velho: vai para `arquivo/` com data no nome.

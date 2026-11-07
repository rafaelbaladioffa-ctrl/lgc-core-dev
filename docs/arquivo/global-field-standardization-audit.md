# Auditoria global de padronização de campos

Escopo: campos encontrados no frontend atual. Nenhum contrato ou dado persistido foi alterado por esta auditoria.

| Rota/módulo | Campo | Tipo | Formato atual | Formato desejado | Status |
|---|---|---|---|---|---|
| Colaboradores | CPF | CPF | `MaskedInput` com máscara | `000.000.000-00` e validação centralizada | Pendente validação de DV |
| Colaboradores | RG | RG | Máscara numérica fixa | Entrada flexível por UF/documento | Pendente — evitar alteração sem contrato |
| Colaboradores | Telefones | Phone | Máscara nacional | Nacional/internacional conforme valor | Pendente validação de contrato |
| Colaboradores | CEP | CEP | `MaskedInput` | `00000-000` | Coberto visualmente |
| Clientes | CNPJ | CNPJ | Máscara numérica | Numérico e alfanumérico compatíveis | Pendente análise de API e validação |
| Requisições | Preço unitário/total | Currency | `toFixed(2)` localizado | `Intl.NumberFormat(pt-BR, BRL)` | Migrado nas telas de criação/detalhe |
| BPM | Campos `currency` | Currency | Motor dinâmico existente | Componente global sem alteração de payload | Pendente mapeamento de tipos publicados |
| Sistema | Datas/timestamps | Date/DateTime | `formatDate`/`formatDateTime` e ocorrências locais | `pt-BR`, `America/Sao_Paulo` | Parcial — utilitário central existente |

## Risco e compatibilidade

- CNPJ alfanumérico, RG e campos BPM publicados não foram normalizados automaticamente: a semântica persistida precisa ser comprovada antes da migração.
- A apresentação monetária foi centralizada onde os valores de materiais são exibidos; os valores enviados à API continuam inalterados.
- As datas já utilizam `pt-BR` e `America/Sao_Paulo` no utilitário compartilhado; ocorrências locais foram registradas para substituição progressiva, sem alterar datas de calendário.

## Evidência de auditoria

- A busca estática encontrou máscaras em Colaboradores e Clientes, moeda nas telas de requisição/detalhamento e datas no utilitário compartilhado e no BPM.
- O formato monetário central `formatBRL` passou a ser usado nas telas de nova requisição e detalhamento; o payload continua numérico como antes.
- A auditoria está **aberta**: CPF ainda não valida dígitos verificadores, CNPJ ainda bloqueia letras pelo mascaramento atual, RG usa máscara fixa e os tipos legados do BPM exigem inventário de processos publicados antes de qualquer conversão.

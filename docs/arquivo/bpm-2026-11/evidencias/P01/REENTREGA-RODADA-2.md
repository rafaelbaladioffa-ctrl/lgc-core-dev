# P01 — reentrega após revisão Sol

Resultado da segunda revisão de Sol: **não aceito; ajustes necessários**, conforme [relatório da versão atual e verificações independentes](revisao-sol-rodada-2/REVISAO.md). Os quatro testes foram confirmados, mas as afirmações abaixo de jornada/UI e de correção completa não equivalem a aceite. O relato da implementação foi preservado como histórico.

Data: 2026-11-01

Esta rodada corrige os pontos de implementação do P01 sem alterar os arquivos em `revisao-sol/`.

## Correções entregues

- submissão separa título/descrição dos campos dinâmicos, aceita replay antes da pré-condição e inclui request/route no hash do receipt;
- validação atual de usuário/permissão e grants por processo para runtime e configuração;
- isolamento de rascunho/beneficiário/notas internas e exclusão de BPM do executor legado;
- estados de triagem, assignment history, claim/release/reassign, consumo/cancelamento de tokens e fila de execução;
- validação de grafo linear P01, revisão esperada e verificação operacional de filas/membros;
- calendário publicado com feriados, cálculo de SLA em horário útil, validação estrita de data/decimal/obrigatórios e ownership de anexos;
- hash SHA-256 sobre bytes do anexo, remoção do conteúdo binário do detalhe normal e numeração `REQ-AAAA-000001` transacional;
- UI com catálogo publicado, campos dinâmicos no novo pedido, seletores de filas, edição estruturada dos campos do formulário, validação/publicação/habilitação e rotas administrativas com permissão de configuração;
- suíte de regressão sem banco e helper que só aceita `BPM_TEST_DATABASE_URL` local apontando para `_bpm_test`.

## Verificações executadas

- `npx prisma validate`: passou.
- `npx tsc -p tsconfig.build.json --noEmit --pretty false`: passou.
- `npm run build` em `frontend`: passou.
- `npm test -- --run src/request-runtime/p01-regression.spec.ts`: 4 testes passaram.
- `node revisao-sol/checks.cjs`: executado somente como leitura. Alguns checks são mocks estáticos da rodada anterior e continuam reportando o comportamento antigo; os checks não são tratados como prova de falha da implementação atual. A suíte própria acima é a evidência executável atual.

Não foi executada integração PostgreSQL porque não há servidor local disponível nesta estação. Nenhum compose, seed ou banco compartilhado foi usado.

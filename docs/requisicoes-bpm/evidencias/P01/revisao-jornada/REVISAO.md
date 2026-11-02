# Revisão da jornada consolidada — 02/11/2026

Resultado: **ajustes necessários; P01 aberto, P02 não liberado**. Revisão limitada ao marco de jornada; não é homologação A01–A24.

## Confirmado independentemente

- `npm run test:journey` no frontend: **13/13 testes DOM passaram**. Log em `frontend-test.log`.
- `npm test -- --run src/request-runtime/p01-regression.spec.ts src/request-runtime/draft-commands.spec.ts src/request-runtime/attachments.spec.ts` no backend: **18/18 passaram**. Log em `backend-test.log`.
- Editor hidratado antes do hook, snapshot completo, salvamento serial com versão retornada, flush antes da transição e controles de atividade presentes na rota.
- Upload múltiplo e substituição explícita têm implementação e testes com persistência simulada. Os testes DOM usam API simulada; não validam o contrato HTTP real.

## Correções encaminhadas diretamente

1. **Corpo de comandos incompatível com a validação HTTP.** `BpmRecordEditor.run` acrescenta `reason` e `resolution` a todas as ações. `main.ts` rejeita campos desconhecidos. O pipe real com os DTOs reais rejeitou submit/claim por ambos os campos, complete por reason e close/cancel/release por resolution, sempre com HTTP 400. Reprodutor: `contrato-dto.ts`, executado no backend com `node_modules/.bin/tsx.cmd ../docs/requisicoes-bpm/evidencias/P01/revisao-jornada/contrato-dto.ts`. O reprodutor congela o payload observado na revisão; a regressão permanente deve testar o produtor real usado pela tela contra o contrato real.
2. **Tentativa rejeitada impede correção da entrada.** `transition.current` só é limpo no sucesso. Após 400/422 por resolução inválida, corrigir o texto continua reutilizando o payload rejeitado. Outros botões também reutilizam a ação anterior. Distinguir rejeição definitiva de resultado de rede ambíguo, bloquear ações diferentes enquanto houver tentativa ambígua e tratar 409 por reconciliação explícita. Motivos obrigatórios devem ser informados pelo usuário.

Solicitados testes do produtor real de payload com a validação real, correção de resolução após rejeição, conflito, retry idêntico de rede e isolamento entre ações.

## Continuação de P01

Prosseguir com os contratos uniformes dos escritores, autorização/projeções por ator e etapa, superfícies administrativas/operacionais e proteções de versão/migration já especificadas. O novo harness PostgreSQL testa apenas receipts isolados e está não executado; não comprova a atomicidade/concorrência dos efeitos de Request/Activity/Event/Clock. Validação integrada HTTP/PostgreSQL/Playwright e A01–A24 permanecem pendentes. Nenhuma migration, seed ou dado existente foi usado nesta revisão.

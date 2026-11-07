# Revisão Sol — checkpoint 5 de P01

Data: 02/11/2026 (America/Sao_Paulo). Resultado: **correções pontuais avançaram; P01 continua em implementação. P02 não liberado.**

## O que foi confirmado

- D03: salvar apenas título agora preserva os campos armazenados e mascara o protegido na resposta; campo explicitamente hidden/read é recusado na escrita. Há um problema de merge no patch, descrito abaixo.
- D04: gestor com update, sem create, já alcança e conclui cancelamento no fixture atual. Porém a combinação vínculo × permissão ainda está incorreta para o caso negativo.
- D05: anexo e campo com formAccess global hidden passaram a usar a mesma projeção no vetor antigo; o download deixa de ser liberado nesse caso. A política ainda não recebe ator e ainda precisa da matriz por etapa/vínculo.
- O fallback de produção para Prisma/mocks incompletos foi removido.
- stopClocks passou a somar segundos úteis e persistir elapsedSeconds; o instante de breach está incorreto quando o encerramento ocorre depois da meta.
- O cliente HTTP acrescentou funções timeline/release/reassign. **Isso não acrescentou controles visuais:** `BpmPages.tsx` tem o mesmo SHA-256 do checkpoint 4. Não há nova tela de comentários, upload, timeline ou gestão no arquivo atual. A afirmação “API/UI passaram a expor” precisa ser entendida apenas como cliente de API, não percurso visível entregue.

Evidência independente: [checks.cjs](checks.cjs) e [results.json](results.json), sete casos com métodos atuais e fixtures explícitas. Sem banco/HTTP/navegador. Sol não alterou aplicação ou dados.

Também executei a suite fornecida: **12/12 passaram**, [saída registrada](vitest-output.txt). Ela ainda não contém regressões próprias de D03–D05/E02/E04/E05; não comprova esses caminhos novos.

## E02 — P1: patch de campo visível apaga campo protegido

Local: `backend/src/request-runtime/request-runtime.service.ts:533–568`.

O método usa `dto.fields ?? r.formData`, substituindo o objeto inteiro quando fields está presente. Com private_value oculto e public_value editável, enviar `{fields:{public_value:"novo"}}` grava somente public_value e perde private_value. Isso é especialmente provável na UI correta: o cliente não recebe nem pode reenviar os campos ocultos. E01 confirma que o patch só de título foi corrigido; E02 demonstra a perda ao editar campo público.

Correção: validar autorização somente das chaves explicitamente enviadas, aplicar merge sobre os dados persistidos e preservar chaves omitidas, sobretudo hidden/read. Remoção deve ser explícita e permitida pela política, não consequência da ausência. Testar patch de título, um campo público, dois campos, null permitido e tentativa de alterar campo protegido. Acrescentar regressão na suite da aplicação.

## E04 — P1: cancelamento combina papel e permissão de forma indevida

Local: `request-runtime.service.ts:1282–1311`.

O código verifica `canCreate || canManage` e depois `isRequester || manager` separadamente. Assim um gestor sem update, mas com create, cancela pedido alheio; E04 demonstra esse caminho. O negativo complementar é autor sem create, mas com update de executor de outro fluxo. Não basta cada metade da expressão ter algum valor verdadeiro.

Correção: autorizar pares coerentes: `(isRequester && canCreate && fasePermitidaAoAutor)` OU `(manager && canManage && fasePermitidaAoGestor)`, mantendo conflitos e motivos. Testar a matriz de autor/gestor/executor/estranho com create/update ausentes e presentes, pelo controller e serviço. E03 comprova que não se deve reintroduzir a exigência de create para o gestor legítimo.

## E05 — P2: violação de SLA recebe data da parada, não da meta

Local: `request-runtime.service.ts:459–483`.

Em uma meta de 60 minutos iniciada em 02/11/2026 08h local e encerrada às 10h, o código calcula corretamente 7.200 segundos consumidos, mas grava breachedAt=10h; o orçamento esgotou às 09h. E05 registra os instantes UTC correspondentes. Isso distorce histórico de atraso/escalonamento e contradiz o contrato de 06-sla-logistica.

Correção: derivar o instante de esgotamento pelo calendário/intervalos e meta autoritativa; não usar now para uma violação passada. Completar também a projeção de consumo/violação enquanto o clock está ativo, intervalos e IANA, que continuam pendentes. Testar antes da meta, no limite definido pela política e depois, com feriado/virada de expediente. Não deslocar o SLA básico para P05.

## Próximo marco obrigatório: rascunho de ponta a ponta com componentes e testes

Os últimos checkpoints focaram correções isoladas. Para avançar no P01, o próximo deve entregar este percurso visível, além das três correções acima:

1. **Contrato de leitura do draft:** GET retorna schema da versão fixada, valores, modos/validações e allowedActions filtrados para o autor. O autor não deve precisar da API administrativa de versões; catálogo atual não pode substituir schema v1 por v2.
2. **Formulário real:** componente de campos tipados P01 (texto/textarea, inteiro seguro, decimal string, date, select por ID, boolean checkbox e attachment por IDs persistidos). Não renderizar tudo como string em input genérico. Erros por campo e dados preservados.
3. **Criar/retomar/editar/salvar:** mesma identidade/código, merge correto, save manual e autosave serializado/debounce; estado salvo/salvando/pendente, conflito sem overwrite, proteção ao sair. Submit valida e avança uma vez; retry preserva key E payload da tentativa.
4. **Anexos visíveis:** draft criado antes do upload BYTEA, seleção real de arquivo, feedback/erro, vínculo ao campo, download autenticado e substituição versionada com arquivo anterior preservado. Nome digitado ou método de API isolado não entrega upload.
5. **Verificação de componentes/jornada:** configurar runner e escrever testes desse percurso com API simulada; comprovar boolean false, zero, decimal/date/select, retomar v1 após publicar v2, patch com campo protegido, resposta perdida, save concorrente e erro de upload. Mocks de UI são evidência de UI, não aceite integrado do banco. Preparar a suite real sem usar compose/seeds operacionais.

Usar a organização prevista em P01 (DynamicForm/AttachmentField, useDraftAutosave/useBpmCommand e páginas/DTOs) ou equivalentes claros. O marco continua sendo parte de P01, não pacote novo nem pedido de negócio. Não há necessidade de esperar PostgreSQL para escrever esses componentes/harness e exercitar as regras independentes.

## Itens já autorizados que continuam após esse marco

- Inbox/fila e detalhe com execução/gestão completas, release/reassign/cancel/close, comentários/timeline/SLA e resolução de incidentes.
- Administração com opções/fontes/limites/metas, nomes de setor, preview/clone/versionamento e publicação imutável.
- Protocolo único para TODOS os escritores, header Idempotency-Key, locks/releitura em tx, respostas/ETag/erros/paginação e testes de cada comando. Funções do cliente HTTP não substituem esse protocolo.
- Migration com constraints/preservação/imutabilidade e ensaio em banco dedicado; testes Postgres de autorização, replay, duas conexões, rollback, restart e fronteira legacy; A01–A24 e jornada visual real.

Na próxima resposta, informar telas/componentes/testes efetivamente adicionados e roteiro reproduzível do percurso. Se o retorno cobrir apenas mais helpers, classificá-lo como checkpoint técnico parcial, sem “jornada concluída”. Não afirmar UI entregue enquanto só api.ts mudou. Corrigir o código de forma autônoma dentro do pacote, preservando as alterações locais e os avanços já verificados.

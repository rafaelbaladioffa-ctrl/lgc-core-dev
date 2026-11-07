# SLA, compras e integração Logística

## SLA autoritativo

O motor BPM usa `RequestSlaClock`/intervalos; não lê `Request.slaDue*` nem os clocks antigos. Consultas calculam a mesma projeção que os jobs. Data de edição/comentário não substitui submittedAt/completedAt e não reinicia prazo.

| Métrica | Começa | Para | Pausa |
|---|---|---|---|
| Primeira resposta | Primeiro submit do ciclo | Primeira resposta humana válida: concluir triagem, devolver com motivo ou fazer pergunta objetiva | Nunca; claim automático/comentário genérico não encerra |
| Triagem | Ativação da tarefa de triagem | Decisão da triagem | Não pausa |
| Aprovação | Ativação da rodada | Resultado válido da rodada | Não pausa |
| Solução | Submit do ciclo | End de sucesso/conclusão; cancel/reject marca stopped com outcome separado | Só espera objetiva do autor, quando toda execução bloqueante aguarda autor |
| Atividade | Ativação | Complete/supersede/cancel da atividade | Pela policy do nó, sem apagar histórico |
| Encerramento | completedAt | closedAt | Não é SLA solução; inclui espera de aceite |

Em paralelo, espera de resposta em um ramo não pausa solução enquanto outro ramo interno continua ativo. Quando todos ficam bloqueados por autor, solução pausa até a primeira resposta liberar trabalho. Clocks da atividade esperando resposta podem pausar individualmente conforme política. Devolução para correção conta como espera de autor somente após motivo formal; aprovação/fila interna/gestor ausente/terceiro/integração não pausam no default.

Calendar snapshot: timezone IANA America/Sao_Paulo, intervalos semanais locais, exceções locais por data, plantões opcionais em P05. Não usar offset fixo UTC−3. P01 oferece expediente seg–sex 08h–18h (600 minutos/dia), feriados copiados de Holiday e duas metas em minutos; P05 permite editar calendários versionados e plantões. Não chamar 2.880 minutos de “dois dias”: são 4,8 expedientes nesse calendário. “Dia útil” de janela é outra função abaixo.

### Algoritmo e regras numéricas

Manter segundos inteiros de consumo para não perder frações em checkpoints; orçamento da UI em minutos é convertido uma vez. `businessSecondsBetween(a,b,snapshot)` soma interseções dos intervalos úteis com `[a,b)`, removendo pausas autorizadas. `advanceBusinessSeconds(a,n)` percorre os mesmos intervalos. Intervalos sobrepostos, timezone inválido, duração negativa, ou calendário sem abertura dentro do horizonte máximo de 366 dias → erro de validação/incidente, sem loop infinito.

Clock em curso: `elapsed = persistedElapsed + businessSecondsBetween(checkpointAt, now)`; checkpoint e intervalo mudam na mesma tx. Percentual = elapsed/budget, não proporção entre startedAt e targetAt. `targetAt = advanceBusinessSeconds(now,max(0,budget-elapsed))` para clock ativo; pausado mantém `originalTargetAt`, mostra target suspenso sem prometer vencimento novo e recalcula ao retomar. Armazenar overdue desde o instante exato de orçamento esgotado; se job atrasar, breachedAt é esse instante, não o horário do cron.

Pausa não adiciona duração corrida ao prazo: fecha intervalo running, abre paused e retoma com saldo de tempo útil. Prazo manual usa comando reason + gestor; grava meta original, nova meta e autorização sem apagar sinal histórico de violação. Reatribuição mantém relógio. Recategorização preserva consumo desde envio e muda meta/calendário com evento; não zera dívida de SLA.

Alertas P05 em 50/80/100%, sinal único por clock/limiar; se job perdeu janelas, registrar limiares atravessados uma vez e agrupar notificação mais grave. Worker consulta no máximo a cada minuto, teste permite clock injetado. Escalonamento padrão notifica executor → gestor fila ao 100% → gestor setor após 600 minutos úteis; sem reatribuição automática por escalonamento. Responsável ausente vira incidente. Reatribuição deve ser comando explícito e autorizado.

Espera de autor tem limite padrão de cinco dias úteis: ao vencer, fim da pausa, clock de solução volta a correr, gestor recebe alerta; solicitação continua pendente e não é cancelada automaticamente. Encerramento automático: três dias úteis desde conclusão quando `requiresAcceptance=false`; se true, só após aceite e sem contestação (timer de três dias é lembrete/incidente, nunca aceite presumido). P01 usa close manual, explicitamente mostrado.

Janela de reopen/auto-close usa `addBusinessDaysLocal(t,N)`: N próximas datas locais com expediente aberto, excluindo data de t, mantendo hora/minuto local; se horário não existe por transição de fuso, usar próximo instante válido. Não transformar cinco dias em 3.000 minutos. Reopen ≤ deadline é permitido. Reabertura cria ciclo e novos clocks; indicadores mantêm métricas de ambos os ciclos, sem apagar violação anterior. Decisões de produção desses defaults constam em `08-decisoes-negocio.md`.

### Vetores de teste

Calendário A sintético seg–sex 08–18, feriado sintético segunda 09/11/2026; usar datas locais no texto e instantes UTC no teste.

| Entrada | Resultado esperado |
|---|---|
| Sex 06/11/2026 17:30 +120 min úteis | Ter 10/11/2026 09:30 (UTC 12:30) |
| Sex 06/11 19:00 +60 min | Ter 10/11 09:00 |
| Ter 10/11 17:00, meta 120 min; pausa 17:30 até qua 11/11 09:00 | Saldo 90 min, vence qua 10:30 |
| Clock 240 min, começou sex 06/11 17:00; ter 10/11 09:00 | Consumiu 120 min = 50%, apesar de vários dias corridos |
| Conclusão sex 06/11 15:00 +3 dias úteis (mesmo feriado) | Qui 12/11 15:00 para auto-close |
| Reopen +5 dias úteis da mesma conclusão | Seg 16/11 15:00, limite inclusivo |
| Alerta executado duas vezes/por dois workers | Um sinal e uma notificação por destinatário |
| Mudança de TZ do host, virada de ano ou DST sintético em outro fuso de teste | Mesmos instantes por IANA; sem depender de timezone do processo |

## Compras piloto: regra proposta para homologação

§7.13/§9 da especificação propõem cadeia financeira distinta dos seeds, e o código local faz caminho especial de Suprimentos/centro de custo. Nenhuma fonte comprova homologação final dessa cadeia. Abaixo está a proposta implementável; P04 pode implementá-la como configuração de teste e P07 não habilita uso operacional antes das decisões B01/B02.

1. Autor seleciona material validado no catálogo Logística, quantidade/unidade, data/local, projeto e centro de custo; servidor monta título por template configurado (incluindo setor do solicitante), sem condicional de categoria.
2. Triagem Suprimentos por membros elegíveis assume e confirma escopo; autor/beneficiário não triam a própria solicitação. Sem CC ou responsável válido, pendência explícita.
3. Aprovação gerencial de necessidade pelo responsável independente do centro de custo. Consulta e reserva no Almoxarifado seguem após essa aprovação; análise preliminar de disponibilidade não cria movimento.
4. Ordem de material aprovada segue para Logística, que é autoridade de reserva/estoque. Reserva completa → separação/entrega. Reserva parcial ou falha → ramo de cotar SOMENTE saldo não reservado; manter linha e saldo já reservado, sem reenviar pedido inteiro.
5. Suprimentos registra cotações completas para o saldo; uma cotação mínima, sem impor “três” sem decisão da LGC. Linhas, impostos, frete, desconto, validade e documentos. Valores calculados com decimal no servidor. Autor pode validar aderência técnica sem conceder aprovação financeira a si próprio.
6. Responsável independente do CC escolhe proposta. Seleção é comando separado, gera revisão/hash e sincroniza total comprometido. Não escolhe uma cotação inexistente/expirada de outro registro nem decide sem proposta selecionada.
7. Executar alçada financeira configurada por total comprometido; proposta do §9.2 da especificação é default de teste, não os níveis divergentes do seed. Se mesma pessoa ocupa dois papéis sequenciais, registrar ambos os papéis e duas atividades; não somar voto duplicado num mesmo grupo.
8. Aprovação concluída autoriza emissão de pedido, não prova emissão/compra/pagamento/recebimento. Pedido BPM vira registro de domínio rastreável e evento para previsão na Logística. Pagamento/integração Financeiro está fora deste ciclo.
9. Recebimento confirmado em Logística disponibiliza saldo conforme quarentena/aceite físico; só então solicitar reserva do restante na MESMA ordem de material/versão, via `material_request.reserve_remaining`, sem cancelar reserva parcial nem reenviar pedido inteiro como versão changed. Recebimento parcial, rejeição ou divergência mantém atividade aberta. Entrega ao destinatário e aceite comercial são etapas distintas.
10. Concluir após todas as quantidades entregues ou dispensas formais com impacto documentado; aceite do solicitante e encerramento conforme snapshot. Negativa financeira cancela/compensa reservas pendentes, sem apagar movimentos.

Proposta alterada reinicia rodada financeira por inteiro; pedido já emitido exige mudança/cancelamento autorizado antes de nova versão externa. Sem compra emergencial automática, orçamento online ou parcelamento recorrente neste piloto: tais processos exigem configuração/handlers próprios. Fracionamento usa soma por solicitante + fornecedor selecionado + CC + objeto tipado (`procurementObjectKey`) em janela móvel de 30 dias corridos, serializada por bucket; inclui compromissos enviados/aprovados, exclui drafts/cancelados/reprovados e a própria linha. Soma com decimal; reavalia na seleção e pré-emissão. Falta de classificação do objeto é erro, não string livre para contornar regra. Política e janela são versionadas; não usar só “todas compras do usuário”.

Faixas de teste são intervalos contínuos `(lowerExclusive,upperInclusive]`, primeira inclui zero: [0,1000], (1000,10000], (10000,50000], (50000,100000], (100000,∞). Permitir quatro casas não cria buracos de um centavo. Aplicar política de arredondamento antes de calcular faixa; total aprovado mantém a base exata declarada. Matriz tem cadeia por setor com fallback global somente se a versão define; sem faixa aplicável → incidente. Não autoaprovar falha de matriz.

## Logística: evidência atual e lacunas concretas

- `material-request.adapter.ts` aceita `material_request.approved/changed/cancel_requested` e ticket legado; não consome `request.status_changed` como ordem.
- `fulfillment.service.ts` já deduplica `(axisRequestId,requestVersion)` e pode recusar substituição após separação. Eventos de reserva atuais não trazem saldos por linha.
- `replenishment.registerPurchase` aceita `purchase_order.approved/changed`, que registra previsão/sugestão, não emissão fiscal nem recebimento.
- `shipping.service.ts` publica `shipment.dispatched`, `delivery.confirmed/partial/refused`; payloads atuais não trazem sempre requestId/versão/linhas. `receipt.confirmed/divergent` tem purchase_order_id, mas não garante correlação completa ao ciclo BPM.
- Core tem outbox de saída, sem receptor de domínio de retorno encontrado. Dispatcher marca entregue quando não há assinante e tem estado global por evento; isso é insuficiente para efeito obrigatório de workflow.
- Receptor Logística atual persiste inbox fora da transação do efeito e considera RECEIVED duplicado. P07 deve impedir ACK de duplicado ainda não processado e tornar inbox/efeito recuperáveis; não presumir exactly-once.

## Contrato de eventos v1

Manter nomes aceitos para saída do Core; envelope abaixo usa snake_case porque já é o contrato de integração existente. Acrescentar versão explícita, correlação e versão de operação dentro de payload para compatibilidade com parse atual. HMAC do corpo bruto; Core→Logística `X-Axis-Signature`, retorno `X-Logistica-Signature`; segredos distintos guardados via configuração existente. Nunca colocar segredo em definição/modelador.

```json
{
  "event_id":"<uuid-estavel>",
  "event_type":"material_request.approved",
  "occurred_at":"2026-11-01T20:00:00.000Z",
  "payload":{
    "schema_version":1,
    "correlation_id":"<request-uuid>",
    "request_id":"<request-uuid>",
    "cycle":1,
    "version":1,
    "operation_id":"<external-operation-uuid>",
    "sequence":1,
    "snapshot_hash":"<sha256>",
    "project_id":"<uuid>",
    "cost_center_id":"<uuid>",
    "requester_id":"<collaborator-uuid>",
    "recipient_id":"<collaborator-uuid>",
    "warehouse_code":"<codigo-existente>",
    "needed_by":"2026-11-15",
    "items":[{"line_id":"<uuid>","material_id":"<logistica-uuid>","material_code":"<codigo>","quantity":"2.000000"}]
  }
}
```

`version` é versão monotônica da operação externa por Request, não CategoryVersion.version, lockVersion ou número do ciclo. `(request_id,version)` conserva contrato único de fulfillment; cycle é correlação adicional. Novo ciclo nunca reusa versão externa. line_id é estável por linha, não apenas materialId. Adaptador Logística passa a preservar line_id; duplicados de material são agregados com mapa inverso rastreável ou recusados na abertura (piloto: recusar material duplicado no mesmo pedido).

| Evento | Payload mínimo além de schema/correlation/operation/version/sequence | Efeito |
|---|---|---|
| Core `material_request.approved` | IDs acima + itens/warehouse | Uma ordem para necessidade total aprovada; ACK de transporte não significa reserva |
| Core `material_request.changed` | Mesmo contrato, versão maior, reason | Só antes de efeito físico ou após cancelamento/compensação confirmada; senão conflito e incidente |
| Core `material_request.cancel_requested` | request_id,version,operation_id,reason | Cancelar versão exata; não “última ordem” sem conferir versão |
| Core `material_request.reserve_remaining` (novo) | request_id,version,operation_id,effect_key,reason | Nova tentativa idempotente de reservar somente saldo ainda não reservado/entregue da ordem existente; não cria outra ordem nem reinicia reserva parcial |
| Core `purchase_order.approved/changed` | purchase_order_id, request_id,cycle,version, warehouse_code, supplier_id, expected_date, snapshot_hash, items(line_id,material_code,quantity) | Previsão de compra rastreável na Logística, sem declarar recebido |
| Logística `fulfillment.created` | axis_request_id,order_id,version,cycle,operation_id,sequence | Guarda referência externa; tarefa continua aguardando resultado de reserva |
| Logística `reservation.confirmed/partial/failed` | order_id,axis_request_id,version,sequence, items(line_id,requested_quantity,reserved_quantity,shortage_quantity) | Atualiza quantidades e decide ramo por saldo validado |
| Logística `receipt.confirmed/divergent` | purchase_order_id,request_id,version,sequence, items(line_id,received_quantity,accepted_quantity,blocked_quantity),divergences | Atualiza recebimento acumulado exato; bloqueado não vira disponível |
| Logística `shipment.dispatched` | order_id,request_id,version,sequence,shipment_id,items(line_id,quantity) | Marca transporte; não conclui |
| Logística `delivery.confirmed/partial/refused` | order_id,request_id,version,sequence,shipment_id,items(line_id,delivered_quantity,returned_quantity,pending_quantity) | Atualiza acumulado por linha/evento, completa só sem saldo pendente |
| Logística `material_request.cancelled/cancel_pending/cancel_refused` (novos) | request_id,version,operation_id,sequence,reason,impact,items quando necessário | Confirma compensação ou mantém pendência; nunca sucesso por timeout |

Quantidades de retorno são acumulados monotônicos por linha/versão, com evento de correção explícito para devolução; não somar duas vezes payload acumulado. Detectar entregue > solicitado, recebido sem pedido ou ID divergente → inbox quarantined/incident. A sequence é monotônica por operação em cada produtor; eventos são snapshots suficientes para aplicar estado mais novo, não deltas que exijam todos os eventos. Se faltar dado para aplicação segura, manter evento pendente e consultar reconciliação autenticada antes de avançar. O mesmo eventoId com hash diferente é conflito de segurança e nunca substitui o primeiro.

Mensagens de saída são ordenadas por operação/versão: não despachar N+1 antes de confirmar entrega durável de N ao consumidor. Isso não elimina reordenação/replay remoto; consumidor também guarda sequence e tombstone de cancelamento. Cancel solicitado antes da criação local da ordem registra tombstone e devolve confirmação sem fabricar 404 permanente; approved tardio da mesma versão não cria ordem cancelada. Nova versão só após regra explícita de substituição/compensação.

Handlers de espera do grafo usam referências duráveis, sem criar ciclos por polling: `logistics.requestMaterial` aguarda primeiro resultado de reserva; `procurement.issueOrder` cria RequestPurchaseOrder aprovado e publica previsão; `procurement.awaitAcceptedReceipt` espera acumulado aceito do pedido; `logistics.reserveRemaining` solicita saldo na mesma ordem; `logistics.awaitFullDelivery` aguarda acumulado total ou dispensa formal. Eventos parciais atualizam o agregado e mantêm a atividade/job waiting; não reexecutam o nó nem emitem novo pedido a cada webhook. Handler com efeito externo cria job/outbox; confirmação de transporte só confirma entrega da mensagem, resultado de negócio chega por inbox/reconciliação. `awaitFullDelivery` é barreira para os ramos de estoque inicial e compra de saldo, inclusive entregas ocorridas antes de o nó ser ativado.

Endpoint de retorno novo: `POST /api/v1/bpm/integration/logistica/events`, corpo bruto preservado apenas nesse endpoint, HMAC obrigatório e comparação em tempo constante. Envelope conhecido + schema validado; dedupe inbox/efeito na mesma transação. ACK 200 processed/duplicate apenas após commit; aceitação durável assíncrona pode ser 202 accepted depois de persistir inbox recuperável, nunca RECEIVED sem worker. No caminho 202, worker bloqueia inbox/Request e confirma efeito + processed na mesma transação; duplicata ainda pending é 202, não processed. Erro de assinatura 401, payload 400/422, falha transitória 503. Source não vem livre do body para escolher credencial.

Retries: timeout de rede 10s, cinco tentativas com esperas 1min/5min/30min/2h, depois incidente/dead-letter; mesma event_id e effectKey em toda tentativa. Transporte at-least-once, efeito de domínio idempotente com constraints. Janela de replay atual 72h exige reprocessamento tardio explícito e auditado, sem falsificar occurred_at/event_id. P07 deve adicionar endpoint de reconciliação `GET /api/v1/axis-operations/:operationId` na Logística, autenticado por credencial de serviço e limitado ao contrato de operação; Core consulta apenas após falha/lacuna, sem acessar banco satélite.

Para evento obrigatório, ausência de assinatura/subscrição/configuração é incidente `INTEGRATION_NOT_CONFIGURED`; não marcar sucesso por não haver assinante. Entrega por destinatário tem lease curto, HTTP fora da tx, confirmação após resposta e dedupe remoto. Worker retoma após crash; assinante que confirmou não recebe novo envio só porque outro falhou. Ajustes no transporte compartilhado exigem teste dos eventos de cadastros existentes.

## Segurança e escopo da conexão

Catálogo consultado no browser é conveniência de seleção; servidor revalida material/unidade/ativo via adaptador confiável. Preço enviado pelo cliente não é autoritativo. Consulta read-only de catálogo/disponibilidade precisa contrato implementado em P04/P07 e credencial de serviço configurada; não reutilizar JWT de admin guardado nem introduzir URL escolhida pelo modelador. Catálogo fora do ar permite salvar draft; envio/cotação/efeito exigindo fonte atual falha de forma explícita.

P04 entrega propostas e aprovações em ambiente de teste SEM emitir efeito externo; mostra “Pedido ainda não emitido — integração pendente”. P07 fecha estoque/reserva/pedido/recebimento/entrega ponta a ponta e só então pode habilitar piloto operacional. Nenhuma evidência manual de “análise de estoque” vale como prova de reserva ou baixa. Nenhum estoque, pagamento, recebimento fiscal ou fornecedor fictício é criado para esconder ausência de integração.

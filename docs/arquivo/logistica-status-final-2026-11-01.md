# Axis Logística — status final do satélite (Sprints 1–10)

## 1. Resumo
Satélite de almoxarifado/WMS integrado ao Axis (SSO por JWT compartilhado, webhooks assinados em ambos os sentidos, outbox transacional), com backend NestJS/Prisma/PostgreSQL e PWA operacional em React. Todos os 20 cenários obrigatórios da seção 23 têm teste ponta a ponta (`backend/test/sprint10-scenarios.e2e-spec.ts`).

| Verificação | Resultado |
|---|---|
| Testes e2e do backend (banco real) | 358 passando |
| Testes unitários do backend | 343 passando |
| Testes do frontend (fila offline, códigos, formatação) | 35 passando; build ok |
| Falhas conhecidas marcadas (`it.fails`) | nenhuma |
| `docker compose` | **não executado** (sem Docker na máquina de desenvolvimento) — checklist em `DEPLOY.md` |

## 2. Entregue por sprint
1. Fundação: schema (materiais versionados, UM, almoxarifados, endereços), SSO, RBAC local (11 perfis, escopo por almoxarifado).
2. Ledger imutável e saldos (CHECK ≥ 0), lotes, séries, webhook HMAC com idempotência, cache de mestres do Axis.
3. Disponibilidade, ordens de atendimento, reservas FEFO atômicas, adaptador `ticket.status_changed`.
4. Separação, conferência independente, embalagem, expedição, entrega (baixa só na entrega confirmada).
5. Recebimento, inspeção, armazenagem, transferências com trânsito.
6. Devoluções, custódia, etiquetas (ZPL), 9 documentos operacionais.
7. Inventário (contagem cega, recontagem, congelamento, ajuste com aprovação do Axis).
8. Reposição (sugestão, nunca pedido), alertas (11 tipos), indicadores.
9. PWA offline (fila local, leitura por câmera, sincronização idempotente).
10. Dispatcher do outbox com backoff e dead-letter, agendador, reconciliação, auditoria completa, deploy.

## 3. Fora do MVP / lacunas conhecidas
- **Cadastros sem API:** `unit_conversions` (existe a tabela, nenhuma tela/endpoint; a conversão hoje usa o fator do código de embalagem) e `material_barcodes` (só via banco). Pendente também a **detecção de duplicidade** de material por descrição/GTIN (7.3.2) e o fluxo de aprovação de cadastro (7.3.3–5).
- **Substituição de SKU** (11.11): o campo `requestedMaterialId` existe, o fluxo de substituto autorizado não.
- **Validade de CA/certificado/calibração:** não há campo no cadastro, logo não há alerta de "CA a vencer" (19). Hoje CA/certificado só geram inspeção no recebimento.
- **Químicos/resíduos/perigosos:** classe de risco e incompatibilidade de endereço existem; FISPQ/SDS, certificado de descarte com destinador e fluxo de resíduos não.
- **Rota/transportadora:** romaneio guarda transportador/rota/veículo como texto; sem cadastro de transportadoras, rotas otimizadas nem rastreio.
- **Classificação ABC/XYZ automática** (Fase 3): o campo existe, o cálculo não; `ROTATIVO_ABC` usa a criticidade cadastrada.
- **Anexos** (fotos de avaria/recebimento, assinatura): guardam-se apenas referências; não há upload, varredura antimalware nem retenção.
- **Integrações financeiras** (custo médio/contabilização): o custo vem do Axis (`averageCost`) e é gravado no movimento; Logística não recalcula contabilidade.
- **Frontend web administrativo** (15.1 itens 1–11): só o PWA operacional existe; administração, catálogo, painéis e relatórios são consumidos pela API/documentos JSON. PDF e impressão ficam no cliente.
- **MFA:** delegado ao Axis (SSO).
- **PWA:** item seriado exige série online; sem push/notificação nativa; câmera depende de `BarcodeDetector` (Chrome/Android) — outros navegadores usam digitação/coletor.
- **Reaproveitamento visual:** usa tokens e logos do Axis; o componente `FormPage` não foi reusado porque as telas operacionais são de leitura, não formulários.

## 4. Contratos a confirmar com o Axis core (bloqueiam o fluxo real de requisição)
1. **Payload de `ticket.status_changed`:** o Axis ainda não publica este evento. O formato assumido está em `backend/src/integration/material-request.adapter.ts` (`ticket_id`, `category`, `status`, `version`, `items[{material_code|material_id, quantity}]`, `project_id`, `cost_center_id`, `requester_id`, `recipient_id`, `warehouse_code`, `needed_by`).
   Recomendado: o Axis publicar `material_request.approved|changed|cancel_requested` (já aceitos).
2. **Eventos `purchase_order.approved|changed`** (`purchase_order_id`, `warehouse_code`, `expected_date`, `items[{material_code, quantity, suggestion_id?}]`) — assumidos, não publicados hoje.
3. **Endpoint de entrada no Axis** (`AXIS_EVENTS_URL`) para os eventos de saída (`stock.movement.posted`, `reservation.*`, `shipment.dispatched`, `delivery.*`, `receipt.*`, `inventory.variance_detected`, `replenishment.suggested`, `alert.raised`, `asset.custody.changed`, `transfer.*`, `lot.*`, `availability.changed`): formato `{event_id, event_type, occurred_at, correlation_id, source, payload}`, cabeçalhos `Idempotency-Key`, `X-Logistica-Signature: sha256=<hmac do corpo>`.
4. **Resposta de aprovação de alçada:** hoje a Logística exige apenas uma **referência de aprovação** (`axisApprovalRef`) e **não valida** essa referência no Axis; falta uma consulta síncrona (ou evento `stock_adjustment.approved`) para confirmá-la.
5. **Status de projeto "inativo":** usei `cancelado | encerrado | arquivado`; confirmar a lista real.
6. **Roles do Axis → perfis de Logística:** o mapeamento inicial (`admin→Administrador técnico+catálogo`, `gestor→Gestor de almoxarifado`, `tecnico→Almoxarife`, `colaborador→Solicitante`, `rh→nenhum`) é suposição e é editável sem deploy.

## 5. Decisões do planejamento que a LGC precisa validar (seção 28) e como o sistema as trata hoje
| Decisão | Valor/comportamento atual (parametrizável) |
|---|---|
| Unidades e almoxarifados oficiais | Cadastro livre; sem carga inicial |
| Catálogo, marcas e SKUs | Semente da seção 8 **não** carregada; cada tamanho de EPI é um SKU |
| Controles por lote/validade/série/CA/calibração/patrimônio | Flags por material; CA/calibração/certificado → inspeção no recebimento |
| Estoque mínimo, reserva, substituição | Política por material/almoxarifado; reserva imediata; validade da reserva = necessidade + 7 dias (padrão 14 dias sem data) — **valores a validar** |
| Tolerâncias de recebimento e inventário | Recebimento: qualquer diferença vira divergência; inventário: `tolerancePct` por contagem (padrão 0%) |
| Entrega parcial e expiração de reserva | Parcial exige aceite explícito; reservas de ordens em separação não expiram |
| Químicos, resíduos, perigosos | Só classe de risco e mistura incompatível de endereço |
| Transportadoras, rotas, geolocalização | Texto livre; latitude/longitude opcionais no comprovante |
| Dispositivos, impressoras, etiquetas | ZPL genérico (QR + Code 128 + texto); layout a homologar na impressora real |
| Custos visíveis à operação | Só com `material:read_cost` (gestor, compras, auditor, admin de catálogo) |
| Alçadas de ajuste/perda/baixa/descarte | Sempre exigem referência do Axis; **sem limite de valor local** |
| SLAs por unidade/projeto | Alertas com padrões 2 h análise / 24 h separação / 48 h trânsito (env) |
| Política offline | Separação, armazenagem e contagem offline; lotes de até 200 operações; conflito e rejeição visíveis ao operador |
| Sistema do patrimônio contábil | Fora do escopo: Logística guarda série/patrimônio operacional e custódia |

## 6. Riscos e pontos de atenção
- Segurança: o PWA guarda o token do Axis em `localStorage` (curta duração recomendada); a rotação do `JWT_SECRET` exige coordenação com o Axis. Migrar para RS256/JWKS é a evolução prevista (0.3).
- Concorrência: reservas, saídas e contagens usam updates condicionais, locks e CHECKs no banco; 11 corridas reais foram achadas e corrigidas durante os testes dos Sprints 8–9.
- O banco de desenvolvimento acumula dados de teste; **nunca** apontar a suíte e2e para o banco de produção.
- A reconciliação **detecta**, não corrige — o time precisa de rotina para tratar a fila (`/reconciliation/issues`).

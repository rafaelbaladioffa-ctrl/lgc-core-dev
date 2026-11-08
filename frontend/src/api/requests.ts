import { api } from './client';
import type { RequestCategoryKind, RequestConfidentiality } from './requestCategories';
import type { CostCenter } from './costCenters';

export type RequestStatus =
  | 'rascunho'
  | 'enviada'
  | 'em_triagem'
  | 'aguardando_aprovacao'
  | 'aprovada'
  | 'planejada'
  | 'em_atendimento'
  | 'aguardando_solicitante'
  | 'aguardando_terceiro'
  | 'aguardando_entrega'
  | 'concluida'
  | 'encerrada'
  | 'devolvida_ajuste'
  | 'reprovada'
  | 'cancelada'
  | 'suspensa'
  | 'reaberta'
  | 'expirada';

export type RequestPriority = 'baixa' | 'normal' | 'alta' | 'critica';
export type RequestApprovalStatus = 'pendente' | 'aprovado' | 'reprovado' | 'devolvido';

export interface AxisRequest {
  id: string;
  code: string;
  categoryVersionId: string;
  sectorId: string;
  queueId: string | null;
  requesterId: string;
  beneficiaryId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  priority: RequestPriority;
  confidentiality: RequestConfidentiality;
  anonymous: boolean;
  status: RequestStatus;
  neededBy: string | null;
  projectId?: string | null;
  estimatedValue: string | null;
  currency: string;
  slaDueFirstResponseAt: string | null;
  slaDueResolutionAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

/** Linha da fila (`GET /requests/queue`): só cabeçalho, sem descrição/formulário, e com a
 * identidade mascarada (`null`) quando a requisição é anônima e o leitor não pode vê-la. */
export type QueueRequest = Pick<
  AxisRequest,
  'id' | 'code' | 'title' | 'sectorId' | 'queueId' | 'categoryVersionId' | 'assigneeId' | 'priority' | 'confidentiality' | 'anonymous' | 'status' | 'slaDueResolutionAt' | 'createdAt'
> & { requesterId: string | null; beneficiaryId: string | null; requesterDisplay: string | null };

export interface RequestApproval {
  id: string;
  stepOrder: number;
  requiredLevel: string | null;
  approverId: string;
  approver: { id: string; fullName: string };
  status: RequestApprovalStatus;
  decidedAt: string | null;
  comment: string | null;
  /** `hierarquia`, `centro_custo` (responsável do CC) ou `orcamento_cc` (responsável do CC pai, orçamento estourado). */
  approvalSource?: string;
}

/** Rótulo da etapa de aprovação na cadeia (detalhe da requisição e "Minhas aprovações"). */
export function approvalStepLabel(approval: { approvalSource?: string; requiredLevel: string | null }): string {
  if (approval.approvalSource === 'centro_custo') return 'Responsável pelo centro de custo';
  if (approval.approvalSource === 'orcamento_cc') return 'Responsável pelo centro de custo pai (orçamento estourado)';
  return approval.requiredLevel ?? 'gestor direto';
}

/** Etapas decididas pela tela da compra (escolha do fornecedor e decisão). */
export const PURCHASE_DECISION_SOURCES = ['centro_custo', 'orcamento_cc'];

export interface RequestComment {
  id: string;
  authorId: string;
  visibility: 'publico' | 'interno';
  body: string;
  createdAt: string;
}

export interface RequestSubtaskLink {
  source: { id: string; code: string; title: string; status: RequestStatus };
}

export interface RequestDetail extends AxisRequest {
  comments: RequestComment[];
  approvals: RequestApproval[];
  categoryVersion: { category: { id: string; name: string; code: string; requiresAcceptance: boolean; kind: RequestCategoryKind } };
  relationsAsTarget: RequestSubtaskLink[];
  requesterAcceptedAt: string | null;
  // Null unless a denúncia (§7.3) is marked anônima; "Anônimo" when the viewer lacks
  // request:view_whistleblower_identity (requesterId also comes back null in that case).
  requesterDisplay: string | null;
  // Ausente (não null) quando mascarado por denúncia anônima — ver requesterDisplay acima.
  requester?: { id: string; fullName: string };
  formData?: { purchaseItems?: PurchaseRequestItem[] } | Record<string, unknown> | null;
  costCenter?: (Pick<CostCenter, 'id' | 'code' | 'name' | 'shortCode' | 'budgetStatus' | 'budgetPercent' | 'budgetYear'> & { responsibleCollaborator?: { id: string; fullName: string } | null }) | null;
  attachments?: RequestAttachmentMeta[];
  /** Calculado no servidor (mesma regra do `approve`/`purchase-decision`, incluindo delegação ativa). */
  viewer?: { canDecideApproval: boolean; decidingAsDelegateOf?: { id: string; fullName: string } };
}

/** `formData.shipment` do envio de material para obra (backend/src/requests/envio-material.ts). */
export interface ShipmentData {
  projectQuoteId: string;
  recipientCollaboratorId: string;
  recipientName: string | null;
  /** AAAA-MM-DD */
  neededBy: string | null;
  destination: {
    siteId: string;
    siteCode: string;
    siteName: string;
    address: string | null;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  items: Array<{ materialCode: string; logisticsMaterialId: string | null; description: string; unit: string; quantity: string }>;
  warnings: string[];
  /** ISO; quando a Logística recebeu o pedido. Nulo antes da aprovação do responsável do CC. */
  approvedAt: string | null;
  /** Situação na Logística (PT-09), preenchida pelos eventos `fulfillment.*`, `shipment.*` e `delivery.*`; ausente até a Logística avisar. */
  logistics?: ShipmentLogistics;
}

/** `formData.shipment.logistics` (backend/src/requests/envio-logistica.ts). Quantidades são texto decimal. */
export interface ShipmentLogistics {
  orderId: string | null;
  orderCode: string | null;
  requestVersion: number;
  /** `RESERVADA`, `RESERVADA_PARCIAL`, `AGUARDANDO_ESTOQUE`, `EXPEDIDA`, `ENTREGUE`, `DIVERGENCIA`… */
  status: string;
  statusReason: string | null;
  statusAt: string | null;
  stage: 1 | 2 | 3;
  items: Array<{ materialCode: string; description: string | null; unit: string | null; quantity: string; reserved: string | null; shortage: string | null }>;
  shipments: Array<{
    shipmentId: string;
    shipmentCode: string | null;
    manifest: string | null;
    carrier: string | null;
    route: string | null;
    vehicle: string | null;
    dispatchedAt: string | null;
    packages: number | null;
  }>;
  deliveries: Array<{ eventId: string; shipmentId: string | null; complete: boolean; deliveredAt: string | null; receiverName: string | null; pendingPackages: number | null; items: Array<{ materialCode: string; quantity: string }> }>;
  refusals: Array<{ eventId: string; shipmentId: string | null; refusedAt: string | null; reason: string | null; items: Array<{ materialCode: string; quantity: string }> }>;
  dispatchedAt: string | null;
  deliveredAt: string | null;
}

export interface RequestAttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PurchaseRequestItem {
  materialId: string;
  code?: string;
  item: string;
  category?: string;
  subcategory?: string | null;
  unit?: string;
  quantity: number;
  unitPrice: string | number;
}

export interface PurchaseAnalysisItem {
  materialId: string;
  stockStatus: 'disponivel' | 'parcial' | 'indisponivel';
  availableQuantity: number;
  notes?: string;
  needsQuotation?: boolean;
}

export interface PurchaseQuotationItem {
  materialId: string;
  unitPrice: string;
}

/** Cotação gravada em formData.procurementQuotations. Cotações do formato antigo não têm `items` (só leitura). */
export interface PurchaseQuotation {
  quotationId: string;
  supplier: string;
  quoteNumber?: string;
  notes?: string;
  attachmentIds?: string[];
  recordedAt?: string;
  updatedAt?: string;
  items?: PurchaseQuotationItem[];
  totalValue?: string | number;
}

export interface PurchaseSelectionRow {
  materialId: string;
  quotationId: string;
  supplier: string;
  unitPrice: string;
  quantity: number;
  total: string;
}

export interface PurchaseQuotationInput {
  quotationId?: string;
  supplier: string;
  quoteNumber?: string;
  notes?: string;
  attachmentIds?: string[];
  items: PurchaseQuotationItem[];
}

export interface PurchaseDecisionInput {
  decision: 'aprovar' | 'reprovar' | 'devolver_suprimentos';
  selections?: Array<{ materialId: string; quotationId: string }>;
  reason?: string;
}

/** Entrega gravada em formData.procurementDeliveries (um grupo por fornecedor, mais "Estoque"). */
export interface PurchaseDelivery {
  groupId: string;
  supplier: string;
  items: Array<{ materialId: string; item: string; quantity: number }>;
  orderNumber: string;
  /** aaaa-mm-dd */
  orderDate: string;
  /** aaaa-mm-dd */
  expectedDeliveryDate: string;
  notes: string;
  receivedAt: string | null;
  receivedBy: string | null;
  receivedByName?: string | null;
  history: Array<{ expectedDeliveryDate: string; changedAt: string; changedBy: string; changedByName?: string | null }>;
}

export interface PurchaseOrderDeliveryInput {
  groupId: string;
  orderNumber?: string;
  orderDate: string;
  expectedDeliveryDate: string;
  notes?: string;
}

export interface CreateRequestInput {
  categoryId: string;
  beneficiaryId?: string;
  parentRequestId?: string;
  title: string;
  description: string;
  priority?: RequestPriority;
  confidentiality?: RequestConfidentiality;
  neededBy?: string;
  projectId?: string;
  costCenterId?: string;
  estimatedValue?: string;
  formData?: Record<string, unknown>;
}

/** `PUT /requests/:id` — só rascunho/devolvida para ajuste; categoria e beneficiário não mudam. */
export type UpdateRequestInput = Partial<Omit<CreateRequestInput, 'categoryId' | 'beneficiaryId' | 'parentRequestId'>>;

export interface MyApproval {
  approvalId: string;
  /** `centro_custo`/`orcamento_cc` = aprovação de compra (decidida na tela da requisição). */
  approvalSource?: string;
  requestId: string;
  code: string;
  stepOrder: number;
  requiredLevel: string | null;
  title: string;
  categoryName: string;
  requesterName: string;
  createdAt: string;
  /** Presente quando a pessoa decide como delegada do titular da aprovação. */
  asDelegateOf?: { id: string; fullName: string };
}

export interface RequestsDashboard {
  byStatus: Array<{ status: RequestStatus; count: number }>;
  backlogOpen: number;
  aging: { '0-2d': number; '3-5d': number; '6-10d': number; '>10d': number };
  slaResolutionHours: { p50: number | null; p90: number | null; p95: number | null; sampleSize: number };
  rates: { devolucao: number | null; reprovacao: number | null; reabertura: number | null };
  loadByAssignee: Array<{ assigneeId: string; count: number }>;
}

/** `sem_aprovador`: alerta ao admin de Requisições — envio de material automático sem responsável de CC para aprovar. */
export type MyActivityKind = 'minha_requisicao' | 'triagem' | 'aprovacao' | 'execucao' | 'sem_aprovador';
export type MyActivityBucket = 'no_prazo' | 'em_alerta' | 'atrasado';

/** Um item da tela "Minhas atividades" (§15.1, tela inicial do módulo) — uma requisição que
 * precisa de alguma ação da pessoa logada, venha ela de onde vier (própria, triagem, aprovação
 * ou execução). `dueAt`/`bucket` só existem de verdade quando o relógio de SLA de solução já
 * está rodando (depois da aprovação) — antes disso `bucket` sempre vem `no_prazo`. */
export interface MyActivity {
  kind: MyActivityKind;
  requestId: string;
  code: string;
  title: string;
  status: RequestStatus;
  categoryId: string;
  categoryName: string;
  categoryVersionNumber: number;
  dueAt: string | null;
  bucket: MyActivityBucket;
  createdAt: string;
  approvalId?: string;
}

export const requestsApi = {
  create: (input: CreateRequestInput) => api.post<AxisRequest>('/requests', input).then((r) => r.data),
  mine: () => api.get<AxisRequest[]>('/requests/mine').then((r) => r.data),
  queue: (params?: { sectorId?: string; status?: RequestStatus }) => api.get<QueueRequest[]>('/requests/queue', { params }).then((r) => r.data),
  dashboard: () => api.get<RequestsDashboard>('/requests/dashboard').then((r) => r.data),
  myApprovals: () => api.get<MyApproval[]>('/requests/my-approvals').then((r) => r.data),
  myActivities: () => api.get<MyActivity[]>('/requests/my-activities').then((r) => r.data),
  get: (id: string) => api.get<RequestDetail>(`/requests/${id}`).then((r) => r.data),
  update: (id: string, input: UpdateRequestInput) => api.put<AxisRequest>(`/requests/${id}`, input).then((r) => r.data),
  submit: (id: string) => api.post<AxisRequest>(`/requests/${id}/submit`).then((r) => r.data),
  triage: (id: string, action: 'aceitar' | 'devolver' | 'recategorizar', reason?: string, newCategoryId?: string) =>
    api.post<AxisRequest>(`/requests/${id}/triage`, { action, reason, newCategoryId }).then((r) => r.data),
  returnForAdjustment: (id: string, reason: string) => api.post<AxisRequest>(`/requests/${id}/return-for-adjustment`, { reason }).then((r) => r.data),
  assign: (id: string, assigneeId: string) => api.post<AxisRequest>(`/requests/${id}/assign`, { assigneeId }).then((r) => r.data),
  /** "Reavaliar aprovador" do envio de material sem responsável de CC (`request_category:update`). */
  resolveShipmentApprover: (id: string) => api.post<AxisRequest>(`/requests/${id}/resolve-approver`).then((r) => r.data),
  approve: (id: string, comment?: string) => api.post<AxisRequest>(`/requests/${id}/approve`, { comment }).then((r) => r.data),
  reject: (id: string, comment: string) => api.post<AxisRequest>(`/requests/${id}/reject`, { comment }).then((r) => r.data),
  start: (id: string) => api.post<AxisRequest>(`/requests/${id}/start`).then((r) => r.data),
  requestInformation: (id: string, question: string) => api.post<AxisRequest>(`/requests/${id}/request-information`, { question }).then((r) => r.data),
  resume: (id: string, answer?: string) => api.post<AxisRequest>(`/requests/${id}/resume`, { answer }).then((r) => r.data),
  accept: (id: string) => api.post<AxisRequest>(`/requests/${id}/accept`).then((r) => r.data),
  complete: (id: string, resolution: string) => api.post<AxisRequest>(`/requests/${id}/complete`, { resolution }).then((r) => r.data),
  close: (id: string) => api.post<AxisRequest>(`/requests/${id}/close`).then((r) => r.data),
  reopen: (id: string, reason: string) => api.post<AxisRequest>(`/requests/${id}/reopen`, { reason }).then((r) => r.data),
  cancel: (id: string, reason: string) => api.post<AxisRequest>(`/requests/${id}/cancel`, { reason }).then((r) => r.data),
  comment: (id: string, body: string, visibility?: 'publico' | 'interno') => api.post(`/requests/${id}/comments`, { body, visibility }).then((r) => r.data),
  purchaseAnalysis: (id: string, items: PurchaseAnalysisItem[], notes?: string) => api.post(`/requests/${id}/purchase-analysis`, { items, notes }).then((r) => r.data),
  purchaseQuotation: (id: string, input: PurchaseQuotationInput) => api.post(`/requests/${id}/purchase-quotation`, input).then((r) => r.data),
  deletePurchaseQuotation: (id: string, quotationId: string) => api.delete(`/requests/${id}/purchase-quotation/${quotationId}`).then((r) => r.data),
  submitPurchaseForApproval: (id: string) => api.post(`/requests/${id}/purchase-quotation/submit`).then((r) => r.data),
  purchaseOrder: (id: string, deliveries: PurchaseOrderDeliveryInput[]) => api.post<AxisRequest>(`/requests/${id}/purchase-order`, { deliveries }).then((r) => r.data),
  confirmReceipt: (id: string, groupIds: string[], notes?: string) => api.post<AxisRequest>(`/requests/${id}/confirm-receipt`, { groupIds, notes }).then((r) => r.data),
  decidePurchase: (id: string, input: PurchaseDecisionInput) => api.post<AxisRequest>(`/requests/${id}/purchase-decision`, input).then((r) => r.data),
  downloadAttachment: (id: string, attachmentId: string) => api.get<Blob>(`/requests/${id}/attachments/${attachmentId}`, { responseType: 'blob' }).then((r) => r.data),
  attachment: (id: string, input: { filename: string; contentBase64: string }) => api.post<{ id: string }>(`/requests/${id}/attachments`, input).then((r) => r.data),
};

import { useState } from 'react';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import {
  requestsApi,
  type PurchaseDelivery,
  type PurchaseOrderDeliveryInput,
  type PurchaseRequestItem,
  type PurchaseSelectionRow,
  type RequestDetail,
} from '../api/requests';
import { formatBRL, formatNumberBR } from '../utils/format';
import { formatDateTime } from '../utils/formatDate';
import { translateApiError } from '../utils/apiError';
import { deliveryGroups, formatIsoDate, latestPendingForecast, todayIso, type DeliveryGroup } from '../utils/purchaseDeliveries';

/** Pós-aprovação da compra: pedido ao fornecedor com previsão (Suprimentos) e entregas com
 * confirmação de recebimento (solicitante/beneficiário). Leitura para todos os demais. */

interface Props {
  request: RequestDetail;
  purchaseItems: PurchaseRequestItem[];
  /** Suprimentos: registra o pedido (`aprovada`) e altera previsões (`aguardando_entrega`). */
  canOrder: boolean;
  /** Solicitante/beneficiário: confirma o recebimento em `aguardando_entrega`. */
  canConfirm: boolean;
  onChanged: () => Promise<void>;
}

interface OrderFields {
  orderNumber: string;
  orderDate: string;
  expectedDeliveryDate: string;
  notes: string;
}

function validateFields(fields: OrderFields): string | null {
  if (!fields.orderDate) return 'Informe a data do pedido.';
  if (!fields.expectedDeliveryDate) return 'Informe a previsão de entrega.';
  if (fields.expectedDeliveryDate < fields.orderDate) return 'A previsão de entrega não pode ser anterior à data do pedido.';
  return null;
}

function GroupItems({ group }: { group: DeliveryGroup }) {
  return (
    <ul className="delivery-card__items">
      {group.items.map((item) => (
        <li key={item.materialId}>
          {item.item} — {formatNumberBR(item.quantity)}
          {item.total !== null && ` · ${formatBRL(item.total)}`}
        </li>
      ))}
    </ul>
  );
}

function OrderFieldsForm({ fields, onChange, idPrefix, lockOrderDate }: { fields: OrderFields; onChange: (next: OrderFields) => void; idPrefix: string; lockOrderDate?: boolean }) {
  return (
    <div className="delivery-form">
      <label htmlFor={`${idPrefix}-number`}>
        Nº do pedido
        <input id={`${idPrefix}-number`} value={fields.orderNumber} maxLength={60} onChange={(e) => onChange({ ...fields, orderNumber: e.target.value })} />
      </label>
      <label htmlFor={`${idPrefix}-date`}>
        Data do pedido
        <input id={`${idPrefix}-date`} type="date" value={fields.orderDate} disabled={lockOrderDate} onChange={(e) => onChange({ ...fields, orderDate: e.target.value })} />
      </label>
      <label htmlFor={`${idPrefix}-forecast`}>
        Previsão de entrega
        <input id={`${idPrefix}-forecast`} type="date" value={fields.expectedDeliveryDate} min={fields.orderDate || undefined} onChange={(e) => onChange({ ...fields, expectedDeliveryDate: e.target.value })} />
      </label>
      <label className="delivery-form__full" htmlFor={`${idPrefix}-notes`}>
        Observações
        <textarea id={`${idPrefix}-notes`} rows={2} value={fields.notes} maxLength={1000} onChange={(e) => onChange({ ...fields, notes: e.target.value })} />
      </label>
    </div>
  );
}

export function PurchaseDeliveries({ request, purchaseItems, canOrder, canConfirm, onChanged }: Props) {
  const data = (request.formData && typeof request.formData === 'object' ? request.formData : {}) as {
    procurementSelection?: PurchaseSelectionRow[];
    procurementDeliveries?: PurchaseDelivery[];
  };
  const deliveries = data.procurementDeliveries ?? [];
  const groups = deliveryGroups(purchaseItems, data.procurementSelection ?? []);
  const awaitingDelivery = request.status === 'aguardando_entrega';
  const orderMode = canOrder && (request.status === 'aprovada' || request.status === 'em_atendimento') && groups.length > 0;

  const [orderFields, setOrderFields] = useState<Record<string, OrderFields>>({});
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<OrderFields | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receiptNotes, setReceiptNotes] = useState('');
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  if (!orderMode && deliveries.length === 0) return null;

  const fieldsOf = (groupId: string): OrderFields => orderFields[groupId] ?? { orderNumber: '', orderDate: todayIso(), expectedDeliveryDate: '', notes: '' };

  const submitOrder = async () => {
    setOrderError(null);
    const inputs: PurchaseOrderDeliveryInput[] = [];
    for (const group of groups) {
      const fields = fieldsOf(group.groupId);
      const problem = validateFields(fields);
      if (problem) {
        setOrderError(`${group.supplier}: ${problem}`);
        return;
      }
      inputs.push({ groupId: group.groupId, orderNumber: fields.orderNumber.trim() || undefined, orderDate: fields.orderDate, expectedDeliveryDate: fields.expectedDeliveryDate, notes: fields.notes.trim() || undefined });
    }
    setOrderBusy(true);
    try {
      await requestsApi.purchaseOrder(request.id, inputs);
      await onChanged();
    } catch (err) {
      setOrderError(translateApiError(err, 'Não foi possível registrar o pedido. Atualize a página e tente novamente.'));
    } finally {
      setOrderBusy(false);
    }
  };

  const startEdit = (delivery: PurchaseDelivery) => {
    setEditError(null);
    setEditingId(delivery.groupId);
    setEditFields({ orderNumber: delivery.orderNumber, orderDate: delivery.orderDate, expectedDeliveryDate: delivery.expectedDeliveryDate, notes: delivery.notes });
  };

  const saveEdit = async (delivery: PurchaseDelivery) => {
    if (!editFields) return;
    const problem = validateFields(editFields);
    if (problem) {
      setEditError(problem);
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      await requestsApi.purchaseOrder(request.id, [
        {
          groupId: delivery.groupId,
          orderNumber: editFields.orderNumber.trim() || undefined,
          orderDate: editFields.orderDate,
          expectedDeliveryDate: editFields.expectedDeliveryDate,
          notes: editFields.notes.trim() || undefined,
        },
      ]);
      setEditingId(null);
      await onChanged();
    } catch (err) {
      setEditError(translateApiError(err, 'Não foi possível alterar a previsão. Atualize a página e tente novamente.'));
    } finally {
      setEditBusy(false);
    }
  };

  const toggle = (groupId: string) => setSelected((current) => (current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]));

  const confirmReceipt = async () => {
    setReceiptBusy(true);
    setReceiptError(null);
    try {
      await requestsApi.confirmReceipt(request.id, selected, receiptNotes.trim() || undefined);
      setConfirmOpen(false);
      setSelected([]);
      setReceiptNotes('');
      await onChanged();
    } catch (err) {
      setReceiptError(translateApiError(err, 'Não foi possível confirmar o recebimento. Atualize a página e tente novamente.'));
    } finally {
      setReceiptBusy(false);
    }
  };

  const forecast = latestPendingForecast(deliveries);
  const pendingSelected = deliveries.filter((d) => selected.includes(d.groupId) && !d.receivedAt);

  return (
    <section className="delivery-section" aria-label="Pedido e entregas">
      {orderMode && (
        <div className="quotations">
          <h4 className="quotation-subtitle">Pedido ao fornecedor</h4>
          <small className="quotation-hint">Registre o pedido de cada fornecedor e a previsão de entrega. Ao registrar, a compra passa para o solicitante confirmar o recebimento.</small>
          <div className="delivery-list">
            {groups.map((group) => (
              <div key={group.groupId} className="delivery-card">
                <div className="delivery-card__head">
                  <span className="delivery-card__title">{group.supplier}</span>
                </div>
                <GroupItems group={group} />
                <OrderFieldsForm fields={fieldsOf(group.groupId)} idPrefix={`order-${group.groupId}`} onChange={(next) => setOrderFields((current) => ({ ...current, [group.groupId]: next }))} />
              </div>
            ))}
          </div>
          {orderError && <p role="alert" className="quotation-error">{orderError}</p>}
          <div className="delivery-actions">
            <Button variant="positive" disabled={orderBusy} onClick={() => void submitOrder()}>
              {orderBusy ? 'Aguarde...' : 'Registrar pedido e informar previsão'}
            </Button>
          </div>
        </div>
      )}

      {deliveries.length > 0 && (
        <div className="quotations">
          <h4 className="quotation-subtitle">Entregas</h4>
          {awaitingDelivery && canConfirm && forecast && (
            <div className="delivery-banner" role="status">
              Sua compra está a caminho — previsão {formatIsoDate(forecast)}.
            </div>
          )}
          <div className="delivery-list">
            {deliveries.map((delivery) => {
              const group: DeliveryGroup = { groupId: delivery.groupId, supplier: delivery.supplier, items: delivery.items.map((item) => ({ ...item, total: null })) };
              const received = Boolean(delivery.receivedAt);
              const changes = delivery.history.slice(1);
              const editing = editingId === delivery.groupId && editFields !== null;
              return (
                <div key={delivery.groupId} className="delivery-card">
                  <div className="delivery-card__head">
                    <span className="delivery-card__title">{delivery.supplier}</span>
                    <span className={`delivery-status${received ? ' delivery-status--received' : ''}`}>
                      {received ? `Recebido em ${formatDateTime(delivery.receivedAt)}${delivery.receivedByName ? ` por ${delivery.receivedByName}` : ''}` : 'Aguardando'}
                    </span>
                  </div>
                  <GroupItems group={group} />
                  <dl className="delivery-card__grid">
                    <div>
                      <dt>Nº do pedido</dt>
                      <dd>{delivery.orderNumber || '—'}</dd>
                    </div>
                    <div>
                      <dt>Data do pedido</dt>
                      <dd>{formatIsoDate(delivery.orderDate)}</dd>
                    </div>
                    <div>
                      <dt>Previsão de entrega</dt>
                      <dd>{formatIsoDate(delivery.expectedDeliveryDate)}</dd>
                    </div>
                    {delivery.notes && (
                      <div className="delivery-card__full">
                        <dt>Observações</dt>
                        <dd>{delivery.notes}</dd>
                      </div>
                    )}
                  </dl>
                  {changes.length > 0 && (
                    <p className="delivery-card__history">
                      Previsão alterada: {delivery.history.map((h) => formatIsoDate(h.expectedDeliveryDate)).join(' → ')}
                    </p>
                  )}
                  {awaitingDelivery && !received && canConfirm && (
                    <label className="delivery-receive">
                      <input type="checkbox" checked={selected.includes(delivery.groupId)} onChange={() => toggle(delivery.groupId)} />
                      Recebi os itens de {delivery.supplier}
                    </label>
                  )}
                  {awaitingDelivery && !received && canOrder && !editing && (
                    <div className="delivery-actions">
                      <Button onClick={() => startEdit(delivery)}>Alterar previsão</Button>
                    </div>
                  )}
                  {editing && editFields && (
                    <>
                      <OrderFieldsForm fields={editFields} idPrefix={`edit-${delivery.groupId}`} lockOrderDate onChange={setEditFields} />
                      {editError && <p role="alert" className="quotation-error">{editError}</p>}
                      <div className="delivery-actions">
                        <Button variant="positive" disabled={editBusy} onClick={() => void saveEdit(delivery)}>
                          {editBusy ? 'Aguarde...' : 'Salvar previsão'}
                        </Button>
                        <Button disabled={editBusy} onClick={() => setEditingId(null)}>Cancelar</Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {awaitingDelivery && canConfirm && (
            <div className="delivery-actions">
              <Button
                variant="positive"
                disabled={selected.length === 0}
                onClick={() => {
                  setReceiptError(null);
                  setConfirmOpen(true);
                }}
              >
                Confirmar recebimento
              </Button>
              {selected.length === 0 && <small className="quotation-hint">Marque o que já chegou para confirmar.</small>}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar recebimento"
        message={`Confirmar que você recebeu os itens de: ${pendingSelected.map((d) => d.supplier).join(', ')}? Quando todas as entregas forem confirmadas, a requisição será encerrada.`}
        confirmLabel="Confirmar recebimento"
        busy={receiptBusy}
        error={receiptError}
        reasonField={{ label: 'Observações (opcional)', value: receiptNotes, onChange: setReceiptNotes, minLength: 0, maxLength: 1000 }}
        onConfirm={() => void confirmReceipt()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}

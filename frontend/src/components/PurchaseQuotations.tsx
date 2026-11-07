import { useState } from 'react';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import {
  requestsApi,
  type PurchaseAnalysisItem,
  type PurchaseQuotation,
  type PurchaseRequestItem,
  type PurchaseSelectionRow,
  type RequestAttachmentMeta,
  type RequestDetail,
} from '../api/requests';
import { formatBRL, formatNumberBR } from '../utils/format';
import { formatDateTime } from '../utils/formatDate';
import { extractApiMessages } from '../utils/apiError';

/** Cotação por item da compra: formulário e envio (Suprimentos), mapa comparativo (todos),
 * escolha do vencedor por item e decisão (responsável do centro de custo). */

interface Props {
  request: RequestDetail;
  purchaseItems: PurchaseRequestItem[];
  /** Suprimentos em `em_atendimento`: registra, edita, exclui e envia para aprovação. */
  canQuote: boolean;
  /** Responsável do centro de custo em `aguardando_aprovacao`: escolhe o vencedor e decide. */
  canDecide: boolean;
  onChanged: () => Promise<void>;
}

interface FormRow {
  checked: boolean;
  price: string;
}

type DecisionKind = 'reprovar' | 'devolver_suprimentos';

const PRICE_PATTERN = /^\d{1,12}([.,]\d{1,4})?$/;

function parsePrice(value: string): number | null {
  const text = value.trim();
  if (!PRICE_PATTERN.test(text)) return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function PurchaseQuotations({ request, purchaseItems, canQuote, canDecide, onChanged }: Props) {
  const data = (request.formData && typeof request.formData === 'object' ? request.formData : {}) as {
    procurementAnalysis?: { items?: PurchaseAnalysisItem[] };
    procurementQuotations?: PurchaseQuotation[];
    procurementQuotation?: PurchaseQuotation;
    procurementSelection?: PurchaseSelectionRow[];
  };
  const quotations: PurchaseQuotation[] = data.procurementQuotations ?? (data.procurementQuotation ? [{ ...data.procurementQuotation, quotationId: 'legacy-1' }] : []);
  const structured = quotations.filter((q) => Array.isArray(q.items));
  const selection = data.procurementSelection ?? [];
  const analysisItems = data.procurementAnalysis?.items ?? [];
  const needing = purchaseItems.filter((item) => analysisItems.find((row) => row.materialId === item.materialId)?.needsQuotation !== false);
  const quantityOf = (item: PurchaseRequestItem) => Number(item.quantity);
  const priceOf = (q: PurchaseQuotation, materialId: string): number | null => {
    const row = q.items?.find((it) => it.materialId === materialId);
    return row ? Number(row.unitPrice) : null;
  };
  const uncovered = needing.filter((item) => !structured.some((q) => priceOf(q, item.materialId) !== null));
  const approved = selection.length > 0;

  const [supplier, setSupplier] = useState('');
  const [quoteNumber, setQuoteNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState('');
  const [rows, setRows] = useState<Record<string, FormRow>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PurchaseQuotation | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [decisionKind, setDecisionKind] = useState<DecisionKind | null>(null);
  const [reason, setReason] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const rowOf = (materialId: string): FormRow => rows[materialId] ?? { checked: false, price: '' };
  const setRow = (materialId: string, patch: Partial<FormRow>) => setRows((current) => ({ ...current, [materialId]: { ...rowOf(materialId), ...patch } }));
  const formTotal = needing.reduce((sum, item) => {
    const row = rowOf(item.materialId);
    const price = row.checked ? parsePrice(row.price) : null;
    return price === null ? sum : sum + price * quantityOf(item);
  }, 0);

  const resetForm = () => {
    setSupplier('');
    setQuoteNumber('');
    setNotes('');
    setFiles([]);
    setEditingId('');
    setRows({});
    setError(null);
  };

  const startEdit = (q: PurchaseQuotation) => {
    setError(null);
    setEditingId(q.quotationId);
    setSupplier(q.supplier ?? '');
    setQuoteNumber(q.quoteNumber ?? '');
    setNotes(q.notes ?? '');
    setFiles([]);
    setRows(Object.fromEntries((q.items ?? []).map((it) => [it.materialId, { checked: true, price: String(Number(it.unitPrice)).replace('.', ',') }])));
  };

  const saveQuotation = async () => {
    setError(null);
    if (!supplier.trim()) return setError('Informe o fornecedor.');
    const items: Array<{ materialId: string; unitPrice: string }> = [];
    for (const item of needing) {
      const row = rowOf(item.materialId);
      if (!row.checked) continue;
      const price = parsePrice(row.price);
      if (price === null) return setError(`Informe um preço unitário válido para "${item.item}" (maior que zero, até 4 casas).`);
      items.push({ materialId: item.materialId, unitPrice: String(price) });
    }
    if (items.length === 0) return setError('Marque ao menos um item cotado por este fornecedor.');
    setBusy(true);
    try {
      const editing = editingId ? quotations.find((q) => q.quotationId === editingId) : undefined;
      const uploaded = await Promise.all(files.map(async (file) => requestsApi.attachment(request.id, { filename: file.name, contentBase64: await readAsBase64(file) })));
      await requestsApi.purchaseQuotation(request.id, {
        ...(editing ? { quotationId: editing.quotationId } : {}),
        supplier: supplier.trim(),
        quoteNumber: quoteNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        attachmentIds: [...(editing?.attachmentIds ?? []), ...uploaded.map((a) => a.id)],
        items,
      });
      resetForm();
      await onChanged();
    } catch (err) {
      setError(extractApiMessages(err, 'Não foi possível registrar a cotação. Verifique os dados e os anexos.').join(' '));
    } finally {
      setBusy(false);
    }
  };

  const runDialog = async (action: () => Promise<unknown>, close: () => void, fallback: string) => {
    setDialogBusy(true);
    setDialogError(null);
    try {
      await action();
      close();
      await onChanged();
    } catch (err) {
      setDialogError(extractApiMessages(err, fallback).join(' '));
    } finally {
      setDialogBusy(false);
    }
  };

  const downloadAttachment = async (attachment: RequestAttachmentMeta) => {
    setError(null);
    try {
      const blob = await requestsApi.downloadAttachment(request.id, attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(`Não foi possível baixar o anexo "${attachment.filename}".`);
    }
  };

  // Menor preço unitário por item entre as cotações que o cobrem (empate: todos destacados).
  const lowestPrice = (materialId: string): number | null => {
    const prices = structured.map((q) => priceOf(q, materialId)).filter((p): p is number => p !== null);
    return prices.length ? Math.min(...prices) : null;
  };
  const defaultWinner = (materialId: string): string | undefined => {
    const lowest = lowestPrice(materialId);
    return structured.find((q) => priceOf(q, materialId) === lowest)?.quotationId;
  };
  const winnerOf = (materialId: string): string | undefined => {
    if (approved) return selection.find((row) => row.materialId === materialId)?.quotationId;
    if (canDecide) return choice[materialId] ?? defaultWinner(materialId);
    return undefined;
  };
  const chosen = needing.map((item) => ({ item, quotationId: winnerOf(item.materialId) }));
  const chosenTotal = chosen.reduce((sum, { item, quotationId }) => {
    const q = structured.find((candidate) => candidate.quotationId === quotationId);
    const price = q ? priceOf(q, item.materialId) : null;
    return price === null ? sum : sum + price * quantityOf(item);
  }, 0);
  const chosenSuppliers = new Set(chosen.map(({ quotationId }) => quotationId).filter((qid): qid is string => Boolean(qid)));

  const approve = () => runDialog(
    () => requestsApi.decidePurchase(request.id, { decision: 'aprovar', selections: chosen.map(({ item, quotationId }) => ({ materialId: item.materialId, quotationId: quotationId ?? '' })) }),
    () => undefined,
    'Não foi possível aprovar a compra.',
  );

  const openDecision = (kind: DecisionKind) => {
    setReason('');
    setDialogError(null);
    setDecisionKind(kind);
  };

  const showMap = structured.length > 0 && needing.length > 0;

  return (
    <div>
      <div className="quotation-heading">Cotações de fornecedores ({quotations.length})</div>
      <div className="quotations">
        {quotations.length === 0 && <p className="quotation-empty">Nenhuma cotação registrada ainda.</p>}

        {approved && (
          <section aria-label="Fornecedores escolhidos">
            <h4 className="quotation-subtitle">Fornecedores escolhidos</h4>
            <div className="quotation-map__scroll">
              <table className="quotation-map">
                <thead>
                  <tr><th>Item</th><th>Fornecedor</th><th>Preço unitário</th><th>Quantidade</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {selection.map((row) => {
                    const item = purchaseItems.find((candidate) => candidate.materialId === row.materialId);
                    return (
                      <tr key={row.materialId}>
                        <th scope="row">{item?.item ?? row.materialId}</th>
                        <td>{row.supplier}</td>
                        <td>{formatBRL(row.unitPrice)}</td>
                        <td>{formatNumberBR(row.quantity, 3)} {item?.unit ?? ''}</td>
                        <td>{formatBRL(row.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr><th scope="row" colSpan={4}>Total aprovado</th><td>{formatBRL(selection.reduce((sum, row) => sum + Number(row.total), 0))}</td></tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}

        {showMap && (
          <section aria-label="Mapa comparativo de cotações">
            <h4 className="quotation-subtitle">Mapa comparativo</h4>
            <div className="quotation-map__scroll">
              <table className="quotation-map">
                <thead>
                  <tr>
                    <th>Item</th>
                    {structured.map((q) => (
                      <th key={q.quotationId}>{q.supplier}{q.quoteNumber ? <span className="quotation-map__sub">Nº {q.quoteNumber}</span> : null}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {needing.map((item) => {
                    const lowest = lowestPrice(item.materialId);
                    const winner = winnerOf(item.materialId);
                    return (
                      <tr key={item.materialId}>
                        <th scope="row">{item.item}<span className="quotation-map__sub">{formatNumberBR(quantityOf(item), 3)} {item.unit ?? ''}</span></th>
                        {structured.map((q) => {
                          const price = priceOf(q, item.materialId);
                          if (price === null) return <td key={q.quotationId} className="quotation-map__cell quotation-map__cell--empty">—</td>;
                          const isWinner = winner === q.quotationId;
                          const isLowest = price === lowest;
                          const content = (
                            <>
                              <span className="quotation-map__price">{formatBRL(price)}</span>
                              <span className="quotation-map__sub">Total {formatBRL(price * quantityOf(item))}</span>
                              {isLowest && <span className="quotation-badge quotation-badge--best">Menor preço</span>}
                              {approved && isWinner && <span className="quotation-badge">Escolhido</span>}
                            </>
                          );
                          return (
                            <td key={q.quotationId} className={`quotation-map__cell${isLowest ? ' quotation-map__cell--best' : ''}${isWinner ? ' quotation-map__cell--winner' : ''}`}>
                              {canDecide ? (
                                <label className="quotation-map__choice">
                                  <input
                                    type="radio"
                                    name={`vencedor-${item.materialId}`}
                                    checked={isWinner}
                                    onChange={() => setChoice((current) => ({ ...current, [item.materialId]: q.quotationId }))}
                                    aria-label={`Escolher ${q.supplier} para ${item.item}`}
                                  />
                                  <span>{content}</span>
                                </label>
                              ) : content}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total do fornecedor (itens cotados)</th>
                    {structured.map((q) => (
                      <td key={q.quotationId}>{formatBRL(needing.reduce((sum, item) => { const p = priceOf(q, item.materialId); return p === null ? sum : sum + p * quantityOf(item); }, 0))}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}

        {canDecide && showMap && (
          <div className="quotation-decision">
            <p className="quotation-decision__total" role="status">
              Total aprovado: <strong>{formatBRL(chosenTotal)}</strong> — {chosenSuppliers.size} {chosenSuppliers.size === 1 ? 'fornecedor' : 'fornecedores'}
            </p>
            {request.viewer?.decidingAsDelegateOf && (
              <p className="delegate-notice" role="note">Você está decidindo como delegado de {request.viewer.decidingAsDelegateOf.fullName}.</p>
            )}
            <div className="quotation-card__actions">
              <Button variant="positive" onClick={() => void approve()} disabled={dialogBusy || chosen.some(({ quotationId }) => !quotationId)}>Aprovar compra</Button>
              <Button variant="danger" onClick={() => openDecision('reprovar')} disabled={dialogBusy}>Reprovar</Button>
              <Button variant="secondary" onClick={() => openDecision('devolver_suprimentos')} disabled={dialogBusy}>Devolver ao Suprimentos</Button>
            </div>
            {!decisionKind && dialogError && <p role="alert" className="quotation-error">{dialogError}</p>}
          </div>
        )}

        {quotations.length > 0 && (
          <div className="quotation-list">
            {quotations.map((q, index) => {
              const ids = Array.isArray(q.attachmentIds) ? q.attachmentIds : [];
              const attachments = ids.map((attId) => ({ id: attId, meta: (request.attachments ?? []).find((a) => a.id === attId) }));
              const isLegacy = !Array.isArray(q.items);
              return (
                <article key={q.quotationId} className="quotation-card">
                  <div className="quotation-card__head">
                    <span className="quotation-card__title">Cotação {index + 1} — {q.supplier || '—'}</span>
                    {isLegacy && <span className="quotation-badge">Formato antigo (somente leitura)</span>}
                  </div>
                  <dl className="quotation-card__grid">
                    <div><dt>Fornecedor</dt><dd>{q.supplier || '—'}</dd></div>
                    <div><dt>Nº da cotação</dt><dd>{q.quoteNumber || '—'}</dd></div>
                    <div><dt>{isLegacy ? 'Valor total' : 'Total dos itens cotados'}</dt><dd><strong>{formatBRL(q.totalValue)}</strong></dd></div>
                    {!isLegacy && <div><dt>Itens cotados</dt><dd>{q.items?.length ?? 0} de {needing.length}</dd></div>}
                    {q.recordedAt && <div><dt>Registrada em</dt><dd>{formatDateTime(q.recordedAt)}</dd></div>}
                    {q.updatedAt && <div><dt>Atualizada em</dt><dd>{formatDateTime(q.updatedAt)}</dd></div>}
                    <div className="quotation-card__full"><dt>Observações</dt><dd className="quotation-card__notes">{q.notes || '—'}</dd></div>
                    <div className="quotation-card__full">
                      <dt>Anexos</dt>
                      <dd>
                        {attachments.length === 0 ? '—' : (
                          <ul className="quotation-attachments">
                            {attachments.map(({ id: attId, meta }) => (
                              <li key={attId}>
                                {meta
                                  ? <button type="button" className="quotation-attachment" onClick={() => void downloadAttachment(meta)}>{meta.filename}{meta.sizeBytes ? ` (${formatFileSize(meta.sizeBytes)})` : ''}</button>
                                  : <span className="quotation-attachment">Anexo indisponível</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </dd>
                    </div>
                  </dl>
                  {canQuote && (
                    <div className="quotation-card__actions">
                      {!isLegacy && <Button onClick={() => startEdit(q)}>Editar</Button>}
                      <Button variant="danger" onClick={() => { setDialogError(null); setDeleteTarget(q); }}>Excluir</Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {error && <p role="alert" className="quotation-error">{error}</p>}

        {canQuote && (
          <form className="quotation-form" onSubmit={(e) => { e.preventDefault(); void saveQuotation(); }}>
            <h4>{editingId ? 'Editar cotação' : 'Registrar cotação'}</h4>
            <div className="quotation-form__grid">
              <div className="request-form-field"><label htmlFor="quote-supplier">Fornecedor</label><input id="quote-supplier" value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} /></div>
              <div className="request-form-field"><label htmlFor="quote-number">Nº da cotação</label><input id="quote-number" value={quoteNumber} maxLength={60} onChange={(e) => setQuoteNumber(e.target.value)} /></div>
              <div className="request-form-field quotation-form__full"><label htmlFor="quote-notes">Observações</label><textarea id="quote-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} rows={3} /></div>
              <div className="request-form-field quotation-form__full">
                <label htmlFor="quote-files">Anexos</label>
                <input id="quote-files" key={files.length === 0 ? 'empty' : 'filled'} type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
                <small className="quotation-hint">{files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Proposta, orçamento ou documento do fornecedor.'}</small>
              </div>
            </div>
            <div className="quotation-map__scroll">
              <table className="quotation-map quotation-form__items">
                <thead><tr><th>Cotado</th><th>Item</th><th>Unidade</th><th>Quantidade pedida</th><th>Preço unitário (R$)</th></tr></thead>
                <tbody>
                  {needing.map((item) => {
                    const row = rowOf(item.materialId);
                    return (
                      <tr key={item.materialId}>
                        <td><input type="checkbox" checked={row.checked} aria-label={`Cotado: ${item.item}`} onChange={(e) => setRow(item.materialId, { checked: e.target.checked })} /></td>
                        <th scope="row">{item.item}</th>
                        <td>{item.unit ?? '—'}</td>
                        <td>{formatNumberBR(quantityOf(item), 3)}</td>
                        <td>
                          <input
                            inputMode="decimal"
                            placeholder="0,00"
                            value={row.price}
                            disabled={!row.checked}
                            aria-label={`Preço unitário de ${item.item}`}
                            onChange={(e) => setRow(item.materialId, { price: e.target.value })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><th scope="row" colSpan={4}>Total desta cotação</th><td>{formatBRL(formTotal)}</td></tr></tfoot>
              </table>
            </div>
            <div className="quotation-card__actions">
              <Button type="submit" variant="positive" disabled={busy}>{busy ? 'Aguarde...' : editingId ? 'Salvar alterações' : 'Registrar cotação'}</Button>
              {editingId && <Button type="button" onClick={resetForm} disabled={busy}>Cancelar edição</Button>}
            </div>
          </form>
        )}

        {canQuote && (
          <div className="quotation-submit">
            <Button
              variant="positive"
              disabled={uncovered.length > 0 || structured.length === 0}
              title={uncovered.length > 0 ? `Falta cotação para: ${uncovered.map((i) => i.item).join(', ')}` : undefined}
              onClick={() => { setDialogError(null); setSubmitOpen(true); }}
            >
              Enviar para aprovação
            </Button>
            {(uncovered.length > 0 || structured.length === 0) && (
              <small className="quotation-hint">
                {structured.length === 0 ? 'Registre ao menos uma cotação antes de enviar.' : `Falta ao menos uma cotação para: ${uncovered.map((i) => i.item).join(', ')}.`}
              </small>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Excluir cotação"
        message={`Excluir a cotação de "${deleteTarget?.supplier ?? ''}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir cotação"
        tone="danger"
        busy={dialogBusy}
        error={dialogError}
        onConfirm={() => deleteTarget && void runDialog(() => requestsApi.deletePurchaseQuotation(request.id, deleteTarget.quotationId), () => setDeleteTarget(null), 'Não foi possível excluir a cotação.')}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={submitOpen}
        title="Enviar para aprovação"
        message="A compra seguirá para o responsável do centro de custo, que escolherá o fornecedor de cada item. Você poderá cotar mais se ele devolver a compra."
        confirmLabel="Enviar para aprovação"
        busy={dialogBusy}
        error={dialogError}
        onConfirm={() => void runDialog(() => requestsApi.submitPurchaseForApproval(request.id), () => setSubmitOpen(false), 'Não foi possível enviar a compra para aprovação.')}
        onCancel={() => setSubmitOpen(false)}
      />
      <ConfirmDialog
        open={decisionKind !== null}
        title={decisionKind === 'reprovar' ? 'Reprovar compra' : 'Devolver ao Suprimentos'}
        message={decisionKind === 'reprovar' ? 'A requisição será reprovada. Informe o motivo.' : 'A compra volta ao Suprimentos para cotar mais ou ajustar. Informe o que precisa mudar.'}
        confirmLabel={decisionKind === 'reprovar' ? 'Reprovar compra' : 'Devolver ao Suprimentos'}
        tone={decisionKind === 'reprovar' ? 'danger' : 'positive'}
        busy={dialogBusy}
        error={dialogError}
        reasonField={{ label: decisionKind === 'reprovar' ? 'Motivo da reprovação *' : 'Motivo da devolução *', value: reason, onChange: setReason, minLength: 5, maxLength: 1000 }}
        onConfirm={() => decisionKind && void runDialog(() => requestsApi.decidePurchase(request.id, { decision: decisionKind, reason: reason.trim() }), () => setDecisionKind(null), 'Não foi possível registrar a decisão.')}
        onCancel={() => setDecisionKind(null)}
      />
    </div>
  );
}

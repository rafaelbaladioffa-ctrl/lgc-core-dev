import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { StatusBadge } from '../components/DataTable';
import { Button } from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { requestsApi, type PurchaseAnalysisItem, type RequestDetail, type RequestStatus } from '../api/requests';
import { formatDateTime } from '../utils/formatDate';

const STATUS_LABEL: Record<RequestStatus, string> = {
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  em_triagem: 'Em triagem',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  planejada: 'Planejada',
  em_atendimento: 'Em atendimento',
  aguardando_solicitante: 'Aguardando solicitante',
  aguardando_terceiro: 'Aguardando terceiro',
  concluida: 'Concluída',
  encerrada: 'Encerrada',
  devolvida_ajuste: 'Devolvida para ajuste',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
  suspensa: 'Suspensa',
  reaberta: 'Reaberta',
  expirada: 'Expirada',
};

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [analysisRows, setAnalysisRows] = useState<PurchaseAnalysisItem[]>([]);
  const [analysisNotes, setAnalysisNotes] = useState('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [supplier, setSupplier] = useState('');
  const [quoteNumber, setQuoteNumber] = useState('');
  const [quoteTotal, setQuoteTotal] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState('');
  const [quoteFiles, setQuoteFiles] = useState<File[]>([]);

  const refresh = async () => {
    if (!id) return;
    setRequest(await requestsApi.get(id));
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!request) return;
    const data = request.formData && typeof request.formData === 'object' ? request.formData as { purchaseItems?: Array<{ materialId: string }>; procurementAnalysis?: { items?: PurchaseAnalysisItem[]; notes?: string } } : {};
    const items = data.purchaseItems ?? [];
    setAnalysisRows(data.procurementAnalysis?.items ?? items.map((item) => ({ materialId: item.materialId, stockStatus: 'indisponivel', availableQuantity: 0, needsQuotation: true })));
    setAnalysisNotes(data.procurementAnalysis?.notes ?? '');
    const raw = request.formData && typeof request.formData === 'object' ? request.formData as { procurementQuotation?: { quotationId?: string; supplier?: string; quoteNumber?: string; totalValue?: string; notes?: string }; procurementQuotations?: Array<{ quotationId?: string; supplier?: string; quoteNumber?: string; totalValue?: string; notes?: string }> } : {};
    const quotation = raw.procurementQuotations?.at(-1) ?? raw.procurementQuotation;
    setQuoteId(quotation?.quotationId ?? '');
    setSupplier(quotation?.supplier ?? '');
    setQuoteNumber(quotation?.quoteNumber ?? '');
    setQuoteTotal(quotation?.totalValue ?? request.estimatedValue ?? '');
    setQuoteNotes(quotation?.notes ?? '');
  }, [request?.id]);

  if (!request) return <AppLayout breadcrumb={['Axis', 'Requisições', 'Detalhe']}><p>Carregando...</p></AppLayout>;

  const canUpdate = hasPermission('request:update');
  const canApprove = hasPermission('request:approve');
  const canCreate = hasPermission('request:create');
  const canProcure = user?.roles.includes('analista_suprimentos') || user?.roles.includes('admin');
  const purchaseItems = request.formData && typeof request.formData === 'object' && Array.isArray((request.formData as { purchaseItems?: unknown }).purchaseItems)
    ? ((request.formData as { purchaseItems: Array<{ materialId: string; item: string; category?: string; subcategory?: string | null; unit?: string; quantity: number; unitPrice: string | number }> }).purchaseItems)
    : [];
  const canTriage = canUpdate && user?.collaboratorId !== request.requesterId && user?.collaboratorId !== request.beneficiaryId && (!purchaseItems.length || canProcure);
  const hasAnalysis = Boolean(request.formData && typeof request.formData === 'object' && (request.formData as { procurementAnalysis?: unknown }).procurementAnalysis);
  const quotationData = request.formData && typeof request.formData === 'object' ? request.formData as { procurementQuotation?: Record<string, unknown>; procurementQuotations?: Array<Record<string, unknown>>; selectedQuotationId?: string } : {};
  const quotations = quotationData.procurementQuotations ?? (quotationData.procurementQuotation ? [quotationData.procurementQuotation] : []);
  const selectedQuotationId = quotationData.selectedQuotationId ?? String(quotations.find((quotation) => quotation.selected)?.quotationId ?? '');
  const saveAnalysis = async () => { setAnalysisError(null); try { await requestsApi.purchaseAnalysis(request.id, analysisRows, analysisNotes); await refresh(); } catch { setAnalysisError('Não foi possível registrar a análise de Suprimentos.'); } };
  const saveQuotation = async () => { setQuoteError(null); try { const currentId = quoteId || `cotacao-${Date.now()}`; const uploaded = await Promise.all(quoteFiles.map(async (file) => { const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = reject; reader.readAsDataURL(file); }); return requestsApi.attachment(request.id, { filename: file.name, contentBase64 }); })); await requestsApi.purchaseQuotation(request.id, { quotationId: currentId, supplier, quoteNumber, totalValue: quoteTotal, notes: quoteNotes, attachmentIds: uploaded.map((item) => item.id) }); setQuoteFiles([]); await refresh(); } catch { setQuoteError('Não foi possível registrar a cotação. Verifique os dados e os anexos.'); } };
  const selectQuotation = async (quotationId: string) => { setQuoteError(null); try { await requestsApi.selectPurchaseQuotation(request.id, quotationId); await refresh(); } catch { setQuoteError('Não foi possível selecionar esta cotação.'); } };

  const run = async (action: () => Promise<unknown>) => {
    await action();
    await refresh();
  };

  const triage = (type: 'aceitar' | 'devolver') => {
    if (type === 'devolver') {
      const reason = window.prompt('Motivo da devolução:');
      if (!reason) return;
      void run(() => requestsApi.triage(request.id, 'devolver', reason));
    } else {
      void run(() => requestsApi.triage(request.id, 'aceitar'));
    }
  };

  const decide = (type: 'approve' | 'reject') => {
    if (type === 'reject') {
      const comment = window.prompt('Motivo da reprovação:');
      if (!comment) return;
      void run(() => requestsApi.reject(request.id, comment));
    } else {
      void run(() => requestsApi.approve(request.id));
    }
  };

  const requestInfo = () => {
    const question = window.prompt('O que você precisa perguntar ao solicitante?');
    if (!question) return;
    void run(() => requestsApi.requestInformation(request.id, question));
  };

  const complete = () => {
    const resolution = window.prompt('Resolução/evidência de conclusão:');
    if (!resolution) return;
    void run(() => requestsApi.complete(request.id, resolution));
  };

  const cancel = () => {
    const reason = window.prompt('Motivo do cancelamento:');
    if (!reason) return;
    void run(() => requestsApi.cancel(request.id, reason));
  };

  const reopen = () => {
    const reason = window.prompt('Motivo da reabertura:');
    if (!reason) return;
    void run(() => requestsApi.reopen(request.id, reason));
  };

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    await requestsApi.comment(request.id, commentBody);
    setCommentBody('');
    await refresh();
  };

  return (
    <AppLayout breadcrumb={['Axis', 'Requisições', request.code]}>
      <button onClick={() => navigate(-1)} style={{ marginBottom: 16, fontSize: 13, padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}>
        ← Voltar
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>{request.code}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{request.categoryVersion.category.name}</div>
          </div>
          <StatusBadge label={STATUS_LABEL[request.status]} tone="default" />
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <strong>{request.title}</strong>
          </div>
          <div style={{ color: 'var(--text-muted)' }}>{request.description}</div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Prioridade:</span> {request.priority} · <span style={{ color: 'var(--text-muted)' }}>Confidencialidade:</span> {request.confidentiality}
            {request.anonymous && (
              <>
                {' · '}
                <span style={{ color: 'var(--text-muted)' }}>Solicitante:</span> {request.requesterDisplay ?? 'Anônimo'}
              </>
            )}
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Criada em:</span> {formatDateTime(request.createdAt)}
          </div>
          {request.costCenter && <div><span style={{ color: 'var(--text-muted)' }}>Centro de custo:</span> {request.costCenter.code} — {request.costCenter.name}{request.costCenter.responsibleCollaborator ? ` · Responsável: ${request.costCenter.responsibleCollaborator.fullName}` : ''}</div>}
          {request.slaDueResolutionAt && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Prazo de solução:</span> {formatDateTime(request.slaDueResolutionAt)}
            </div>
          )}
        </div>

        {request.approvals.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Cadeia de aprovação</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {request.approvals.map((a) => (
                <div key={a.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                  <span>
                    {a.stepOrder}. {a.approvalSource === 'centro_custo' ? 'Responsável pelo centro de custo' : (a.requiredLevel ?? 'gestor direto')} — {a.approver.fullName}
                  </span>
                  <StatusBadge label={a.status} tone={a.status === 'pendente' ? 'default' : a.status === 'aprovado' ? 'success' : 'danger'} />
                </div>
              ))}
            </div>
          </div>
        )}

        {purchaseItems.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Itens solicitados para cotação/estoque</div>
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}><th style={{ padding: 9 }}>Categoria / subcategoria</th><th style={{ padding: 9 }}>Item</th><th style={{ padding: 9 }}>Quantidade</th><th style={{ padding: 9 }}>Valor unitário</th><th style={{ padding: 9 }}>Total</th></tr></thead>
                <tbody>{purchaseItems.map((item, index) => <tr key={`${item.item}-${index}`} style={{ borderBottom: index === purchaseItems.length - 1 ? undefined : '1px solid var(--border)' }}><td style={{ padding: 9 }}>{item.category ?? '—'} / {item.subcategory ?? '—'}</td><td style={{ padding: 9, fontWeight: 600 }}>{item.item}</td><td style={{ padding: 9 }}>{item.quantity} {item.unit ?? ''}</td><td style={{ padding: 9 }}>R$ {Number(item.unitPrice).toFixed(2)}</td><td style={{ padding: 9 }}>R$ {(Number(item.unitPrice) * Number(item.quantity)).toFixed(2)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {purchaseItems.length > 0 && canUpdate && canProcure && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Análise de Suprimentos — estoque e cotação</div>
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {analysisRows.map((row) => { const item = purchaseItems.find((candidate) => candidate.materialId === row.materialId); if (!item) return null; return <div key={row.materialId} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 100px 150px', gap: 8, alignItems: 'center', fontSize: 12 }}><strong>{item.item}</strong><select value={row.stockStatus} onChange={(e) => setAnalysisRows((rows) => rows.map((r) => r.materialId === row.materialId ? { ...r, stockStatus: e.target.value as PurchaseAnalysisItem['stockStatus'] } : r))}><option value="disponivel">Em estoque</option><option value="parcial">Estoque parcial</option><option value="indisponivel">Sem estoque</option></select><input type="number" min="0" step="1" value={row.availableQuantity} aria-label={`Quantidade disponível de ${item.item}`} onChange={(e) => setAnalysisRows((rows) => rows.map((r) => r.materialId === row.materialId ? { ...r, availableQuantity: Math.max(0, Number(e.target.value) || 0) } : r))} /><label style={{ display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={row.needsQuotation !== false} onChange={(e) => setAnalysisRows((rows) => rows.map((r) => r.materialId === row.materialId ? { ...r, needsQuotation: e.target.checked } : r))} />Cotação</label></div>; })}
              <textarea placeholder="Observações da análise (opcional)" value={analysisNotes} onChange={(e) => setAnalysisNotes(e.target.value)} rows={2} />
              {analysisError && <p style={{ color: 'var(--danger)', margin: 0, fontSize: 12 }}>{analysisError}</p>}
              <div><Button variant="positive" onClick={() => void saveAnalysis()}>Salvar análise de estoque/cotação</Button>{hasAnalysis && <span style={{ marginLeft: 10, color: 'var(--success)', fontSize: 12 }}>Análise registrada</span>}</div>
            </div>
          </div>
        )}

        {purchaseItems.length > 0 && hasAnalysis && (canProcure || quotations.length > 0) && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Cotação de fornecedor</div>
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {quotations.length > 0 && <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 5 }}>{quotations.map((q, index) => { const quotationId = String(q.quotationId ?? index); const isSelected = quotationId === selectedQuotationId || Boolean(q.selected); const canSelect = user?.collaboratorId === request.costCenter?.responsibleCollaborator?.id; return <div key={quotationId} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 5, padding: 8, background: isSelected ? 'var(--bg-sidebar-active)' : 'transparent', fontSize: 12 }}><span style={{ flex: 1 }}>#{index + 1} — {String(q.supplier ?? '')} · <strong>R$ {Number(q.totalValue ?? 0).toFixed(2)}</strong>{isSelected ? ' · selecionada' : ''}{Array.isArray(q.attachmentIds) && q.attachmentIds.length ? ` · ${q.attachmentIds.length} anexo(s)` : ''}</span>{canSelect && <Button variant={isSelected ? 'positive' : 'secondary'} onClick={() => void selectQuotation(quotationId)}>{isSelected ? 'Fornecedor escolhido' : 'Escolher fornecedor'}</Button>}</div>; })}</div>}
              {canProcure && request.status === 'em_atendimento' && <><input placeholder="Fornecedor" value={supplier} onChange={(e) => setSupplier(e.target.value)} /><input placeholder="Número da cotação" value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)} /><label style={{ fontSize: 12 }}>Valor total (R$)<input type="number" min="0.01" step="0.01" placeholder="0,00" value={quoteTotal} onChange={(e) => setQuoteTotal(e.target.value)} /></label><textarea placeholder="Observações da cotação" value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} rows={2} /><label style={{ fontSize: 12, gridColumn: '1 / -1' }}>Anexos da cotação<input type="file" multiple onChange={(e) => setQuoteFiles(Array.from(e.target.files ?? []))} /><small style={{ display: 'block', color: 'var(--text-muted)' }}>{quoteFiles.length ? `${quoteFiles.length} arquivo(s) selecionado(s)` : 'Anexe proposta, orçamento ou documento do fornecedor.'}</small></label>{quoteError && <p style={{ color: 'var(--danger)', margin: 0, fontSize: 12, gridColumn: '1 / -1' }}>{quoteError}</p>}<div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}><Button variant="positive" onClick={() => void saveQuotation()}>Adicionar/atualizar cotação</Button><Button onClick={() => { setQuoteId(''); setSupplier(''); setQuoteNumber(''); setQuoteTotal(''); setQuoteNotes(''); setQuoteFiles([]); }}>Nova cotação</Button></div></>}
            </div>
          </div>
        )}

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Subtarefas</div>
            <button
              onClick={() => navigate(`/requests/new?parentRequestId=${request.id}`)}
              style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}
            >
              + Nova subtarefa
            </button>
          </div>
          {request.relationsAsTarget.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma subtarefa.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {request.relationsAsTarget.map((link) => (
                <button
                  key={link.source.id}
                  onClick={() => navigate(`/requests/${link.source.id}`)}
                  style={{ textAlign: 'left', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, cursor: 'pointer' }}
                >
                  <span>
                    {link.source.code} — {link.source.title}
                  </span>
                  <StatusBadge label={STATUS_LABEL[link.source.status]} tone="default" />
                </button>
              ))}
            </div>
          )}
        </div>

        {request.categoryVersion.category.requiresAcceptance && request.status === 'concluida' && (
          <div>
            {request.requesterAcceptedAt ? (
              <p style={{ fontSize: 12, color: 'var(--success)' }}>Aceite do solicitante confirmado em {formatDateTime(request.requesterAcceptedAt)}.</p>
            ) : user?.collaboratorId === request.requesterId ? (
              <Button variant="positive" onClick={() => void run(() => requestsApi.accept(request.id))}>
                Confirmar aceite da entrega
              </Button>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aguardando aceite do solicitante antes de encerrar (categoria exige confirmação).</p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canTriage && request.status === 'enviada' && (
            <>
              <Button variant="positive" onClick={() => triage('aceitar')}>
                Aceitar triagem
              </Button>
              <Button variant="danger" onClick={() => triage('devolver')}>
                Devolver para ajuste
              </Button>
            </>
          )}
          {canApprove && request.status === 'aguardando_aprovacao' && (
            <>
              <Button variant="positive" onClick={() => decide('approve')}>
                Aprovar
              </Button>
              <Button variant="danger" onClick={() => decide('reject')}>
                Reprovar
              </Button>
            </>
          )}
          {canUpdate && ['aprovada', 'planejada'].includes(request.status) && (
            <Button variant="positive" onClick={() => void run(() => requestsApi.start(request.id))}>
              Iniciar atendimento
            </Button>
          )}
          {canUpdate && request.status === 'em_atendimento' && (
            <>
              <Button variant="secondary" onClick={requestInfo}>
                Pedir informação ao solicitante
              </Button>
              <Button variant="positive" onClick={complete}>
                Concluir
              </Button>
            </>
          )}
          {canUpdate && ['aguardando_solicitante', 'aguardando_terceiro'].includes(request.status) && (
            <Button variant="secondary" onClick={() => void run(() => requestsApi.resume(request.id))}>
              Retomar atendimento
            </Button>
          )}
          {canUpdate && request.status === 'concluida' && (
            <Button variant="positive" onClick={() => void run(() => requestsApi.close(request.id))}>
              Encerrar
            </Button>
          )}
          {canUpdate && ['concluida', 'encerrada', 'reprovada'].includes(request.status) && (
            <Button variant="secondary" onClick={reopen}>
              Reabrir
            </Button>
          )}
          {canCreate && !['concluida', 'encerrada', 'cancelada'].includes(request.status) && (
            <Button variant="danger" onClick={cancel}>
              Cancelar
            </Button>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Comentários</div>
          {request.comments.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum comentário.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              {request.comments.map((c) => (
                <div key={c.id} style={{ fontSize: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>
                    {formatDateTime(c.createdAt)} {c.visibility === 'interno' && '· nota interna'}
                  </div>
                  {c.body}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={addComment} style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Adicionar comentário..." value={commentBody} onChange={(e) => setCommentBody(e.target.value)} style={{ flex: 1 }} />
            <Button type="submit" variant="secondary">
              Enviar
            </Button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}

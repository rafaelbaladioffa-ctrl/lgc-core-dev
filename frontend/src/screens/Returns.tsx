import { useMemo, useState } from 'react';
import { call } from '../lib/api';
import { fmtDateTime, fmtQty } from '../lib/format';
import { allMaterials, matLabel } from '../lib/lookups';
import { DataTable, Pager, useLoad, type Column } from '../ui';

interface Ret { id: string; code: string; type: string; status: string; warehouseId: string; notes: string | null; createdAt: string; items?: RItem[] }
interface RItem { id: string; materialId: string; quantity: string; status: string; disposition: string | null; notes: string | null; serialId: string | null }
interface Custody { id: string; code: string; custodianAxisId: string; materialId: string; quantity: string; returnedQty: string; status: string; expectedReturnAt: string | null; deliveredAt: string; closedAt: string | null; closeNotes: string | null }
interface Page<T> { total: number; page: number; pageSize: number; items: T[] }

const TYPE: Record<string, string> = { SOBRA: 'Sobra', FERRAMENTA: 'Ferramenta', ATIVO: 'Ativo', DEFEITUOSO: 'Defeituoso', AVARIA: 'Avaria', TROCA_TAMANHO: 'Troca de tamanho', RETORNO_PROJETO: 'Retorno de projeto', RETORNO_TERCEIRO: 'Retorno de terceiro' };
const STATUS: Record<string, string> = { RECEBIDA: 'Recebida', ENCERRADA: 'Encerrada' };
const DISP: Record<string, string> = { DISPONIVEL: 'Disponível', MANUTENCAO: 'Manutenção', QUARENTENA: 'Quarentena', AVARIADO_REPARO: 'Avariado (reparo)', SUCATA: 'Sucata / descarte' };
const CUSTODY: Record<string, string> = { ATIVO: 'Ativo', DEVOLVIDO: 'Devolvido', PERDIDO: 'Perdido' };
const today = () => new Date().toISOString().slice(0, 10);

export function Returns({ warehouseId, canCustody }: { warehouseId?: string; canCustody: boolean }) {
  const [part, setPart] = useState<'ret' | 'cus'>('ret');
  return (
    <section>
      <h2>Devoluções e custódias</h2>
      <div className="toolbar">
        <button className={part === 'ret' ? 'btn' : 'btn ghost'} onClick={() => setPart('ret')}>Devoluções</button>
        <button className={part === 'cus' ? 'btn' : 'btn ghost'} onClick={() => setPart('cus')}>Termos de custódia</button>
      </div>
      {part === 'ret' ? <ReturnList warehouseId={warehouseId} /> : <CustodyList canClose={canCustody} />}
    </section>
  );
}

function ReturnList({ warehouseId }: { warehouseId?: string }) {
  const [type, setType] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [res, reload] = useLoad(() => call<Ret[]>('/returns'), []);
  const rows = useMemo(() => (res.state === 'ready' ? res.data : []).filter((r) => (!warehouseId || r.warehouseId === warehouseId) && (!type || r.type === type) && (!pendingOnly || r.status === 'RECEBIDA')), [res, warehouseId, type, pendingOnly]);
  if (sel) return <ReturnDetail id={sel} onBack={() => { setSel(null); reload(); }} />;
  const size = 20;
  const cols: Column<Ret>[] = [
    { key: 'c', header: 'Devolução', render: (r) => <strong>{r.code}</strong> },
    { key: 't', header: 'Tipo', render: (r) => TYPE[r.type] ?? r.type },
    { key: 's', header: 'Situação', render: (r) => <span className={`pill ${r.status === 'RECEBIDA' ? 'warn' : 'ok'}`}>{STATUS[r.status] ?? r.status}</span> },
    { key: 'n', header: 'Observações', render: (r) => r.notes ?? '—' },
    { key: 'a', header: 'Recebida em', render: (r) => fmtDateTime(r.createdAt) },
  ];
  return (
    <>
      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Tipo<select className="inp" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">Todos</option>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Aguardando inspeção</span><input type="checkbox" checked={pendingOnly} onChange={(e) => { setPendingOnly(e.target.checked); setPage(1); }} aria-label="Somente aguardando inspeção" /></label>
        <button type="button" className="btn ghost" onClick={() => { setType(''); setPendingOnly(false); setPage(1); }}>Limpar filtros</button>
      </form>
      <DataTable cols={cols} rows={rows.slice((page - 1) * size, page * size)} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} onRow={(r) => setSel(r.id)} rowKey={(r) => r.id} empty="Nenhuma devolução encontrada." />
      {res.state === 'ready' && <Pager page={page} pageSize={size} total={rows.length} onPage={setPage} />}
    </>
  );
}

function ReturnDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [res, reload] = useLoad(() => call<Ret>(`/returns/${id}`), [id]);
  const [mats] = useLoad(allMaterials, []);
  const byId = useMemo(() => new Map((mats.state === 'ready' ? mats.data : []).map((m) => [m.id, m])), [mats]);
  const [open, setOpen] = useState<string | null>(null);
  const [disp, setDisp] = useState('DISPONIVEL');
  const [notes, setNotes] = useState('');
  const [approval, setApproval] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (res.state === 'loading') return <><button className="btn ghost" onClick={onBack}>← Devoluções</button><div className="skeleton" /></>;
  if (res.state === 'error') return <><button className="btn ghost" onClick={onBack}>← Devoluções</button><p className="err" role="alert">{res.message}</p><button className="btn" onClick={reload}>Tentar de novo</button></>;
  const r = res.data;
  const classify = async (itemId: string) => {
    if (busy) return;
    if (notes.trim().length < 3) { setErr('Informe o parecer da inspeção (mínimo 3 caracteres).'); return; }
    if (disp === 'SUCATA' && !approval.trim()) { setErr('Sucata/descarte exige a aprovação do Axis.'); return; }
    setBusy(true); setErr('');
    try {
      await call(`/returns/${id}/items/${itemId}/classify`, { method: 'POST', body: JSON.stringify({ disposition: disp, notes: notes.trim(), ...(disp === 'SUCATA' ? { approvalRef: approval.trim() } : {}) }) });
      setOpen(null); setNotes(''); setApproval(''); reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <button className="btn ghost" onClick={onBack}>← Devoluções</button>
      <h2>{r.code} — {TYPE[r.type] ?? r.type}</h2>
      {r.notes && <p className="hint">{r.notes}</p>}
      {(r.items ?? []).map((i) => (
        <div key={i.id} className="card">
          <strong>{matLabel(byId, i.materialId)}</strong> · {fmtQty(i.quantity)}
          <div className="hint">{i.status === 'PENDENTE_INSPECAO' ? 'Aguardando inspeção' : `Classificado: ${DISP[i.disposition ?? ''] ?? i.disposition}${i.notes ? ` — ${i.notes}` : ''}`}</div>
          {i.status === 'PENDENTE_INSPECAO' && open !== i.id && <button className="btn" onClick={() => { setOpen(i.id); setErr(''); }}>Classificar</button>}
          {open === i.id && (
            <form onSubmit={(e) => { e.preventDefault(); void classify(i.id); }} noValidate>
              <label className="lbl" htmlFor="disp">Destinação <span aria-hidden="true">*</span></label>
              <select id="disp" className="inp" value={disp} onChange={(e) => setDisp(e.target.value)}>{Object.entries(DISP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <label className="lbl" htmlFor="parecer">Parecer da inspeção <span aria-hidden="true">*</span></label>
              <textarea id="parecer" className="inp" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
              {disp === 'SUCATA' && <><label className="lbl" htmlFor="aprov">Aprovação do Axis <span aria-hidden="true">*</span></label><input id="aprov" className="inp" value={approval} onChange={(e) => setApproval(e.target.value)} maxLength={80} /></>}
              {err && <p className="err" role="alert">{err}</p>}
              <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Confirmar classificação'}</button><button type="button" className="btn ghost" onClick={() => setOpen(null)}>Cancelar</button></div>
            </form>
          )}
        </div>
      ))}
    </>
  );
}

function CustodyList({ canClose }: { canClose: boolean }) {
  const [status, setStatus] = useState('ATIVO');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [res, reload] = useLoad(() => call<Page<Custody>>(`/custody?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`), [status, page]);
  const [mats] = useLoad(allMaterials, []);
  const byId = useMemo(() => new Map((mats.state === 'ready' ? mats.data : []).map((m) => [m.id, m])), [mats]);
  const [err, setErr] = useState('');
  const lost = async (t: Custody) => {
    const notes = window.prompt(`Motivo da perda de ${t.code} (mínimo 3 caracteres):`)?.trim();
    if (!notes || notes.length < 3) return;
    const approvalRef = window.prompt('Número da aprovação do Axis para a baixa:')?.trim();
    if (!approvalRef) return;
    if (!window.confirm(`Marcar ${t.code} como perdido? A série será baixada.`)) return;
    setErr('');
    try { await call(`/custody/${t.id}/mark-lost`, { method: 'POST', body: JSON.stringify({ notes, approvalRef }) }); reload(); } catch (e) { setErr((e as Error).message); }
  };
  const data = res.state === 'ready' ? res.data : null;
  const rows = (data?.items ?? []).filter((t) => !overdue || (t.status === 'ATIVO' && t.expectedReturnAt && t.expectedReturnAt.slice(0, 10) < today()));
  const cols: Column<Custody>[] = [
    { key: 'c', header: 'Termo', render: (t) => <strong>{t.code}</strong> },
    { key: 'm', header: 'Material', render: (t) => matLabel(byId, t.materialId) },
    { key: 'q', header: 'Qtd. / devolvida', num: true, render: (t) => `${fmtQty(t.quantity)} / ${fmtQty(t.returnedQty)}` },
    { key: 'cu', header: 'Custodiante', render: (t) => <code>{t.custodianAxisId.slice(0, 8)}</code> },
    { key: 's', header: 'Situação', render: (t) => <span className={`pill ${t.status === 'ATIVO' ? 'warn' : t.status === 'PERDIDO' ? 'bad' : 'ok'}`}>{CUSTODY[t.status] ?? t.status}</span> },
    { key: 'e', header: 'Devolução prevista', render: (t) => (t.expectedReturnAt ? <span className={t.status === 'ATIVO' && t.expectedReturnAt.slice(0, 10) < today() ? 'err' : undefined}>{t.expectedReturnAt.slice(0, 10).split('-').reverse().join('/')}</span> : '—') },
    { key: 'a', header: '', render: (t) => (canClose && t.status === 'ATIVO' ? <button className="btn ghost" onClick={() => void lost(t)}>Marcar perdido</button> : null) },
  ];
  return (
    <>
      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Situação<select className="inp" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option>{Object.entries(CUSTODY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Atrasadas</span><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} aria-label="Somente atrasadas" /></label>
      </form>
      {err && <p className="err" role="alert">{err}</p>}
      <DataTable cols={cols} rows={rows} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} rowKey={(t) => t.id} empty="Nenhum termo de custódia encontrado." />
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}

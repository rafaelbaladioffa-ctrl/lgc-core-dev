import { useMemo, useState } from 'react';
import { call } from '../lib/api';
import { fmtDateTime, fmtQty } from '../lib/format';
import { allMaterials, allWarehouses, matLabel, whLabel } from '../lib/lookups';
import { DataTable, Pager, useLoad, type Column } from '../ui';

interface Transfer { id: string; code: string; fromWarehouseId: string; toWarehouseId: string; status: string; urgent: boolean; reason: string; hasDivergence: boolean; requestedBy: string; createdAt: string; dispatchedAt: string | null; receivedAt: string | null; items?: TItem[] }
interface TItem { id: string; materialId: string; quantity: string; reservedQty: string; receivedQty: string }

const STATUS: Record<string, string> = { SOLICITADA: 'Solicitada', APROVADA: 'Aprovada', SEPARANDO: 'Separando', EXPEDIDA: 'Expedida', EM_TRANSITO: 'Em trânsito', RECEBIDA: 'Recebida', ENCERRADA: 'Encerrada', CANCELADA: 'Cancelada' };
const tone = (s: string) => (s === 'CANCELADA' ? 'bad' : ['RECEBIDA', 'ENCERRADA'].includes(s) ? 'ok' : 'warn');

/** Próximas ações por situação (a API valida permissão e segregação de funções). */
const ACTIONS: Record<string, Array<{ path: string; label: string; confirm?: string; body?: unknown }>> = {
  SOLICITADA: [{ path: 'approve', label: 'Aprovar e reservar saldo', confirm: 'Aprovar esta transferência e reservar o saldo na origem?' }, { path: 'cancel', label: 'Cancelar', confirm: 'Cancelar esta transferência?', }],
  APROVADA: [{ path: 'start-picking', label: 'Iniciar separação' }, { path: 'cancel', label: 'Cancelar', confirm: 'Cancelar esta transferência? A reserva será liberada.', }],
  SEPARANDO: [{ path: 'dispatch', label: 'Expedir', confirm: 'Expedir a transferência? O saldo sai da origem e fica em trânsito.' }],
  RECEBIDA: [{ path: 'close', label: 'Encerrar', confirm: 'Encerrar esta transferência?' }],
};

export function Transfers({ warehouseId }: { warehouseId?: string }) {
  const [status, setStatus] = useState('');
  const [onlyTransit, setOnlyTransit] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [res, reload] = useLoad(() => call<Transfer[]>('/transfers'), []);
  const [whs] = useLoad(allWarehouses, []);
  const wmap = useMemo(() => new Map((whs.state === 'ready' ? whs.data : []).map((w) => [w.id, w])), [whs]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (res.state === 'ready' ? res.data : []).filter((t) => (!warehouseId || t.fromWarehouseId === warehouseId || t.toWarehouseId === warehouseId) && (!status || t.status === status) && (!onlyTransit || ['EXPEDIDA', 'EM_TRANSITO'].includes(t.status)) && (!term || `${t.code} ${t.reason}`.toLowerCase().includes(term)));
  }, [res, warehouseId, status, onlyTransit, q]);
  if (sel) return <TransferDetail id={sel} wmap={wmap} onBack={() => { setSel(null); reload(); }} />;
  const size = 20;
  const cols: Column<Transfer>[] = [
    { key: 'code', header: 'Transferência', render: (t) => <strong>{t.code}</strong> },
    { key: 'from', header: 'Origem', render: (t) => whLabel(wmap, t.fromWarehouseId) },
    { key: 'to', header: 'Destino', render: (t) => whLabel(wmap, t.toWarehouseId) },
    { key: 'st', header: 'Situação', render: (t) => <span className={`pill ${tone(t.status)}`}>{STATUS[t.status] ?? t.status}</span> },
    { key: 'urg', header: 'Urgente', render: (t) => (t.urgent ? <span className="pill bad">Urgente</span> : 'Não') },
    { key: 'div', header: 'Divergência', render: (t) => (t.hasDivergence ? <span className="pill bad">Sim</span> : 'Não') },
    { key: 'at', header: 'Solicitada em', render: (t) => fmtDateTime(t.createdAt) },
  ];
  return (
    <section>
      <h2>Transferências</h2>
      <form className="toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Buscar<input className="inp" placeholder="Código ou motivo" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field">Situação<select className="inp" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Em trânsito</span><input type="checkbox" checked={onlyTransit} onChange={(e) => { setOnlyTransit(e.target.checked); setPage(1); }} aria-label="Somente em trânsito" /></label>
        <button type="button" className="btn ghost" onClick={() => { setQ(''); setStatus(''); setOnlyTransit(false); setPage(1); }}>Limpar filtros</button>
      </form>
      <DataTable cols={cols} rows={rows.slice((page - 1) * size, page * size)} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} onRow={(t) => setSel(t.id)} rowKey={(t) => t.id} empty="Nenhuma transferência encontrada." />
      {res.state === 'ready' && <Pager page={page} pageSize={size} total={rows.length} onPage={setPage} />}
    </section>
  );
}

function TransferDetail({ id, wmap, onBack }: { id: string; wmap: Map<string, { id: string; code: string; name: string }>; onBack: () => void }) {
  const [res, reload] = useLoad(() => call<Transfer>(`/transfers/${id}`), [id]);
  const [mats] = useLoad(allMaterials, []);
  const byId = useMemo(() => new Map((mats.state === 'ready' ? mats.data : []).map((m) => [m.id, m])), [mats]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (a: { path: string; confirm?: string; body?: unknown }) => {
    if (busy) return;
    let body = a.body;
    if (a.path === 'cancel') {
      const reason = window.prompt('Motivo do cancelamento (mínimo 3 caracteres):')?.trim();
      if (!reason || reason.length < 3) return;
      body = { reason };
    } else if (a.confirm && !window.confirm(a.confirm)) return;
    setBusy(true); setErr('');
    try { await call(`/transfers/${id}/${a.path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (res.state === 'loading') return <section><button className="btn ghost" onClick={onBack}>← Transferências</button><div className="skeleton" /></section>;
  if (res.state === 'error') return <section><button className="btn ghost" onClick={onBack}>← Transferências</button><p className="err" role="alert">{res.message}</p><button className="btn" onClick={reload}>Tentar de novo</button></section>;
  const t = res.data;
  const transit = ['EXPEDIDA', 'EM_TRANSITO'].includes(t.status);
  return (
    <section>
      <button className="btn ghost" onClick={onBack}>← Transferências</button>
      <h2>{t.code} <span className={`pill ${tone(t.status)}`}>{STATUS[t.status] ?? t.status}</span></h2>
      <div className="card"><dl className="kv">
        <div><dt>Origem</dt><dd>{whLabel(wmap, t.fromWarehouseId)}</dd></div><div><dt>Destino</dt><dd>{whLabel(wmap, t.toWarehouseId)}</dd></div><div><dt>Motivo</dt><dd>{t.reason}</dd></div>
        <div><dt>Solicitada em</dt><dd>{fmtDateTime(t.createdAt)}</dd></div><div><dt>Expedida em</dt><dd>{t.dispatchedAt ? fmtDateTime(t.dispatchedAt) : '—'}</dd></div><div><dt>Recebida em</dt><dd>{t.receivedAt ? fmtDateTime(t.receivedAt) : '—'}</dd></div>
      </dl></div>
      {transit && <p className="notice" role="status">Material em trânsito: o saldo já saiu da origem e ainda não entrou no destino. O recebimento é feito no destino, endereço a endereço.</p>}
      {t.hasDivergence && <p className="notice" role="alert">Divergência no recebimento: a quantidade recebida difere da expedida.</p>}
      <h3>Itens</h3>
      <DataTable rowKey={(i) => i.id} state="ready" rows={t.items ?? []} empty="Sem itens." cols={[
        { key: 'm', header: 'Material', render: (i: TItem) => matLabel(byId, i.materialId) },
        { key: 'q', header: 'Solicitado', num: true, render: (i: TItem) => fmtQty(i.quantity) },
        { key: 'r', header: 'Reservado', num: true, render: (i: TItem) => fmtQty(i.reservedQty) },
        { key: 'rc', header: 'Recebido', num: true, render: (i: TItem) => fmtQty(i.receivedQty) },
      ]} />
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row">{(ACTIONS[t.status] ?? []).map((a, n) => <button key={a.path} className={n === 0 ? 'btn' : 'btn ghost'} disabled={busy} onClick={() => run(a)}>{a.label}</button>)}</div>
    </section>
  );
}

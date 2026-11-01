import { useMemo, useState } from 'react';
import { call } from '../lib/api';
import { dateBr } from '../lib/dates';
import { fmtDateTime, fmtQty } from '../lib/format';
import { allMaterials, matLabel } from '../lib/lookups';
import { DataTable, Pager, useLoad, yesNo, type Column } from '../ui';

interface Receipt { id: string; code: string; warehouseId: string; status: string; invoiceNumber: string | null; vehicle: string | null; volumes: number | null; hasDivergence: boolean; createdAt: string; completedAt: string | null; divergenceNotes?: unknown; expectedItems?: Array<{ materialId: string; quantity: number | string }>; items?: RItem[] }
interface RItem { id: string; materialId: string; quantity: string; lotNumber: string | null; expiresAt: string | null; serials: string[]; damaged: boolean; inspectionRequired: boolean; inspectionReason: string | null; status: string }

const STATUS: Record<string, string> = { AGENDADO: 'Agendado', EM_CONFERENCIA: 'Em conferência', RECEBIDO_PENDENTE_INSPECAO: 'Aguardando inspeção', LIBERADO: 'Liberado', ARMAZENADO: 'Armazenado', DIVERGENTE: 'Divergente', QUARENTENA: 'Quarentena', REJEITADO: 'Rejeitado', DEVOLVIDO_FORNECEDOR: 'Devolvido ao fornecedor' };
const ITEM_STATUS: Record<string, string> = { CONFERIDO: 'Conferido', EM_INSPECAO: 'Em inspeção', LIBERADO: 'Liberado', REJEITADO: 'Rejeitado', ARMAZENADO: 'Armazenado' };
const tone = (s: string) => (['DIVERGENTE', 'REJEITADO', 'QUARENTENA', 'DEVOLVIDO_FORNECEDOR'].includes(s) ? 'bad' : ['LIBERADO', 'ARMAZENADO'].includes(s) ? 'ok' : 'warn');

export function Receiving({ warehouseId }: { warehouseId?: string }) {
  const [status, setStatus] = useState('');
  const [onlyDiv, setOnlyDiv] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [res, reload] = useLoad(() => call<Receipt[]>('/receipts'), []);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (res.state === 'ready' ? res.data : []).filter((r) => (!warehouseId || r.warehouseId === warehouseId) && (!status || r.status === status) && (!onlyDiv || r.hasDivergence) && (!term || `${r.code} ${r.invoiceNumber ?? ''} ${r.vehicle ?? ''}`.toLowerCase().includes(term)));
  }, [res, warehouseId, status, onlyDiv, q]);
  if (sel) return <ReceiptDetail id={sel} onBack={() => { setSel(null); reload(); }} />;
  const size = 20;
  const cols: Column<Receipt>[] = [
    { key: 'code', header: 'Recebimento', render: (r) => <strong>{r.code}</strong> },
    { key: 'nf', header: 'Nota fiscal', render: (r) => r.invoiceNumber ?? '—' },
    { key: 'veh', header: 'Veículo', render: (r) => r.vehicle ?? '—' },
    { key: 'vol', header: 'Volumes', num: true, render: (r) => r.volumes ?? '—' },
    { key: 'st', header: 'Situação', render: (r) => <span className={`pill ${tone(r.status)}`}>{STATUS[r.status] ?? r.status}</span> },
    { key: 'div', header: 'Divergência', render: (r) => (r.hasDivergence ? <span className="pill bad">Sim</span> : 'Não') },
    { key: 'at', header: 'Criado em', render: (r) => fmtDateTime(r.createdAt) },
  ];
  return (
    <section>
      <h2>Recebimento</h2>
      <form className="toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Buscar<input className="inp" placeholder="Código, nota fiscal ou veículo" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field">Situação<select className="inp" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Divergência</span><input type="checkbox" checked={onlyDiv} onChange={(e) => { setOnlyDiv(e.target.checked); setPage(1); }} aria-label="Somente com divergência" /></label>
        <button type="button" className="btn ghost" onClick={() => { setQ(''); setStatus(''); setOnlyDiv(false); setPage(1); }}>Limpar filtros</button>
      </form>
      <DataTable cols={cols} rows={rows.slice((page - 1) * size, page * size)} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} onRow={(r) => setSel(r.id)} rowKey={(r) => r.id} empty="Nenhum recebimento encontrado." />
      {res.state === 'ready' && <Pager page={page} pageSize={size} total={rows.length} onPage={setPage} />}
    </section>
  );
}

function ReceiptDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [res, reload] = useLoad(() => call<Receipt>(`/receipts/${id}`), [id]);
  const [mats] = useLoad(allMaterials, []);
  const byId = useMemo(() => new Map((mats.state === 'ready' ? mats.data : []).map((m) => [m.id, m])), [mats]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const complete = async () => {
    if (busy || !window.confirm('Concluir a conferência deste recebimento? Os itens liberados seguem para armazenagem.')) return;
    setBusy(true); setErr('');
    try { await call(`/receipts/${id}/complete`, { method: 'POST', body: '{}' }); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (res.state === 'loading') return <section><button className="btn ghost" onClick={onBack}>← Recebimentos</button><div className="skeleton" /></section>;
  if (res.state === 'error') return <section><button className="btn ghost" onClick={onBack}>← Recebimentos</button><p className="err" role="alert">{res.message}</p><button className="btn" onClick={reload}>Tentar de novo</button></section>;
  const r = res.data;
  const expected = r.expectedItems ?? [];
  const got = new Map<string, number>();
  for (const it of r.items ?? []) got.set(it.materialId, (got.get(it.materialId) ?? 0) + Number(it.quantity));
  const diffs = expected.map((e) => ({ materialId: e.materialId, expected: Number(e.quantity), received: got.get(e.materialId) ?? 0 })).filter((d) => d.expected !== d.received);
  const extra = [...got.keys()].filter((m) => !expected.some((e) => e.materialId === m));
  const open = ['AGENDADO', 'EM_CONFERENCIA'].includes(r.status);
  return (
    <section>
      <button className="btn ghost" onClick={onBack}>← Recebimentos</button>
      <h2>{r.code} <span className={`pill ${tone(r.status)}`}>{STATUS[r.status] ?? r.status}</span></h2>
      <div className="card"><dl className="kv">
        <div><dt>Nota fiscal</dt><dd>{r.invoiceNumber ?? '—'}</dd></div><div><dt>Veículo</dt><dd>{r.vehicle ?? '—'}</dd></div><div><dt>Volumes</dt><dd>{r.volumes ?? '—'}</dd></div>
        <div><dt>Criado em</dt><dd>{fmtDateTime(r.createdAt)}</dd></div><div><dt>Concluído em</dt><dd>{r.completedAt ? fmtDateTime(r.completedAt) : '—'}</dd></div><div><dt>Divergência</dt><dd>{yesNo(r.hasDivergence)}</dd></div>
      </dl></div>
      {(r.hasDivergence || diffs.length > 0 || extra.length > 0) && (
        <div className="card" role="status"><h3>Divergências</h3>
          {diffs.map((d) => <div key={d.materialId} className="line">{matLabel(byId, d.materialId)}: esperado {fmtQty(d.expected)}, conferido {fmtQty(d.received)}</div>)}
          {extra.map((m) => <div key={m} className="line">{matLabel(byId, m)}: item não previsto no pedido</div>)}
          {diffs.length === 0 && extra.length === 0 && <p className="hint">Divergência registrada na conclusão.</p>}
        </div>
      )}
      <h3>Itens conferidos</h3>
      <DataTable rowKey={(i) => i.id} state="ready" rows={r.items ?? []} empty="Nenhum item conferido ainda." cols={[
        { key: 'm', header: 'Material', render: (i: RItem) => matLabel(byId, i.materialId) },
        { key: 'q', header: 'Quantidade', num: true, render: (i: RItem) => fmtQty(i.quantity) },
        { key: 'l', header: 'Lote / validade', render: (i: RItem) => [i.lotNumber, i.expiresAt && dateBr(i.expiresAt)].filter(Boolean).join(' · ') || '—' },
        { key: 's', header: 'Séries', render: (i: RItem) => (i.serials.length ? i.serials.join(', ') : '—') },
        { key: 'f', header: 'Alertas', render: (i: RItem) => <>{i.damaged && <span className="pill bad">Avariado</span>}{i.inspectionRequired && <span className="pill warn">Inspeção{i.inspectionReason ? `: ${i.inspectionReason}` : ''}</span>}</> },
        { key: 'st', header: 'Situação', render: (i: RItem) => ITEM_STATUS[i.status] ?? i.status },
      ]} />
      {err && <p className="err" role="alert">{err}</p>}
      {open && <button className="btn block" disabled={busy} onClick={complete}>{busy ? 'Concluindo…' : 'Concluir conferência'}</button>}
    </section>
  );
}

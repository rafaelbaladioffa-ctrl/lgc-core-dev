import { useMemo, useState } from 'react';
import { call } from '../lib/api';
import { dateBr, todaySaoPaulo } from '../lib/dates';
import { fmtDateTime, fmtQty } from '../lib/format';
import { allMaterials, allWarehouses, axisName, matLabel, PERSON, whLabel } from '../lib/lookups';
import { useAxisNames } from '../AxisPicker';
import { fetchAllPages } from '../lib/paging';
import { DataTable, Pager, useLoad, type Column } from '../ui';

interface Order { id: string; seq: number; axisRequestId: string; status: string; statusReason: string | null; neededBy: string | null; destinationText: string | null; destinationSiteAxisId: string | null; notes: string | null; createdAt: string; updatedAt: string }
interface OrderItem { id: string; materialId: string; requestedMaterialId: string; quantity: string; reserved: string; shortage: string; notes: string | null }
interface OrderDetail extends Order { warehouseId: string | null; projectAxisId: string | null; costCenterAxisId: string | null; requesterAxisId: string | null; recipientAxisId: string | null; requestVersion: number; referenceWarnings: unknown; items: OrderItem[] }
interface Page<T> { total: number; page: number; pageSize: number; items: T[] }

const STATUS: Record<string, string> = { RECEBIDA: 'Recebida', EM_ANALISE: 'Em análise', RESERVADA: 'Reservada', RESERVADA_PARCIAL: 'Reservada parcial', LIBERADA_SEPARACAO: 'Liberada p/ separação', EM_SEPARACAO: 'Em separação', SEPARADA: 'Separada', EM_CONFERENCIA: 'Em conferência', PRONTA_EXPEDICAO: 'Pronta p/ expedição', EXPEDIDA: 'Expedida', ENTREGUE: 'Entregue', ENCERRADA: 'Encerrada', AGUARDANDO_ESTOQUE: 'Aguardando estoque', AGUARDANDO_INFORMACAO: 'Aguardando informação', BLOQUEADA: 'Bloqueada', CANCELAMENTO_SOLICITADO: 'Cancelamento solicitado', CANCELADA: 'Cancelada', DIVERGENCIA: 'Divergência' };
const DONE = ['ENTREGUE', 'ENCERRADA'];
const PAGE = 20;
/** Situações em que a API aceita nova reserva e em que ainda cabe pedir cancelamento (a API valida de novo). */
const RESERVABLE = ['RECEBIDA', 'EM_ANALISE', 'RESERVADA_PARCIAL', 'AGUARDANDO_ESTOQUE', 'AGUARDANDO_INFORMACAO'];
const NOT_CANCELABLE = ['EXPEDIDA', 'ENTREGUE', 'ENCERRADA', 'CANCELADA', 'CANCELAMENTO_SOLICITADO'];
const tone = (s: string) => (['AGUARDANDO_ESTOQUE', 'AGUARDANDO_INFORMACAO'].includes(s) ? 'warn' : DONE.includes(s) ? 'ok' : '');
export const code = (seq: number) => `ATD-${String(seq).padStart(8, '0')}`;

/** Prazo (necessário até): atrasado quando a data passou e a ordem não foi entregue ou cancelada; vence hoje/amanhã é atenção. */
export function sla(o: Pick<Order, 'neededBy' | 'status'>, today = todaySaoPaulo()): 'none' | 'done' | 'late' | 'soon' | 'ok' {
  if (!o.neededBy) return 'none';
  if (DONE.includes(o.status) || o.status === 'CANCELADA') return 'done';
  const d = o.neededBy.slice(0, 10);
  if (d < today) return 'late';
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return d <= tomorrow ? 'soon' : 'ok';
}

export function Fulfillment({ canManage = false }: { canManage?: boolean }) {
  const [status, setStatus] = useState('');
  const [late, setLate] = useState(false);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const url = (p: number, size: number) => `/fulfillment-orders?page=${p}&pageSize=${size}${status ? `&status=${status}` : ''}`;
  // Com "somente atrasadas" o filtro é local: carrega todas as páginas para o total e a paginação baterem.
  const [res, reload] = useLoad<Page<Order>>(async () => {
    if (!late) return call<Page<Order>>(url(page, PAGE));
    const items = (await fetchAllPages((p) => call<Page<Order>>(url(p, 100)))).filter((o) => sla(o) === 'late');
    return { total: items.length, page: 1, pageSize: PAGE, items };
  }, [status, page, late]);
  const data = res.state === 'ready' ? res.data : null;
  const rows = late ? (data?.items ?? []).slice((page - 1) * PAGE, page * PAGE) : (data?.items ?? []);
  const sites = useAxisNames(['SITE'], rows.map((o) => o.destinationSiteAxisId));
  const cols: Column<Order>[] = [
    { key: 'c', header: 'Ordem', render: (o) => <strong>{code(o.seq)}</strong> },
    { key: 'r', header: 'Requisição no Axis', render: (o) => <code>{o.axisRequestId.slice(0, 8)}</code> },
    { key: 's', header: 'Situação', render: (o) => <span className={`pill ${tone(o.status)}`}>{STATUS[o.status] ?? o.status}</span> },
    { key: 'n', header: 'Necessário até', render: (o) => { const s = sla(o); return o.neededBy ? <span className={s === 'late' ? 'err' : undefined}>{dateBr(o.neededBy)}{s === 'late' ? ' · atrasada' : s === 'soon' ? ' · vence em breve' : ''}</span> : '—'; } },
    { key: 'd', header: 'Destino (site)', render: (o) => (o.destinationSiteAxisId ? axisName(sites, o.destinationSiteAxisId) : (o.destinationText ?? '—')) },
    { key: 'm', header: 'Motivo', render: (o) => o.statusReason ?? '—' },
    { key: 'u', header: 'Atualizada em', render: (o) => fmtDateTime(o.updatedAt) },
  ];
  if (sel) return <FulfillmentDetail id={sel} canManage={canManage} onBack={() => { setSel(null); reload(); }} />;
  return (
    <section>
      <h1>Ordens de atendimento e SLA</h1>
      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Situação<select className="inp" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Somente atrasadas</span><input type="checkbox" checked={late} onChange={(e) => { setLate(e.target.checked); setPage(1); }} aria-label="Somente atrasadas" /></label>
        <button type="button" className="btn ghost" onClick={() => { setStatus(''); setLate(false); setPage(1); }}>Limpar filtros</button>
      </form>
      <DataTable cols={cols} rows={rows} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} onRow={(o) => setSel(o.id)} rowKey={(o) => o.id} empty="Nenhuma ordem de atendimento encontrada." />
      {data && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
    </section>
  );
}

const short = (id: string | null) => (id ? <code title={id}>{id.slice(0, 8)}</code> : '—');

function FulfillmentDetail({ id, canManage, onBack }: { id: string; canManage: boolean; onBack: () => void }) {
  const [res, reload] = useLoad(() => call<OrderDetail>(`/fulfillment-orders/${id}`), [id]);
  const [mats] = useLoad(allMaterials, []);
  const [whs] = useLoad(allWarehouses, []);
  const byId = useMemo(() => new Map((mats.state === 'ready' ? mats.data : []).map((m) => [m.id, m])), [mats]);
  const wmap = useMemo(() => new Map((whs.state === 'ready' ? whs.data : []).map((w) => [w.id, w])), [whs]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [whPick, setWhPick] = useState('');
  const o0 = res.state === 'ready' ? res.data : null;
  const projects = useAxisNames(['PROJECT'], [o0?.projectAxisId]);
  const ccs = useAxisNames(['COST_CENTER'], [o0?.costCenterAxisId]);
  const people = useAxisNames(PERSON, [o0?.requesterAxisId, o0?.recipientAxisId]);
  const sites = useAxisNames(['SITE'], [o0?.destinationSiteAxisId]);
  const run = async (path: 'reserve' | 'cancel-request' | 'warehouse') => {
    if (busy) return;
    let body: unknown = {};
    if (path === 'warehouse') {
      if (!whPick) { setErr('Escolha o almoxarifado.'); return; }
      body = { warehouseId: whPick };
    }
    if (path === 'cancel-request') {
      const reason = window.prompt('Motivo do pedido de cancelamento (mínimo 3 caracteres):')?.trim();
      if (!reason) return;
      if (reason.length < 3) { setErr('O motivo deve ter ao menos 3 caracteres.'); return; }
      body = { reason };
    }
    setBusy(true); setErr('');
    try { await call(`/fulfillment-orders/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const back = <button className="btn ghost" onClick={onBack}>← Ordens de atendimento</button>;
  if (res.state === 'loading') return <section>{back}<div className="skeleton" /></section>;
  if (res.state === 'error') return <section>{back}<p className="err" role="alert">{res.message}</p><button className="btn" onClick={reload}>Tentar de novo</button></section>;
  const o = res.data;
  const s = sla(o);
  const warnings = Array.isArray(o.referenceWarnings) ? (o.referenceWarnings as unknown[]).map(String) : [];
  return (
    <section>
      {back}
      <h1>{code(o.seq)} <span className={`pill ${tone(o.status)}`}>{STATUS[o.status] ?? o.status}</span></h1>
      {o.statusReason && <p className="notice" role="status">{o.statusReason}</p>}
      <div className="card"><dl className="kv">
        <div><dt>Almoxarifado</dt><dd>{o.warehouseId ? whLabel(wmap, o.warehouseId) : 'Não definido'}</dd></div>
        <div><dt>Necessário até</dt><dd>{o.neededBy ? <span className={s === 'late' ? 'err' : undefined}>{dateBr(o.neededBy)}{s === 'late' ? ' · atrasada' : s === 'soon' ? ' · vence em breve' : ''}</span> : '—'}</dd></div>
        <div><dt>Destino (site)</dt><dd>{o.destinationSiteAxisId ? axisName(sites, o.destinationSiteAxisId) : '—'}{o.destinationText && <div className="hint">{o.destinationText}</div>}</dd></div>
        <div><dt>Requisição no Axis</dt><dd>{short(o.axisRequestId)} · versão {o.requestVersion}</dd></div>
        <div><dt>Projeto</dt><dd>{axisName(projects, o.projectAxisId)}</dd></div>
        <div><dt>Centro de custo</dt><dd>{axisName(ccs, o.costCenterAxisId)}</dd></div>
        <div><dt>Solicitante</dt><dd>{o.requesterAxisId ? axisName(people, o.requesterAxisId) : 'Sistema (integração)'}</dd></div>
        <div><dt>Destinatário</dt><dd>{axisName(people, o.recipientAxisId)}</dd></div>
        <div><dt>Criada em</dt><dd>{fmtDateTime(o.createdAt)}</dd></div>
        <div><dt>Atualizada em</dt><dd>{fmtDateTime(o.updatedAt)}</dd></div>
      </dl>{o.notes && <p className="hint">{o.notes}</p>}</div>
      {warnings.length > 0 && <div className="notice" role="status"><strong>Avisos de cadastro</strong><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      <h3>Itens</h3>
      <DataTable rowKey={(i) => i.id} state="ready" rows={o.items} empty="Sem itens." cols={[
        { key: 'm', header: 'Material', render: (i: OrderItem) => <>{matLabel(byId, i.materialId)}{i.requestedMaterialId !== i.materialId && <span className="hint"> · solicitado {matLabel(byId, i.requestedMaterialId)}</span>}</> },
        { key: 'q', header: 'Solicitado', num: true, render: (i: OrderItem) => fmtQty(i.quantity) },
        { key: 'r', header: 'Reservado', num: true, render: (i: OrderItem) => fmtQty(i.reserved) },
        { key: 'f', header: 'Falta', num: true, render: (i: OrderItem) => (Number(i.shortage) > 0 ? <span className="err">{fmtQty(i.shortage)}</span> : '—') },
      ]} />
      {err && <p className="err" role="alert">{err}</p>}
      {canManage && !o.warehouseId && RESERVABLE.includes(o.status) && (
        <div className="card">
          <h3>Definir almoxarifado de atendimento</h3>
          {whs.state === 'ready' && whs.data.length === 0
            ? <p className="hint">Nenhum almoxarifado cadastrado. Cadastre um em Administração → Almoxarifados.</p>
            : <div className="row">
                <select className="inp" aria-label="Almoxarifado de atendimento" value={whPick} onChange={(e) => setWhPick(e.target.value)}><option value="">Escolha…</option>{(whs.state === 'ready' ? whs.data : []).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select>
                <button className="btn" disabled={busy || !whPick} onClick={() => run('warehouse')}>Definir e reservar</button>
              </div>}
          <p className="hint">A reserva é feita em seguida com o saldo disponível nesse almoxarifado.</p>
        </div>
      )}
      {canManage && <div className="row">
        {o.warehouseId && RESERVABLE.includes(o.status) && <button className="btn" disabled={busy} onClick={() => run('reserve')}>Reanalisar e reservar</button>}
        {!NOT_CANCELABLE.includes(o.status) && <button className="btn ghost" disabled={busy} onClick={() => run('cancel-request')}>Pedir cancelamento</button>}
      </div>}
    </section>
  );
}

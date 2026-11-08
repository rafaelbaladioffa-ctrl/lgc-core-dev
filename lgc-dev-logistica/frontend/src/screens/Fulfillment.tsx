import { useState } from 'react';
import { call } from '../lib/api';
import { dateBr, todaySaoPaulo } from '../lib/dates';
import { fmtDateTime } from '../lib/format';
import { fetchAllPages } from '../lib/paging';
import { DataTable, Pager, useLoad, type Column } from '../ui';

interface Order { id: string; seq: number; axisRequestId: string; status: string; statusReason: string | null; neededBy: string | null; destinationText: string | null; destinationSiteAxisId: string | null; notes: string | null; createdAt: string; updatedAt: string }
interface Page<T> { total: number; page: number; pageSize: number; items: T[] }

const STATUS: Record<string, string> = { RECEBIDA: 'Recebida', EM_ANALISE: 'Em análise', RESERVADA: 'Reservada', RESERVADA_PARCIAL: 'Reservada parcial', LIBERADA_SEPARACAO: 'Liberada p/ separação', EM_SEPARACAO: 'Em separação', SEPARADA: 'Separada', EM_CONFERENCIA: 'Em conferência', PRONTA_EXPEDICAO: 'Pronta p/ expedição', EXPEDIDA: 'Expedida', ENTREGUE: 'Entregue', ENCERRADA: 'Encerrada', AGUARDANDO_ESTOQUE: 'Aguardando estoque', AGUARDANDO_INFORMACAO: 'Aguardando informação', BLOQUEADA: 'Bloqueada', CANCELAMENTO_SOLICITADO: 'Cancelamento solicitado', CANCELADA: 'Cancelada', DIVERGENCIA: 'Divergência' };
const DONE = ['ENTREGUE', 'ENCERRADA'];
const PAGE = 20;
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

export function Fulfillment() {
  const [status, setStatus] = useState('');
  const [late, setLate] = useState(false);
  const [page, setPage] = useState(1);
  const url = (p: number, size: number) => `/fulfillment-orders?page=${p}&pageSize=${size}${status ? `&status=${status}` : ''}`;
  // Com "somente atrasadas" o filtro é local: carrega todas as páginas para o total e a paginação baterem.
  const [res, reload] = useLoad<Page<Order>>(async () => {
    if (!late) return call<Page<Order>>(url(page, PAGE));
    const items = (await fetchAllPages((p) => call<Page<Order>>(url(p, 100)))).filter((o) => sla(o) === 'late');
    return { total: items.length, page: 1, pageSize: PAGE, items };
  }, [status, page, late]);
  const data = res.state === 'ready' ? res.data : null;
  const rows = late ? (data?.items ?? []).slice((page - 1) * PAGE, page * PAGE) : (data?.items ?? []);
  const cols: Column<Order>[] = [
    { key: 'c', header: 'Ordem', render: (o) => <strong>{code(o.seq)}</strong> },
    { key: 'r', header: 'Requisição no Axis', render: (o) => <code>{o.axisRequestId.slice(0, 8)}</code> },
    { key: 's', header: 'Situação', render: (o) => <span className={`pill ${['AGUARDANDO_ESTOQUE', 'AGUARDANDO_INFORMACAO'].includes(o.status) ? 'warn' : DONE.includes(o.status) ? 'ok' : ''}`}>{STATUS[o.status] ?? o.status}</span> },
    { key: 'n', header: 'Necessário até', render: (o) => { const s = sla(o); return o.neededBy ? <span className={s === 'late' ? 'err' : undefined}>{dateBr(o.neededBy)}{s === 'late' ? ' · atrasada' : s === 'soon' ? ' · vence em breve' : ''}</span> : '—'; } },
    { key: 'd', header: 'Destino (site)', render: (o) => o.destinationText ?? (o.destinationSiteAxisId ? <code>{o.destinationSiteAxisId.slice(0, 8)}</code> : '—') },
    { key: 'm', header: 'Motivo', render: (o) => o.statusReason ?? '—' },
    { key: 'u', header: 'Atualizada em', render: (o) => fmtDateTime(o.updatedAt) },
  ];
  return (
    <section>
      <h1>Ordens de atendimento e SLA</h1>
      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Situação<select className="inp" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Somente atrasadas</span><input type="checkbox" checked={late} onChange={(e) => { setLate(e.target.checked); setPage(1); }} aria-label="Somente atrasadas" /></label>
        <button type="button" className="btn ghost" onClick={() => { setStatus(''); setLate(false); setPage(1); }}>Limpar filtros</button>
      </form>
      <DataTable cols={cols} rows={rows} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} rowKey={(o) => o.id} empty="Nenhuma ordem de atendimento encontrada." />
      {data && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
    </section>
  );
}

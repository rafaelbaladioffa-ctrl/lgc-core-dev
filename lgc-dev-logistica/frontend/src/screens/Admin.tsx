import { useState } from 'react';
import { call } from '../lib/api';
import { fmtDateTime, fmtQty } from '../lib/format';
import { EditLocation, NewLocation, Policies } from './AdminForms';
import { DataTable, useLoad, type Column } from '../ui';

interface Loc { id: string; code: string; name: string | null; level: string; status: string; blockedReason: string | null; isVirtual: boolean; capacityKind: string | null; capacityValue: string | null; restrictedAccess: boolean }
interface Outbox { configured: boolean; counts: Array<{ direction: string; status: string; count: number }>; oldestPendingAt: string | null }

const LEVEL: Record<string, string> = { AREA: 'Área', CORREDOR: 'Corredor', ESTANTE: 'Estante', NIVEL: 'Nível', POSICAO: 'Posição' };
const LOC_STATUS: Record<string, string> = { ATIVO: 'Ativo', BLOQUEADO: 'Bloqueado', INATIVO: 'Inativo' };
const DIR: Record<string, string> = { INBOUND: 'Entrada (do Axis)', OUTBOUND: 'Saída (para o Axis)' };
const MSG: Record<string, string> = { RECEIVED: 'Recebida', PROCESSED: 'Processada', IGNORED: 'Ignorada', FAILED: 'Com falha', PENDING: 'Pendente', DELIVERED: 'Entregue' };

export function Admin({ warehouseId, canIntegration, canWrite = false, canPolicy = false }: { warehouseId?: string; canIntegration: boolean; canWrite?: boolean; canPolicy?: boolean }) {
  const [part, setPart] = useState<'loc' | 'pol' | 'int'>('loc');
  return (
    <section>
      <h1>Administração</h1>
      <div className="toolbar">
        <button className={part === 'loc' ? 'btn' : 'btn ghost'} onClick={() => setPart('loc')}>Endereços</button>
        <button className={part === 'pol' ? 'btn' : 'btn ghost'} onClick={() => setPart('pol')}>Parâmetros de reposição</button>
        {canIntegration && <button className={part === 'int' ? 'btn' : 'btn ghost'} onClick={() => setPart('int')}>Integração com o Axis</button>}
      </div>
      {part === 'pol' ? <Policies warehouseId={warehouseId} canWrite={canPolicy} /> : part === 'int' && canIntegration ? <Integration /> : <Locations warehouseId={warehouseId} canWrite={canWrite} />}
    </section>
  );
}

function Locations({ warehouseId, canWrite }: { warehouseId?: string; canWrite: boolean }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [res, reload] = useLoad(() => (warehouseId ? call<Loc[]>(`/warehouses/${warehouseId}/locations`) : Promise.resolve([] as Loc[])), [warehouseId]);
  const term = q.trim().toLowerCase();
  const rows = (res.state === 'ready' ? res.data : []).filter((l) => (!status || l.status === status) && (!term || `${l.code} ${l.name ?? ''}`.toLowerCase().includes(term)));
  const [editing, setEditing] = useState<Loc | null>(null);
  const cols: Column<Loc>[] = [
    { key: 'c', header: 'Código', render: (l) => <strong>{l.code}</strong> },
    { key: 'n', header: 'Nome', render: (l) => l.name ?? '—' },
    { key: 'l', header: 'Nível', render: (l) => LEVEL[l.level] ?? l.level },
    { key: 's', header: 'Situação', render: (l) => <span className={`pill ${l.status === 'ATIVO' ? 'ok' : 'warn'}`}>{LOC_STATUS[l.status] ?? l.status}</span> },
    { key: 'cap', header: 'Capacidade', render: (l) => (l.capacityKind ? `${l.capacityValue === null ? '—' : fmtQty(l.capacityValue)} (${l.capacityKind.toLowerCase()})` : '—') },
    { key: 'f', header: 'Observações', render: (l) => [l.isVirtual && 'Virtual', l.restrictedAccess && 'Acesso restrito', l.blockedReason].filter(Boolean).join(' · ') || '—' },
    { key: 'ed', header: '', render: (l) => (canWrite ? <button className="btn ghost" onClick={() => setEditing(l)}>Editar</button> : null) },
  ];
  return (
    <>
      {editing && warehouseId && <EditLocation warehouseId={warehouseId} loc={editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      {canWrite && warehouseId && !editing && <NewLocation warehouseId={warehouseId} locations={res.state === 'ready' ? res.data : []} onDone={reload} />}
      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Buscar<input className="inp" placeholder="Código ou nome" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="field">Situação<select className="inp" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(LOC_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </form>
      <DataTable cols={cols} rows={rows} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} rowKey={(l) => l.id} empty={warehouseId ? 'Nenhum endereço encontrado.' : 'Selecione um almoxarifado.'} />
    </>
  );
}

function Integration() {
  const [res, reload] = useLoad(() => call<Outbox>('/integration/outbox/status'), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dispatch = async () => { if (busy) return; setBusy(true); setErr(''); try { await call('/integration/outbox/dispatch', { method: 'POST', body: '{}' }); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  if (res.state === 'loading') return <div className="skeleton" />;
  if (res.state === 'error') return <div className="card" role="alert"><p className="err">{res.message}</p><button className="btn" onClick={reload}>Tentar de novo</button></div>;
  const o = res.data;
  return (
    <div className="card">
      <p>{o.configured ? <span className="pill ok">Destino de eventos configurado</span> : <span className="pill warn">Destino de eventos não configurado (AXIS_EVENTS_URL)</span>}</p>
      <dl className="kv">{o.counts.map((c) => <div key={`${c.direction}${c.status}`}><dt>{DIR[c.direction] ?? c.direction} · {MSG[c.status] ?? c.status}</dt><dd>{c.count}</dd></div>)}<div><dt>Pendência mais antiga</dt><dd>{o.oldestPendingAt ? fmtDateTime(o.oldestPendingAt) : '—'}</dd></div></dl>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row"><button className="btn" disabled={busy} onClick={() => void dispatch()}>{busy ? 'Enviando…' : 'Enviar pendências agora'}</button><button className="btn ghost" onClick={reload}>Atualizar</button></div>
    </div>
  );
}

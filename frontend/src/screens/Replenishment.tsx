import { useMemo, useState } from 'react';
import { call } from '../lib/api';
import { fmtDateTime, fmtQty } from '../lib/format';
import { allMaterials, matLabel } from '../lib/lookups';
import { DataTable, useLoad, type Column } from '../ui';

interface Suggestion { id: string; seq: number; warehouseId: string; materialId: string; status: string; suggestedQty: string; approvedQty: string | null; expectedAt: string | null; discardReason: string | null; createdAt: string }
interface Alert { id: string; kind: string; severity: string; status: string; message: string; responsibleRole: string; createdAt: string }

const SUG: Record<string, string> = { ABERTA: 'Aberta', ENVIADA_AXIS: 'Enviada ao Axis', APROVADA_AXIS: 'Aprovada no Axis', ATENDIDA: 'Atendida', DESCARTADA: 'Descartada' };
const SEV: Record<string, string> = { INFO: 'Informativo', ATENCAO: 'Atenção', CRITICO: 'Crítico' };

export function Replenishment({ warehouseId, canManage, canAck }: { warehouseId?: string; canManage: boolean; canAck: boolean }) {
  const [part, setPart] = useState<'sug' | 'alt'>('sug');
  return (
    <section>
      <h2>Reposição e alertas</h2>
      <div className="toolbar">
        <button className={part === 'sug' ? 'btn' : 'btn ghost'} onClick={() => setPart('sug')}>Sugestões de compra</button>
        <button className={part === 'alt' ? 'btn' : 'btn ghost'} onClick={() => setPart('alt')}>Alertas e faltas</button>
      </div>
      {part === 'sug' ? <Suggestions warehouseId={warehouseId} canManage={canManage} /> : <Alerts warehouseId={warehouseId} canAck={canAck} />}
    </section>
  );
}

function Suggestions({ warehouseId, canManage }: { warehouseId?: string; canManage: boolean }) {
  const [status, setStatus] = useState('ABERTA');
  const [res, reload] = useLoad(() => call<Suggestion[]>(`/replenishment/suggestions?${new URLSearchParams({ ...(status && { status }), ...(warehouseId && { warehouseId }) })}`), [status, warehouseId]);
  const [mats] = useLoad(allMaterials, []);
  const byId = useMemo(() => new Map((mats.state === 'ready' ? mats.data : []).map((m) => [m.id, m])), [mats]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (s: Suggestion, kind: 'send' | 'discard') => {
    if (busy) return;
    let body: unknown = {};
    if (kind === 'discard') {
      const reason = window.prompt('Motivo do descarte (mínimo 3 caracteres):')?.trim();
      if (!reason || reason.length < 3) return;
      body = { reason };
    } else if (!window.confirm('Enviar esta sugestão ao Axis para virar pedido de compra?')) return;
    setBusy(true); setErr('');
    try { await call(`/replenishment/suggestions/${s.id}/${kind}`, { method: 'POST', body: JSON.stringify(body) }); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const calculate = async () => {
    if (busy || !warehouseId) return;
    setBusy(true); setErr('');
    try { await call('/replenishment/calculate', { method: 'POST', body: JSON.stringify({ warehouseId }) }); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const cols: Column<Suggestion>[] = [
    { key: 'm', header: 'Material', render: (s) => matLabel(byId, s.materialId) },
    { key: 'q', header: 'Quantidade sugerida', num: true, render: (s) => fmtQty(s.suggestedQty) },
    { key: 'st', header: 'Situação', render: (s) => <span className={`pill ${s.status === 'ABERTA' ? 'warn' : s.status === 'DESCARTADA' ? 'bad' : 'ok'}`}>{SUG[s.status] ?? s.status}</span> },
    { key: 'e', header: 'Previsto para', render: (s) => (s.expectedAt ? s.expectedAt.slice(0, 10).split('-').reverse().join('/') : '—') },
    { key: 'c', header: 'Calculada em', render: (s) => fmtDateTime(s.createdAt) },
    { key: 'a', header: '', render: (s) => (canManage && s.status === 'ABERTA' ? <div className="row"><button className="btn" disabled={busy} onClick={() => void act(s, 'send')}>Enviar ao Axis</button><button className="btn ghost" disabled={busy} onClick={() => void act(s, 'discard')}>Descartar</button></div> : s.discardReason ?? null) },
  ];
  return (
    <>
      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Situação<select className="inp" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(SUG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {canManage && warehouseId && <button type="button" className="btn" disabled={busy} onClick={() => void calculate()}>Recalcular sugestões</button>}
      </form>
      {err && <p className="err" role="alert">{err}</p>}
      <DataTable cols={cols} rows={res.state === 'ready' ? res.data : []} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} rowKey={(s) => s.id} empty="Nenhuma sugestão de reposição." />
    </>
  );
}

function Alerts({ warehouseId, canAck }: { warehouseId?: string; canAck: boolean }) {
  const [sev, setSev] = useState('');
  const [res, reload] = useLoad(() => call<Alert[]>(`/alerts?${new URLSearchParams({ ...(sev && { severity: sev }), ...(warehouseId && { warehouseId }) })}`), [sev, warehouseId]);
  const [err, setErr] = useState('');
  const ack = async (a: Alert) => { setErr(''); try { await call(`/alerts/${a.id}/acknowledge`, { method: 'POST', body: '{}' }); reload(); } catch (e) { setErr((e as Error).message); } };
  const cols: Column<Alert>[] = [
    { key: 'sv', header: 'Gravidade', render: (a) => <span className={`pill ${a.severity === 'CRITICO' ? 'bad' : a.severity === 'ATENCAO' ? 'warn' : ''}`}>{SEV[a.severity] ?? a.severity}</span> },
    { key: 'k', header: 'Tipo', render: (a) => a.kind.replaceAll('_', ' ').toLowerCase() },
    { key: 'm', header: 'Mensagem', render: (a) => a.message },
    { key: 'r', header: 'Responsável', render: (a) => a.responsibleRole },
    { key: 'c', header: 'Desde', render: (a) => fmtDateTime(a.createdAt) },
    { key: 'a', header: '', render: (a) => (a.status === 'RECONHECIDO' ? 'Reconhecido' : canAck ? <button className="btn ghost" onClick={() => void ack(a)}>Reconhecer</button> : null) },
  ];
  return (
    <>
      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Gravidade<select className="inp" value={sev} onChange={(e) => setSev(e.target.value)}><option value="">Todas</option>{Object.entries(SEV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </form>
      {err && <p className="err" role="alert">{err}</p>}
      <DataTable cols={cols} rows={res.state === 'ready' ? res.data : []} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} rowKey={(a) => a.id} empty="Nenhum alerta aberto." />
    </>
  );
}

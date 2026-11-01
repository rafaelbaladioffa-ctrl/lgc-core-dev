import { useState } from 'react';
import { call } from '../lib/api';
import { fmtQty } from '../lib/format';
import { matLabel } from '../lib/lookups';
import { parseNum } from './AdminForms';
import { useLoad } from '../ui';

interface Item { id: string; materialId: string; quantity: string; toLocationId?: string | null }
interface Loc { id: string; code: string; status: string }

/** Monta o corpo do recebimento; devolve a mensagem de erro quando algum item é inválido. */
export function buildReceiveBody(items: Item[], vals: Record<string, { qty: string; loc: string }>): { error: string } | { body: { items: Array<{ itemId: string; receivedQty: number; toLocationId: string }> } } {
  const out: Array<{ itemId: string; receivedQty: number; toLocationId: string }> = [];
  for (const it of items) {
    const v = vals[it.id] ?? { qty: '', loc: '' };
    const q = parseNum(v.qty);
    if (q === null || q < 0) return { error: 'Informe a quantidade recebida de cada item (zero ou mais).' };
    if (q > Number(it.quantity)) return { error: 'A quantidade recebida não pode ser maior que a expedida.' };
    if (!v.loc) return { error: 'Escolha o endereço de destino de cada item.' };
    out.push({ itemId: it.id, receivedQty: q, toLocationId: v.loc });
  }
  return { body: { items: out } };
}

export function TransferReceive({ id, toWarehouseId, items, byId, onDone }: { id: string; toWarehouseId: string; items: Item[]; byId: Map<string, { code: string; shortDescription: string }>; onDone: () => void }) {
  const [locs] = useLoad(() => call<Loc[]>(`/warehouses/${toWarehouseId}/locations`), [toWarehouseId]);
  const [vals, setVals] = useState<Record<string, { qty: string; loc: string }>>(() => Object.fromEntries(items.map((i) => [i.id, { qty: String(Number(i.quantity)), loc: i.toLocationId ?? '' }])));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const active = (locs.state === 'ready' ? locs.data : []).filter((l) => l.status === 'ATIVO');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const r = buildReceiveBody(items, vals);
    if ('error' in r) return setErr(r.error);
    if (r.body.items.some((i, n) => i.receivedQty !== Number(items[n].quantity)) && !window.confirm('Há itens com quantidade diferente da expedida. Registrar o recebimento com divergência?')) return;
    setBusy(true); setErr('');
    try { await call(`/transfers/${id}/receive`, { method: 'POST', body: JSON.stringify(r.body) }); onDone(); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  if (locs.state === 'loading') return <div className="skeleton" />;
  if (locs.state === 'error') return <p className="err" role="alert">{locs.message}</p>;
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h3>Receber no destino</h3>
      {items.map((it) => (
        <div key={it.id} className="line">
          <strong>{matLabel(byId as never, it.materialId)}</strong> <span className="hint">expedido {fmtQty(it.quantity)}</span>
          <div className="row">
            <input className="inp" aria-label="Quantidade recebida" inputMode="decimal" value={vals[it.id].qty} onChange={(e) => setVals({ ...vals, [it.id]: { ...vals[it.id], qty: e.target.value } })} />
            <select className="inp" aria-label="Endereço de destino" value={vals[it.id].loc} onChange={(e) => setVals({ ...vals, [it.id]: { ...vals[it.id], loc: e.target.value } })}><option value="">Endereço de destino…</option>{active.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>
          </div>
        </div>
      ))}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn block" type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Registrar recebimento'}</button>
    </form>
  );
}

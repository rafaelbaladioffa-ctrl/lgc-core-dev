import { useState } from 'react';
import { call } from '../lib/api';
import { fmtQty } from '../lib/format';
import { parseNum } from './AdminForms';

export interface AdjustBalance { materialId: string; locationId: string; lotId: string | null; condition: string; ownership: string; quantity: string; reserved: string }

/** Monta o movimento de ajuste (nunca exclusão: o ledger é imutável). Devolve o erro de validação quando houver. */
export function buildAdjustment(b: AdjustBalance, mode: 'zero' | 'set', target: string, reason: string, approval: string): { error: string } | { body: Record<string, unknown> } {
  const qty = Number(b.quantity), reserved = Number(b.reserved);
  let wanted: number;
  if (mode === 'zero') wanted = 0;
  else {
    const n = parseNum(target);
    if (n === null || n < 0) return { error: 'Informe a quantidade final (zero ou mais).' };
    wanted = n;
  }
  if (wanted < reserved) return { error: `Há ${fmtQty(reserved)} reservado(s); libere as reservas antes de reduzir o saldo abaixo disso.` };
  const delta = Math.round((wanted - qty) * 1e6) / 1e6;
  if (delta === 0) return { error: 'A quantidade final é igual ao saldo atual.' };
  if (reason.trim().length < 3) return { error: 'Informe o motivo do ajuste (mínimo 3 caracteres).' };
  if (!approval.trim()) return { error: 'Informe a aprovação do Axis para o ajuste.' };
  const common = { materialId: b.materialId, quantity: Math.abs(delta), reason: reason.trim(), axisApprovalRef: approval.trim(), ...(b.lotId ? { lotId: b.lotId } : {}), ownership: b.ownership };
  return { body: delta < 0 ? { type: 'AJUSTE_NEGATIVO', fromLocationId: b.locationId, fromCondition: b.condition, ...common } : { type: 'AJUSTE_POSITIVO', toLocationId: b.locationId, toCondition: b.condition, ...common } };
}

export function StockAdjust({ balance, label, onDone, onCancel }: { balance: AdjustBalance; label: string; onDone: () => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'zero' | 'set'>('zero');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const r = buildAdjustment(balance, mode, target, reason, approval);
    if ('error' in r) return setError(r.error);
    if (!window.confirm('Registrar este ajuste? Ele fica no histórico e não pode ser apagado.')) return;
    setBusy(true); setError('');
    try {
      await call('/stock/movements', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(r.body) });
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h3>Ajustar saldo</h3>
      <p className="hint">{label} · saldo atual {fmtQty(balance.quantity)} (reservado {fmtQty(balance.reserved)}). O saldo não é apagado: o sistema registra um movimento de ajuste.</p>
      <div className="row">
        <button type="button" className={mode === 'zero' ? 'btn' : 'btn ghost'} onClick={() => setMode('zero')}>Zerar saldo</button>
        <button type="button" className={mode === 'set' ? 'btn' : 'btn ghost'} onClick={() => setMode('set')}>Ajustar para…</button>
      </div>
      {mode === 'set' && <><label className="lbl" htmlFor="adj-q">Quantidade final <span aria-hidden="true">*</span></label><input id="adj-q" className="inp" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></>}
      <label className="lbl" htmlFor="adj-r">Motivo <span aria-hidden="true">*</span></label>
      <input id="adj-r" className="inp" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <label className="lbl" htmlFor="adj-a">Aprovação do Axis <span aria-hidden="true">*</span></label>
      <input id="adj-a" className="inp" value={approval} maxLength={80} onChange={(e) => setApproval(e.target.value)} />
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Registrar ajuste'}</button><button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

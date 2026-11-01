import { useMemo, useState } from 'react';
import { call } from '../lib/api';
import { fmtQty } from '../lib/format';
import { allMaterials, matLabel } from '../lib/lookups';
import { DataTable, useLoad, type Column } from '../ui';

export const LEVELS: Record<string, string> = { AREA: 'Área', CORREDOR: 'Corredor', ESTANTE: 'Estante', NIVEL: 'Nível', POSICAO: 'Posição' };
export const CODE_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

/** Valida o código de endereço no mesmo formato aceito pela API. */
export function validateLocationCode(code: string): string | undefined {
  const c = code.trim();
  if (!c) return 'Informe o código do endereço.';
  if (c.length > 40) return 'O código deve ter no máximo 40 caracteres.';
  if (!CODE_RE.test(c)) return 'Código inválido. Use maiúsculas, números e hífens (ex.: A01-C02-E03).';
  return undefined;
}

export function parseNum(v: string): number | null {
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

interface Loc { id: string; code: string; level: string }

export function NewLocation({ warehouseId, locations, onDone }: { warehouseId: string; locations: Loc[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [level, setLevel] = useState('POSICAO');
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [codeErr, setCodeErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Novo endereço</button>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const c = code.trim().toUpperCase();
    const v = validateLocationCode(c);
    setCodeErr(v);
    if (v) return;
    setBusy(true); setError('');
    try {
      await call(`/warehouses/${warehouseId}/locations`, { method: 'POST', body: JSON.stringify({ code: c, level, ...(parent ? { parentId: parent } : {}), ...(name.trim() ? { name: name.trim() } : {}) }) });
      setCode(''); setName(''); setParent(''); setOpen(false); onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h3>Novo endereço</h3>
      <label className="lbl" htmlFor="lc">Código <span aria-hidden="true">*</span></label>
      <input id="lc" className="inp" value={code} maxLength={40} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-invalid={!!codeErr} aria-describedby={codeErr ? 'lc-err' : undefined} placeholder="A01-C02-E03" />
      {codeErr && <p id="lc-err" className="err" role="alert">{codeErr}</p>}
      <label className="lbl" htmlFor="ll">Nível <span aria-hidden="true">*</span></label>
      <select id="ll" className="inp" value={level} onChange={(e) => setLevel(e.target.value)}>{Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <label className="lbl" htmlFor="lp">Endereço superior</label>
      <select id="lp" className="inp" value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Nenhum</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>
      <label className="lbl" htmlFor="ln">Nome</label>
      <input id="ln" className="inp" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar endereço'}</button><button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button></div>
    </form>
  );
}

interface Policy { id: string; materialId: string; warehouseId: string; minQty: string; maxQty: string | null; safetyQty: string | null; reorderPoint: string | null }

export function Policies({ warehouseId, canWrite }: { warehouseId?: string; canWrite: boolean }) {
  const [res, reload] = useLoad(() => call<Policy[]>(`/stock-policies${warehouseId ? `?warehouseId=${warehouseId}` : ''}`), [warehouseId]);
  const [mats] = useLoad(allMaterials, []);
  const byId = useMemo(() => new Map((mats.state === 'ready' ? mats.data : []).map((m) => [m.id, m])), [mats]);
  const [form, setForm] = useState<{ materialId: string; min: string; max: string; safety: string; reorder: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const edit = (p?: Policy) => { setError(''); setForm({ materialId: p?.materialId ?? '', min: p ? String(Number(p.minQty)) : '', max: p?.maxQty != null ? String(Number(p.maxQty)) : '', safety: p?.safetyQty != null ? String(Number(p.safetyQty)) : '', reorder: p?.reorderPoint != null ? String(Number(p.reorderPoint)) : '' }); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || busy || !warehouseId) return;
    const min = parseNum(form.min), max = parseNum(form.max), safety = parseNum(form.safety), reorder = parseNum(form.reorder);
    if (!form.materialId) return setError('Selecione o material.');
    if (min === null || min < 0) return setError('Informe o estoque mínimo (zero ou mais).');
    for (const [v, n] of [[max, 'máximo'], [safety, 'estoque de segurança'], [reorder, 'ponto de reposição']] as const) if (v !== null && v < 0) return setError(`O ${n} não pode ser negativo.`);
    if (max !== null && max < min) return setError('O máximo não pode ser menor que o mínimo.');
    setBusy(true); setError('');
    try {
      await call('/stock-policies', { method: 'PUT', body: JSON.stringify({ materialId: form.materialId, warehouseId, minQty: min, ...(max !== null ? { maxQty: max } : {}), ...(safety !== null ? { safetyQty: safety } : {}), ...(reorder !== null ? { reorderPoint: reorder } : {}) }) });
      setForm(null); reload();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const cols: Column<Policy>[] = [
    { key: 'm', header: 'Material', render: (p) => matLabel(byId, p.materialId) },
    { key: 'min', header: 'Mínimo', num: true, render: (p) => fmtQty(p.minQty) },
    { key: 'max', header: 'Máximo', num: true, render: (p) => (p.maxQty != null ? fmtQty(p.maxQty) : '—') },
    { key: 'sf', header: 'Segurança', num: true, render: (p) => (p.safetyQty != null ? fmtQty(p.safetyQty) : '—') },
    { key: 'rp', header: 'Ponto de reposição', num: true, render: (p) => (p.reorderPoint != null ? fmtQty(p.reorderPoint) : '—') },
    { key: 'a', header: '', render: (p) => (canWrite ? <button className="btn ghost" onClick={() => edit(p)}>Editar</button> : null) },
  ];
  return (
    <>
      {canWrite && warehouseId && !form && <div className="toolbar"><button className="btn" onClick={() => edit()}>Nova política</button></div>}
      {form && (
        <form className="card" onSubmit={save} noValidate>
          <h3>Parâmetros de reposição</h3>
          <label className="lbl" htmlFor="pm">Material <span aria-hidden="true">*</span></label>
          <select id="pm" className="inp" value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })}><option value="">Selecione…</option>{[...byId.values()].map((m) => <option key={m.id} value={m.id}>{m.code} — {m.shortDescription}</option>)}</select>
          {([['min', 'Estoque mínimo', true], ['max', 'Estoque máximo', false], ['safety', 'Estoque de segurança', false], ['reorder', 'Ponto de reposição', false]] as const).map(([k, label, req]) => (
            <div key={k}><label className="lbl" htmlFor={`p-${k}`}>{label} {req && <span aria-hidden="true">*</span>}</label><input id={`p-${k}`} className="inp" inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
          ))}
          {error && <p className="err" role="alert">{error}</p>}
          <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button><button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancelar</button></div>
        </form>
      )}
      <DataTable cols={cols} rows={res.state === 'ready' ? res.data : []} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} rowKey={(p) => p.id} empty={warehouseId ? 'Nenhum parâmetro de reposição cadastrado.' : 'Selecione um almoxarifado.'} />
    </>
  );
}

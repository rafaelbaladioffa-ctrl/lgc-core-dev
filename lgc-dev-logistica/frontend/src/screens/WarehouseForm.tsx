import { useState } from 'react';
import { call, type Warehouse } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { axisName, PERSON } from '../lib/lookups';
import { AxisPicker, useAxisNames } from '../AxisPicker';
import { DataTable, useLoad, type Column } from '../ui';

export const WAREHOUSE_TYPES: Record<string, string> = { CENTRAL: 'Central', UNIDADE: 'Unidade', PROJETO: 'Projeto', TEMPORARIO: 'Temporário', VEICULO: 'Veículo', CONSIGNACAO: 'Consignação', VIRTUAL: 'Virtual' };
const STATUS: Record<string, string> = { ATIVO: 'Ativo', INATIVO: 'Inativo' };
const CODE_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

export interface WarehouseInput { code: string; name: string; type: string; addressText: string }
export type WarehouseErrors = Partial<Record<keyof WarehouseInput, string>>;

/** Mesmas regras do `CreateWarehouseDto` da API, para o erro aparecer no campo antes de enviar. */
export function validateWarehouse(v: WarehouseInput): WarehouseErrors {
  const e: WarehouseErrors = {};
  const code = v.code.trim();
  if (!code) e.code = 'Informe o código.';
  else if (code.length > 30) e.code = 'O código deve ter no máximo 30 caracteres.';
  else if (!CODE_RE.test(code)) e.code = 'Código inválido. Use maiúsculas, números e hífens (ex.: ALM-SUMARE).';
  const name = v.name.trim();
  if (name.length < 3) e.name = 'O nome deve ter ao menos 3 caracteres.';
  else if (name.length > 120) e.name = 'O nome deve ter no máximo 120 caracteres.';
  if (!WAREHOUSE_TYPES[v.type]) e.type = 'Escolha o tipo.';
  if (v.addressText.trim().length > 300) e.addressText = 'O endereço deve ter no máximo 300 caracteres.';
  return e;
}

/** Vínculos com cadastros do Core, escolhidos no cache (nunca digitados): responsável e site onde o almoxarifado fica. */
export interface WarehouseCoreRefs { responsibleAxisUserId: string; siteAxisId: string }

/** Corpo do `POST /warehouses`: campos vazios não vão (a API recusa campo extra e trata ausente como "sem vínculo"). */
export function warehousePayload(v: WarehouseInput, refs: WarehouseCoreRefs = { responsibleAxisUserId: '', siteAxisId: '' }) {
  const addressText = v.addressText.trim();
  return {
    code: v.code.trim(), name: v.name.trim(), type: v.type,
    ...(addressText ? { addressText } : {}),
    ...(refs.responsibleAxisUserId ? { responsibleAxisUserId: refs.responsibleAxisUserId } : {}),
    ...(refs.siteAxisId ? { siteAxisId: refs.siteAxisId } : {}),
  };
}

export type CreatedWarehouse = Warehouse & { referenceWarnings?: string[] };

export function NewWarehouseForm({ onDone, onCancel }: { onDone: (w: CreatedWarehouse) => void; onCancel?: () => void }) {
  const [v, setV] = useState<WarehouseInput>({ code: '', name: '', type: 'CENTRAL', addressText: '' });
  const [refs, setRefs] = useState<WarehouseCoreRefs>({ responsibleAxisUserId: '', siteAxisId: '' });
  const [errs, setErrs] = useState<WarehouseErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof WarehouseInput, value: string) => setV((cur) => ({ ...cur, [k]: value }));
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const found = validateWarehouse(v);
    setErrs(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true); setError('');
    try {
      const created = await call<CreatedWarehouse>('/warehouses', { method: 'POST', body: JSON.stringify(warehousePayload(v, refs)) });
      onDone(created);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const field = (k: keyof WarehouseInput) => ({ 'aria-invalid': !!errs[k], 'aria-describedby': errs[k] ? `wh-${k}-err` : undefined });
  const fieldErr = (k: keyof WarehouseInput) => errs[k] && <p id={`wh-${k}-err`} className="err" role="alert">{errs[k]}</p>;
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h3>Novo almoxarifado</h3>
      <label className="lbl" htmlFor="wh-code">Código <span aria-hidden="true">*</span></label>
      <input id="wh-code" className="inp" value={v.code} maxLength={30} placeholder="ALM-SUMARE" onChange={(e) => set('code', e.target.value.toUpperCase())} {...field('code')} />
      {fieldErr('code')}
      <label className="lbl" htmlFor="wh-name">Nome <span aria-hidden="true">*</span></label>
      <input id="wh-name" className="inp" value={v.name} maxLength={120} placeholder="Almoxarifado central — Sumaré" onChange={(e) => set('name', e.target.value)} {...field('name')} />
      {fieldErr('name')}
      <label className="lbl" htmlFor="wh-type">Tipo <span aria-hidden="true">*</span></label>
      <select id="wh-type" className="inp" value={v.type} onChange={(e) => set('type', e.target.value)} {...field('type')}>{Object.entries(WAREHOUSE_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
      {fieldErr('type')}
      <AxisPicker kinds={['COLLABORATOR']} label="Responsável (colaborador do Axis)" value={refs.responsibleAxisUserId} onChange={(id) => setRefs((r) => ({ ...r, responsibleAxisUserId: id }))} />
      <AxisPicker kinds={['SITE']} label="Site do Axis (opcional)" value={refs.siteAxisId} onChange={(id) => setRefs((r) => ({ ...r, siteAxisId: id }))} />
      <label className="lbl" htmlFor="wh-addr">Endereço</label>
      <input id="wh-addr" className="inp" value={v.addressText} maxLength={300} placeholder="Rua, número, cidade/UF" onChange={(e) => set('addressText', e.target.value)} {...field('addressText')} />
      {fieldErr('addressText')}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar almoxarifado'}</button>{onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>}</div>
    </form>
  );
}

interface WarehouseRow extends Warehouse { type: string; status: string; addressText: string | null; responsibleAxisUserId: string | null; siteAxisId: string | null; createdAt: string }

/** Administração → Almoxarifados: lista os que o usuário enxerga e, com `warehouse:write`, cadastra novos. */
export function Warehouses({ canWrite }: { canWrite: boolean }) {
  const [res, reload] = useLoad(() => call<WarehouseRow[]>('/warehouses'), []);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState('');
  const rows = res.state === 'ready' ? res.data : [];
  const people = useAxisNames(PERSON, rows.map((w) => w.responsibleAxisUserId));
  const sites = useAxisNames(['SITE'], rows.map((w) => w.siteAxisId));
  const cols: Column<WarehouseRow>[] = [
    { key: 'c', header: 'Código', render: (w) => <strong>{w.code}</strong> },
    { key: 'n', header: 'Nome', render: (w) => w.name },
    { key: 't', header: 'Tipo', render: (w) => WAREHOUSE_TYPES[w.type] ?? w.type },
    { key: 'r', header: 'Responsável', render: (w) => axisName(people, w.responsibleAxisUserId) },
    { key: 'si', header: 'Site', render: (w) => axisName(sites, w.siteAxisId) },
    { key: 'a', header: 'Endereço', render: (w) => w.addressText ?? '—' },
    { key: 's', header: 'Situação', render: (w) => <span className={`pill ${w.status === 'ATIVO' ? 'ok' : 'warn'}`}>{STATUS[w.status] ?? w.status}</span> },
    { key: 'd', header: 'Cadastrado em', render: (w) => fmtDateTime(w.createdAt) },
  ];
  return (
    <>
      {done && <p className="notice" role="status">{done}</p>}
      {canWrite && (open
        ? <NewWarehouseForm onCancel={() => setOpen(false)} onDone={(w) => { setOpen(false); setDone([`Almoxarifado ${w.code} cadastrado.`, ...(w.referenceWarnings ?? [])].join(' ')); reload(); }} />
        : <div className="toolbar"><button className="btn" onClick={() => { setOpen(true); setDone(''); }}>Novo almoxarifado</button></div>)}
      <DataTable cols={cols} rows={rows} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} rowKey={(w) => w.id} empty="Nenhum almoxarifado cadastrado." />
    </>
  );
}

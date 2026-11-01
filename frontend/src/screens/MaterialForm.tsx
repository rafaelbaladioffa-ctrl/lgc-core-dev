import { useState } from 'react';
import { call } from '../lib/api';
import { useLoad } from '../ui';

export const MATERIAL_TYPES: Record<string, string> = { CONSUMO: 'Consumo', FERRAMENTA: 'Ferramenta', EQUIPAMENTO: 'Equipamento', ATIVO: 'Ativo', EMBALAGEM: 'Embalagem', QUIMICO: 'Químico', EPI: 'EPI', EPC: 'EPC', SOBRESSALENTE: 'Sobressalente' };
const EXIT: Record<string, string> = { FIFO: 'FIFO (primeiro a entrar, primeiro a sair)', FEFO: 'FEFO (primeiro a vencer, primeiro a sair)', SERIE_ESPECIFICA: 'Série específica' };
const AUTH_BY = ['HSE', 'QUALIDADE', 'TI', 'GESTOR'];
const CODE_RE = /^[A-Z0-9]+(-[A-Z0-9]+)+$/;

export interface MaterialValues {
  code: string; shortDescription: string; technicalDescription: string; category: string; subcategory: string; type: string; stockUomId: string;
  manufacturer: string; brand: string; model: string; manufacturerCode: string;
  lotControlled: boolean; expiryControlled: boolean; serialControlled: boolean; assetTagged: boolean; requiresCa: boolean; requiresCalibration: boolean; hasSizeGrid: boolean; returnable: boolean; disposable: boolean;
  exitMethod: string; criticality: string; minShelfLifeDays: string; requiresAuthorization: boolean; authorizationBy: string; changeReason: string;
}

export const emptyMaterial = (): MaterialValues => ({
  code: '', shortDescription: '', technicalDescription: '', category: '', subcategory: '', type: '', stockUomId: '', manufacturer: '', brand: '', model: '', manufacturerCode: '',
  lotControlled: false, expiryControlled: false, serialControlled: false, assetTagged: false, requiresCa: false, requiresCalibration: false, hasSizeGrid: false, returnable: false, disposable: false,
  exitMethod: 'FIFO', criticality: 'C', minShelfLifeDays: '', requiresAuthorization: false, authorizationBy: '', changeReason: '',
});

export type Errors = Partial<Record<keyof MaterialValues, string>>;

/** Mesmas regras da API (7.1/7.2), para avisar antes de enviar. */
export function validateMaterial(v: MaterialValues, mode: 'create' | 'edit'): Errors {
  const e: Errors = {};
  if (mode === 'create') {
    if (!v.code.trim()) e.code = 'Informe o código.';
    else if (!CODE_RE.test(v.code.trim())) e.code = 'Código inválido. Use maiúsculas, números e hífens (ex.: EPI-CAP-0001).';
  }
  if (v.shortDescription.trim().length < 3) e.shortDescription = 'A descrição curta deve ter ao menos 3 caracteres.';
  if (v.shortDescription.trim().length > 160) e.shortDescription = 'A descrição curta deve ter no máximo 160 caracteres.';
  if (v.category.trim().length < 2) e.category = 'Informe a categoria.';
  if (!v.type) e.type = 'Informe o tipo de material.';
  if (!v.stockUomId) e.stockUomId = 'Informe a unidade de estoque.';
  if (v.expiryControlled && !v.lotControlled) e.expiryControlled = 'Material com controle de validade exige controle por lote.';
  if (v.minShelfLifeDays.trim() !== '' && !v.expiryControlled) e.minShelfLifeDays = 'A vida útil mínima só se aplica a material com controle de validade.';
  if (v.minShelfLifeDays.trim() !== '' && !/^\d+$/.test(v.minShelfLifeDays.trim())) e.minShelfLifeDays = 'Informe um número inteiro de dias.';
  if (v.serialControlled && v.exitMethod !== 'SERIE_ESPECIFICA') e.exitMethod = 'Material controlado por número de série deve usar a saída por série específica.';
  if (v.exitMethod === 'FEFO' && !v.expiryControlled) e.exitMethod = 'O método FEFO exige controle de validade.';
  if (v.requiresAuthorization && !v.authorizationBy) e.authorizationBy = 'Informe quem autoriza (HSE, Qualidade, TI ou gestor).';
  return e;
}

const TEXT_KEYS = ['shortDescription', 'technicalDescription', 'category', 'subcategory', 'manufacturer', 'brand', 'model', 'manufacturerCode'] as const;
const BOOL_KEYS = ['lotControlled', 'expiryControlled', 'serialControlled', 'assetTagged', 'requiresCa', 'requiresCalibration', 'hasSizeGrid', 'returnable', 'disposable', 'requiresAuthorization'] as const;

/** Corpo da criação (campos preenchidos) ou da edição (só o que mudou, mais o motivo). */
export function buildMaterialBody(v: MaterialValues, mode: 'create' | 'edit', original?: MaterialValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const changed = <K extends keyof MaterialValues>(k: K) => mode === 'create' || !original || original[k] !== v[k];
  if (mode === 'create') body.code = v.code.trim();
  for (const k of TEXT_KEYS) if (changed(k)) { const t = v[k].trim(); if (t !== '') body[k] = t; }
  if (changed('type') && v.type) body.type = v.type;
  if (changed('stockUomId') && v.stockUomId) body.stockUomId = v.stockUomId;
  for (const k of BOOL_KEYS) if (changed(k)) body[k] = v[k];
  if (changed('exitMethod')) body.exitMethod = v.exitMethod;
  if (changed('criticality')) body.criticality = v.criticality;
  if (changed('minShelfLifeDays') && v.minShelfLifeDays.trim() !== '') body.minShelfLifeDays = Number(v.minShelfLifeDays);
  if (v.requiresAuthorization && changed('authorizationBy')) body.authorizationBy = v.authorizationBy;
  if (mode === 'edit' && v.changeReason.trim()) body.changeReason = v.changeReason.trim();
  return body;
}

interface MaterialLike { code: string; shortDescription: string; technicalDescription?: string | null; category: string; subcategory?: string | null; type: string; stockUomId?: string; manufacturer?: string | null; brand?: string | null; model?: string | null; manufacturerCode?: string | null; lotControlled: boolean; expiryControlled: boolean; serialControlled: boolean; assetTagged: boolean; requiresCa: boolean; requiresCalibration: boolean; hasSizeGrid: boolean; returnable: boolean; disposable: boolean; exitMethod: string; criticality: string; minShelfLifeDays?: number | null; requiresAuthorization?: boolean; authorizationBy?: string | null }

export const valuesFromMaterial = (m: MaterialLike): MaterialValues => ({
  ...emptyMaterial(), code: m.code, shortDescription: m.shortDescription, technicalDescription: m.technicalDescription ?? '', category: m.category, subcategory: m.subcategory ?? '', type: m.type, stockUomId: m.stockUomId ?? '',
  manufacturer: m.manufacturer ?? '', brand: m.brand ?? '', model: m.model ?? '', manufacturerCode: m.manufacturerCode ?? '',
  lotControlled: m.lotControlled, expiryControlled: m.expiryControlled, serialControlled: m.serialControlled, assetTagged: m.assetTagged, requiresCa: m.requiresCa, requiresCalibration: m.requiresCalibration, hasSizeGrid: m.hasSizeGrid, returnable: m.returnable, disposable: m.disposable,
  exitMethod: m.exitMethod, criticality: m.criticality, minShelfLifeDays: m.minShelfLifeDays != null ? String(m.minShelfLifeDays) : '', requiresAuthorization: !!m.requiresAuthorization, authorizationBy: m.authorizationBy ?? '',
});

interface Uom { id: string; code: string; name: string }
export interface SavedMaterial { id: string }

export function MaterialForm({ mode, initial, materialId, onSaved, onCancel }: { mode: 'create' | 'edit'; initial: MaterialValues; materialId?: string; onSaved: (m: SavedMaterial) => void; onCancel: () => void }) {
  const [v, setV] = useState<MaterialValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uoms] = useLoad(() => call<Uom[]>('/units-of-measure'), []);
  const set = <K extends keyof MaterialValues>(k: K, val: MaterialValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = validateMaterial(v, mode);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const body = buildMaterialBody(v, mode, initial);
    if (mode === 'edit' && Object.keys(body).filter((k) => k !== 'changeReason').length === 0) return setError('Nenhuma alteração para salvar.');
    setBusy(true); setError('');
    try {
      const saved = await call<SavedMaterial>(mode === 'create' ? '/materials' : `/materials/${materialId}`, { method: mode === 'create' ? 'POST' : 'PATCH', body: JSON.stringify(body) });
      onSaved(saved);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const fe = (k: keyof MaterialValues) => errors[k] && <p id={`m-${k}-err`} className="err" role="alert">{errors[k]}</p>;
  const text = (k: keyof MaterialValues, label: string, required = false, max = 80) => (
    <div><label className="lbl" htmlFor={`m-${k}`}>{label} {required && <span aria-hidden="true">*</span>}</label>
      <input id={`m-${k}`} className="inp" value={v[k] as string} maxLength={max} aria-required={required} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `m-${k}-err` : undefined} onChange={(e) => set(k, e.target.value as never)} />{fe(k)}</div>
  );
  const check = (k: (typeof BOOL_KEYS)[number], label: string) => (
    <label className="chk"><input type="checkbox" checked={v[k]} onChange={(e) => set(k, e.target.checked)} /> {label}{errors[k] && <span className="err" role="alert"> — {errors[k]}</span>}</label>
  );
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h3>{mode === 'create' ? 'Novo material' : 'Editar material'}</h3>
      <p className="hint">Campos marcados com * são obrigatórios.</p>
      {mode === 'create' && text('code', 'Código', true, 40)}
      {text('shortDescription', 'Descrição curta', true, 160)}
      <div><label className="lbl" htmlFor="m-technicalDescription">Descrição técnica</label><textarea id="m-technicalDescription" className="inp" rows={3} maxLength={4000} value={v.technicalDescription} onChange={(e) => set('technicalDescription', e.target.value)} /></div>
      {text('category', 'Categoria', true)}
      {text('subcategory', 'Subcategoria')}
      <div><label className="lbl" htmlFor="m-type">Tipo <span aria-hidden="true">*</span></label>
        <select id="m-type" className="inp" value={v.type} aria-required aria-invalid={!!errors.type} onChange={(e) => set('type', e.target.value)}><option value="">Selecione…</option>{Object.entries(MATERIAL_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{fe('type')}</div>
      <div><label className="lbl" htmlFor="m-stockUomId">Unidade de estoque <span aria-hidden="true">*</span></label>
        <select id="m-stockUomId" className="inp" value={v.stockUomId} aria-required aria-invalid={!!errors.stockUomId} onChange={(e) => set('stockUomId', e.target.value)}><option value="">{uoms.state === 'loading' ? 'Carregando…' : 'Selecione…'}</option>{(uoms.state === 'ready' ? uoms.data : []).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}</select>{fe('stockUomId')}
        {uoms.state === 'error' && <p className="err" role="alert">{uoms.message}</p>}</div>
      <h3>Fabricante</h3>
      {text('manufacturer', 'Fabricante')}
      {text('brand', 'Marca')}
      {text('model', 'Modelo')}
      {text('manufacturerCode', 'Código do fabricante')}
      <h3>Controles</h3>
      <div className="checks">
        {check('lotControlled', 'Controle por lote')}{check('expiryControlled', 'Controle de validade')}{check('serialControlled', 'Número de série')}{check('assetTagged', 'Patrimônio')}
        {check('requiresCa', 'Exige CA')}{check('requiresCalibration', 'Exige calibração')}{check('hasSizeGrid', 'Grade de tamanhos')}{check('returnable', 'Retornável')}{check('disposable', 'Descartável')}
      </div>
      {text('minShelfLifeDays', 'Vida útil mínima (dias)', false, 5)}
      <div><label className="lbl" htmlFor="m-exitMethod">Método de saída</label>
        <select id="m-exitMethod" className="inp" value={v.exitMethod} aria-invalid={!!errors.exitMethod} onChange={(e) => set('exitMethod', e.target.value)}>{Object.entries(EXIT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{fe('exitMethod')}</div>
      <div><label className="lbl" htmlFor="m-criticality">Criticidade</label>
        <select id="m-criticality" className="inp" value={v.criticality} onChange={(e) => set('criticality', e.target.value)}><option value="A">A — alta</option><option value="B">B — média</option><option value="C">C — baixa</option></select></div>
      {check('requiresAuthorization', 'Exige autorização para retirada')}
      {v.requiresAuthorization && (
        <div><label className="lbl" htmlFor="m-authorizationBy">Quem autoriza <span aria-hidden="true">*</span></label>
          <select id="m-authorizationBy" className="inp" value={v.authorizationBy} aria-invalid={!!errors.authorizationBy} onChange={(e) => set('authorizationBy', e.target.value)}><option value="">Selecione…</option>{AUTH_BY.map((a) => <option key={a} value={a}>{a}</option>)}</select>{fe('authorizationBy')}</div>
      )}
      {mode === 'edit' && text('changeReason', 'Motivo da alteração (fica no histórico de versões)', false, 300)}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? 'Salvando…' : mode === 'create' ? 'Cadastrar material' : 'Salvar alterações'}</button><button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

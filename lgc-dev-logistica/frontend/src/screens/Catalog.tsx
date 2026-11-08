import { useState } from 'react';
import { call } from '../lib/api';
import { fmtBRL, fmtDateTime, fmtQty } from '../lib/format';
import { materialsQuery } from '../lib/listing';
import { MaterialForm, emptyMaterial, valuesFromMaterial } from './MaterialForm';
import { DataTable, Pager, useDebounced, useLoad, yesNo, type Column } from '../ui';

interface Material {
  id: string; code: string; shortDescription: string; technicalDescription?: string | null; category: string; subcategory?: string | null;
  type: string; status: string; stockUom: { code: string; name: string };
  lotControlled: boolean; expiryControlled: boolean; serialControlled: boolean; assetTagged: boolean; requiresCa: boolean; requiresCalibration: boolean;
  hasSizeGrid: boolean; returnable: boolean; repairable: boolean; disposable: boolean; exitMethod: string; criticality: string; riskClass?: string | null;
  storageCondition?: string | null; manufacturer?: string | null; brand?: string | null; model?: string | null; leadTimeDays?: number | null;
  // Só chegam para quem tem `material:read_cost`; o backend remove os campos dos demais.
  averageCost?: string | null; lastCost?: string | null;
}
interface Page<T> { total: number; page: number; pageSize: number; items: T[] }
interface Availability { physical: string; reserved: string; blocked: string; available: string; stock_unit: string }
interface Version { id: string; version: number; createdAt?: string }

const TYPES = ['CONSUMO', 'FERRAMENTA', 'EQUIPAMENTO', 'ATIVO', 'EMBALAGEM', 'QUIMICO', 'EPI', 'EPC', 'SOBRESSALENTE'];
const TYPE_LABEL: Record<string, string> = { CONSUMO: 'Consumo', FERRAMENTA: 'Ferramenta', EQUIPAMENTO: 'Equipamento', ATIVO: 'Ativo', EMBALAGEM: 'Embalagem', QUIMICO: 'Químico', EPI: 'EPI', EPC: 'EPC', SOBRESSALENTE: 'Sobressalente' };
const STATUS_LABEL: Record<string, string> = { ATIVO: 'Ativo', INATIVO: 'Inativo', SUBSTITUIDO: 'Substituído' };

const flags = (m: Material) => [m.lotControlled && 'Lote', m.expiryControlled && 'Validade', m.serialControlled && 'Série', m.assetTagged && 'Patrimônio', m.requiresCa && 'CA', m.requiresCalibration && 'Calibração', m.hasSizeGrid && 'Grade', m.returnable && 'Retornável'].filter(Boolean) as string[];

export function Catalog({ warehouseId, canWrite = false, canReadCost = false }: { warehouseId?: string; canWrite?: boolean; canReadCost?: boolean }) {
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('ATIVO');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Material | null>(null);
  const dq = useDebounced(q.trim());
  const [cats] = useLoad(() => call<Array<{ category: string }>>('/material-categories'), []);
  const [res, reload] = useLoad(() => {
    return call<Page<Material>>(`/materials?${materialsQuery({ page, pageSize: 20, status, q: dq, type, category })}`);
  }, [dq, type, category, status, page]);

  if (creating) return <section><button className="btn ghost" onClick={() => setCreating(false)}>← Catálogo</button><MaterialForm mode="create" initial={emptyMaterial()} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} /></section>;
  if (sel) return <MaterialDetail m={sel} warehouseId={warehouseId} canWrite={canWrite} canReadCost={canReadCost} onBack={() => { setSel(null); reload(); }} />;
  const cols: Column<Material>[] = [
    { key: 'code', header: 'Código', render: (m) => <strong>{m.code}</strong> },
    { key: 'desc', header: 'Descrição', render: (m) => m.shortDescription },
    { key: 'type', header: 'Tipo', render: (m) => TYPE_LABEL[m.type] ?? m.type },
    { key: 'cat', header: 'Categoria', render: (m) => m.category },
    { key: 'uom', header: 'Un.', render: (m) => m.stockUom.code },
    // O custo é o mesmo valor que o Axis usa na alçada de aprovação da requisição.
    ...(canReadCost ? [{ key: 'cost', header: 'Último custo', render: (m: Material) => fmtBRL(m.lastCost) }] : []),
    { key: 'ctl', header: 'Controles', render: (m) => flags(m).map((f) => <span key={f} className="pill">{f}</span>) },
    { key: 'st', header: 'Situação', render: (m) => <span className={`pill ${m.status === 'ATIVO' ? 'ok' : 'warn'}`}>{STATUS_LABEL[m.status] ?? m.status}</span> },
  ];
  const categories = cats.state === 'ready' ? [...new Set(cats.data.map((c) => c.category))] : [];
  const data = res.state === 'ready' ? res.data : null;
  return (
    <section>
      <h1>Catálogo de materiais</h1>
      {canWrite && <div className="toolbar"><button className="btn" onClick={() => setCreating(true)}>Novo material</button></div>}
      <form className="toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Buscar<input className="inp" placeholder="Código, descrição ou código de barras" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field">Tipo<select className="inp" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">Todos</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
        <label className="field">Categoria<select className="inp" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">Todas</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Situação<select className="inp" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button type="button" className="btn ghost" onClick={() => { setQ(''); setType(''); setCategory(''); setStatus('ATIVO'); setPage(1); }}>Limpar filtros</button>
      </form>
      <DataTable cols={cols} rows={data?.items ?? []} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} onRow={setSel} rowKey={(m) => m.id} empty={dq || type || category ? 'Nenhum material encontrado para estes filtros.' : 'Nenhum material cadastrado.'} />
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </section>
  );
}

function MaterialDetail({ m: initial, warehouseId, canWrite, canReadCost, onBack }: { m: Material; warehouseId?: string; canWrite: boolean; canReadCost: boolean; onBack: () => void }) {
  const [m, setM] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [vTick, setVTick] = useState(0);
  const [av] = useLoad(() => call<Availability>(`/materials/${m.id}/availability${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`), [m.id, warehouseId]);
  const [vers] = useLoad(() => call<Version[]>(`/materials/${m.id}/versions`), [m.id, vTick]);
  const [del] = useLoad(() => (canWrite ? call<{ deletable: boolean; reason?: string }>(`/materials/${m.id}/deletable`) : Promise.resolve({ deletable: false, reason: undefined as string | undefined })), [m.id, canWrite]);
  const [actErr, setActErr] = useState('');
  const act = async (kind: 'delete' | 'deactivate') => {
    const msg = kind === 'delete' ? 'Excluir este material definitivamente? Ele nunca teve movimentação; a exclusão não pode ser desfeita.' : 'Inativar este material? Ele deixa de aparecer nas listas, mas o histórico é mantido.';
    if (!window.confirm(msg)) return;
    setActErr('');
    try {
      if (kind === 'delete') await call(`/materials/${m.id}`, { method: 'DELETE' }); else await call(`/materials/${m.id}/deactivate`, { method: 'POST', body: '{}' });
      onBack();
    } catch (e) { setActErr((e as Error).message); }
  };
  const kv = (k: string, v: React.ReactNode) => <div><dt>{k}</dt><dd>{v || '—'}</dd></div>;
  return (
    <section>
      <button className="btn ghost" onClick={onBack}>← Catálogo</button>
      {canWrite && !editing && m.status === 'ATIVO' && <button className="btn" onClick={() => setEditing(true)}>Editar material</button>}
      {canWrite && !editing && m.status === 'ATIVO' && del.state === 'ready' && (del.data.deletable
        ? <button className="btn ghost" onClick={() => void act('delete')}>Excluir</button>
        : <button className="btn ghost" onClick={() => void act('deactivate')} title={del.data.reason}>Inativar</button>)}
      {actErr && <p className="err" role="alert">{actErr}</p>}
      {editing && <MaterialForm mode="edit" materialId={m.id} initial={valuesFromMaterial(m as never)} onCancel={() => setEditing(false)} onSaved={(saved) => { setM({ ...m, ...(saved as object) } as Material); setEditing(false); setVTick((n) => n + 1); }} />}
      <h1>{m.code} — {m.shortDescription}</h1>
      {m.technicalDescription && <p className="hint">{m.technicalDescription}</p>}
      <div className="card">
        <h3>Disponibilidade{warehouseId ? ' neste almoxarifado' : ''}</h3>
        {av.state === 'loading' && <div className="skeleton" />}
        {av.state === 'error' && <p className="err" role="alert">{av.message}</p>}
        {av.state === 'ready' && <dl className="kv">{kv('Físico', `${fmtQty(av.data.physical)} ${av.data.stock_unit}`)}{kv('Reservado', fmtQty(av.data.reserved))}{kv('Bloqueado', fmtQty(av.data.blocked))}{kv('Disponível', <strong>{fmtQty(av.data.available)}</strong>)}</dl>}
      </div>
      <div className="card">
        <h3>Cadastro</h3>
        <dl className="kv">
          {kv('Tipo', TYPE_LABEL[m.type] ?? m.type)}{kv('Categoria', [m.category, m.subcategory].filter(Boolean).join(' / '))}{kv('Unidade de estoque', `${m.stockUom.code} — ${m.stockUom.name}`)}
          {kv('Situação', STATUS_LABEL[m.status] ?? m.status)}{kv('Método de saída', m.exitMethod)}{kv('Criticidade', m.criticality)}
          {kv('Fabricante', m.manufacturer)}{kv('Marca / modelo', [m.brand, m.model].filter(Boolean).join(' / '))}{kv('Prazo de reposição', m.leadTimeDays != null ? `${m.leadTimeDays} dia(s)` : null)}
          {kv('Armazenagem', m.storageCondition)}{kv('Classe de risco', m.riskClass)}
          {kv('Lote', yesNo(m.lotControlled))}{kv('Validade', yesNo(m.expiryControlled))}{kv('Número de série', yesNo(m.serialControlled))}{kv('Patrimônio', yesNo(m.assetTagged))}
          {kv('Exige CA', yesNo(m.requiresCa))}{kv('Exige calibração', yesNo(m.requiresCalibration))}{kv('Retornável', yesNo(m.returnable))}{kv('Descartável', yesNo(m.disposable))}
          {canReadCost && <>{kv('Último custo', fmtBRL(m.lastCost))}{kv('Custo médio', fmtBRL(m.averageCost))}</>}
        </dl>
      </div>
      <div className="card">
        <h3>Histórico de versões</h3>
        {vers.state === 'loading' && <div className="skeleton" />}
        {vers.state === 'error' && <p className="err" role="alert">{vers.message}</p>}
        {vers.state === 'ready' && (vers.data.length === 0 ? <p className="hint">Sem versões registradas.</p> : vers.data.map((v) => <div key={v.id} className="line">Versão {v.version}{v.createdAt ? ` · ${fmtDateTime(v.createdAt)}` : ''}</div>))}
      </div>
    </section>
  );
}

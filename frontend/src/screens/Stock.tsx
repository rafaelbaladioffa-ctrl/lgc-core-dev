import { useMemo, useState } from 'react';
import { call } from '../lib/api';
import { fmtQty } from '../lib/format';
import { allMaterials } from '../lib/lookups';
import { DataTable, Pager, useLoad, type Column } from '../ui';

interface Balance { materialId: string; locationId: string; locationCode: string; lotId: string | null; lotNumber: string | null; condition: string; ownership: string; quantity: string; reserved: string; available: string }
interface Page<T> { total: number; page: number; pageSize: number; items: T[] }
const COND: Record<string, string> = { DISPONIVEL: 'Disponível', QUARENTENA: 'Quarentena', BLOQUEADO: 'Bloqueado', AVARIADO: 'Avariado' };
const OWN: Record<string, string> = { PROPRIO: 'Próprio', CLIENTE: 'De cliente' };

export function Stock({ warehouseId }: { warehouseId: string }) {
  const [cond, setCond] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [mats] = useLoad(allMaterials, []);
  const byId = useMemo(() => new Map((mats.state === 'ready' ? mats.data : []).map((m) => [m.id, m])), [mats]);
  const [res, reload] = useLoad(() => {
    const p = new URLSearchParams({ page: '1', pageSize: '200' });
    if (cond) p.set('condition', cond);
    return call<Page<Balance>>(`/warehouses/${warehouseId}/stock?${p}`);
  }, [warehouseId, cond]);

  const all = res.state === 'ready' ? res.data.items : [];
  const term = q.trim().toLowerCase();
  const rows = term ? all.filter((b) => { const m = byId.get(b.materialId); return `${m?.code ?? ''} ${m?.shortDescription ?? ''} ${b.locationCode} ${b.lotNumber ?? ''}`.toLowerCase().includes(term); }) : all;
  const size = 20;
  const shown = rows.slice((page - 1) * size, page * size);
  const cols: Column<Balance>[] = [
    { key: 'mat', header: 'Material', render: (b) => { const m = byId.get(b.materialId); return m ? <><strong>{m.code}</strong> — {m.shortDescription}</> : b.materialId; } },
    { key: 'loc', header: 'Endereço', render: (b) => b.locationCode },
    { key: 'lot', header: 'Lote', render: (b) => b.lotNumber ?? '—' },
    { key: 'cond', header: 'Condição', render: (b) => <span className={`pill ${b.condition === 'DISPONIVEL' ? 'ok' : 'warn'}`}>{COND[b.condition] ?? b.condition}</span> },
    { key: 'own', header: 'Propriedade', render: (b) => OWN[b.ownership] ?? b.ownership },
    { key: 'qty', header: 'Quantidade', num: true, render: (b) => `${fmtQty(b.quantity)} ${byId.get(b.materialId)?.stockUom.code ?? ''}` },
    { key: 'res', header: 'Reservado', num: true, render: (b) => fmtQty(b.reserved) },
    { key: 'av', header: 'Disponível', num: true, render: (b) => <strong>{fmtQty(b.available)}</strong> },
  ];
  return (
    <section>
      <h2>Estoque do almoxarifado</h2>
      <form className="toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Buscar<input className="inp" placeholder="Material, endereço ou lote" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field">Condição<select className="inp" value={cond} onChange={(e) => { setCond(e.target.value); setPage(1); }}><option value="">Todas</option>{Object.entries(COND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button type="button" className="btn ghost" onClick={() => { setQ(''); setCond(''); setPage(1); }}>Limpar filtros</button>
      </form>
      <DataTable cols={cols} rows={shown} state={res.state} error={res.state === 'error' ? res.message : undefined} onRetry={reload} rowKey={(b) => `${b.locationId}|${b.materialId}|${b.lotId}|${b.condition}|${b.ownership}`} empty={term || cond ? 'Nenhum saldo para estes filtros.' : 'Nenhum saldo neste almoxarifado.'} />
      {res.state === 'ready' && <Pager page={page} pageSize={size} total={rows.length} onPage={setPage} />}
      {res.state === 'ready' && res.data.total > all.length && <p className="hint">Mostrando os primeiros {all.length} de {res.data.total} saldos; use os filtros para refinar.</p>}
    </section>
  );
}

import { call, type Warehouse } from './api';

export interface Mat { id: string; code: string; shortDescription: string; stockUom: { code: string } }
interface Page<T> { total: number; items: T[] }

/** Materiais (poucas centenas) para trocar ids por código e descrição nas listagens. */
export async function allMaterials(): Promise<Mat[]> {
  const out: Mat[] = [];
  for (let p = 1; p <= 50; p++) {
    const r = await call<Page<Mat>>(`/materials?page=${p}&pageSize=100&status=ATIVO`);
    out.push(...r.items);
    if (out.length >= r.total || r.items.length === 0) break;
  }
  return out;
}

export const allWarehouses = () => call<Warehouse[]>('/warehouses');

export const matLabel = (m: Map<string, Mat>, id: string) => { const x = m.get(id); return x ? `${x.code} — ${x.shortDescription}` : id; };
export const whLabel = (w: Map<string, Warehouse>, id: string) => { const x = w.get(id); return x ? `${x.code} — ${x.name}` : id; };

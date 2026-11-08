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

/** Cadastros do Core guardados no cache da Logística (`GET /axis/lookup`). O Core é o dono; aqui só se escolhe e se mostra. */
export type AxisKind = 'PROJECT' | 'COST_CENTER' | 'COLLABORATOR' | 'USER' | 'SITE' | 'CLIENT';
export interface AxisItem { kind: AxisKind; id: string; code: string | null; name: string | null; active: boolean }

/** Pessoa do Core: o id pode ser de colaborador (destinatário/custodiante vindos do Core) ou de usuário (quem usou o sistema). */
export const PERSON: AxisKind[] = ['COLLABORATOR', 'USER'];

/** Busca para seletores (só ativos, por nome ou código). */
export const searchAxis = (kinds: AxisKind[], search: string, limit = 20) =>
  call<{ items: AxisItem[] }>(`/axis/lookup?${new URLSearchParams({ kind: kinds.join(','), ...(search.trim() ? { search: search.trim() } : {}), limit: String(limit) })}`).then((r) => r.items);

/** Resolve ids em nomes (inclui inativos); até 200 ids por chamada, em lotes. */
export async function resolveAxis(kinds: AxisKind[], ids: Array<string | null | undefined>): Promise<AxisItem[]> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const out: AxisItem[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const r = await call<{ items: AxisItem[] }>(`/axis/lookup?${new URLSearchParams({ kind: kinds.join(','), ids: unique.slice(i, i + 200).join(',') })}`);
    out.push(...r.items);
  }
  return out;
}

/** "CÓDIGO — Nome", só o nome ou só o código; marca inativo. */
export const axisItemLabel = (x: Pick<AxisItem, 'code' | 'name' | 'active'>) => {
  const base = x.code && x.name ? `${x.code} — ${x.name}` : (x.name ?? x.code ?? '');
  return x.active ? base : `${base} (inativo)`;
};

/** Nome de um id pelo mapa resolvido; sem cadastro no cache, o id encurtado (o cache pode ainda não ter recebido o evento). */
export const axisName = (m: Map<string, AxisItem>, id: string | null | undefined) => {
  if (!id) return '—';
  const x = m.get(id);
  return x ? axisItemLabel(x) : `${id.slice(0, 8)}… (não sincronizado)`;
};

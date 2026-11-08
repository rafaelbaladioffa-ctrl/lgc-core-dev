import { api } from './api';

/**
 * Cadastros do Core vistos pelo Financeiro (cache alimentado pelos eventos do Core). A tela escolhe daqui, não
 * digita (mapa-interoperabilidade §1, regra 4). `GET /master-data/:kind`.
 */
export type MasterKind = 'sites' | 'clients' | 'projects' | 'cost-centers' | 'collaborators' | 'job-titles' | 'holidays';

export interface MasterItem {
  axisId: string;
  code: string | null;
  name: string | null;
  active: boolean;
  /** Texto pronto para mostrar (ex.: "GRU53 — Prédio 53, Guarulhos/SP"). */
  label: string;
  info: Record<string, string | boolean | null>;
}

export const MIN_MASTER_SEARCH = 2;

/** Monta a consulta: `ids` traz os já escolhidos (mesmo inativos); senão busca por código ou nome. */
export function masterQuery(opts: { search?: string; ids?: string[]; includeInactive?: boolean; limit?: number }): string {
  const q = new URLSearchParams();
  if (opts.ids && opts.ids.length) q.set('ids', opts.ids.join(','));
  else {
    const term = (opts.search ?? '').trim();
    if (term) q.set('search', term);
    if (opts.includeInactive) q.set('includeInactive', 'true');
    if (opts.limit) q.set('limit', String(opts.limit));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const lookupMaster = (kind: MasterKind, opts: { search?: string; ids?: string[]; includeInactive?: boolean; limit?: number } = {}) =>
  api<MasterItem[]>(`/master-data/${kind}${masterQuery(opts)}`);

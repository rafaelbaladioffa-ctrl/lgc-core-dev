import type { CableLineProfile } from './bid-plan.js';

/**
 * Sugestão da linha do Bid Template para cada tipo de cabo da SOW (pedido do dono em 2026-11-08: a cotação já
 * nasce com os cabos escolhidos; o orçamentista só troca se precisar). O mapeamento salvo no perfil da Bid
 * sempre vence a sugestão.
 *
 * Fibra: mesmo número de fibras e mesmas pontas (LC, MPO, SC, SN, MMC) na descrição da linha; entre as que
 * casam, prefere monomodo, amarelo, linha que já vem com fornecedor, o fornecedor mais usado no perfil e, por
 * fim, a primeira linha do modelo. Cobre (Cat6): a linha livre de cobre, como a LGC preenche (cabo da AWS,
 * só instalação).
 */

export interface TemplateLine {
  row: number;
  code: string;
  description: string;
  category: string;
  subcategory: string;
  supplier: string | null;
}

export interface SuggestedLine extends CableLineProfile {
  /** Explicação curta para a tela ("8F, MPO/LC, monomodo, AFL"). */
  reason: string;
}

const CONNECTORS = ['MMC', 'MPO', 'MTP', 'SN', 'LC', 'SC'] as const;

/** Ponta normalizada: MTP = MPO; "4LC" (leque de LC) = LC. */
function connector(text: string): string | null {
  const t = text.toUpperCase().replace(/^\d+/, '');
  const hit = CONNECTORS.find((c) => t.startsWith(c));
  return hit === 'MTP' ? 'MPO' : (hit ?? null);
}

/** "8F 4LC-MPO" → { fibers: 8, ends: "LC|MPO" }; tipo que não é fibra → null. */
export function sowFiberKey(type: string): { fibers: number; ends: string } | null {
  const m = type.match(/^(\d+)F\s+([A-Z0-9]+)-([A-Z0-9]+)$/i);
  if (!m) return null;
  const a = connector(m[2]);
  const b = connector(m[3]);
  if (!a || !b) return null;
  return { fibers: Number(m[1]), ends: [a, b].sort().join('|') };
}

/** "8F SM Microcable, LSZH, Yellow, MPO Female/LC Uniboot, …" → { fibers: 8, ends: "LC|MPO", sm, yellow }. */
export function lineFiberKey(description: string): { fibers: number; ends: string; singleMode: boolean; yellow: boolean } | null {
  const fibers = description.match(/^\s*(\d+)F\b/i);
  if (!fibers) return null;
  const pair = description
    .split(',')
    .map((p) => p.trim())
    .map((p) => p.match(/^([A-Za-z0-9]+)[^/]*\/\s*([A-Za-z0-9]+)/))
    .find((m) => m && connector(m[1]) && connector(m[2]));
  if (!pair) return null;
  return {
    fibers: Number(fibers[1]),
    ends: [connector(pair[1])!, connector(pair[2])!].sort().join('|'),
    singleMode: /\bSM\b/i.test(description),
    yellow: /\byellow\b/i.test(description),
  };
}

const hasSupplier = (s: string | null) => !!s && s.trim() !== '' && s.trim().toLowerCase() !== 'select';

export function suggestCableLine(
  sowType: string,
  kind: 'fibra' | 'cobre' | 'outro',
  lines: TemplateLine[],
  preferredSuppliers: string[] = [],
): SuggestedLine | null {
  if (kind === 'cobre') {
    const free = lines.find((l) => l.code === 'free_copper_cables');
    if (!free) return null;
    return { code: free.code, description: 'Cat6 UTP Cable, field-terminated', supplier: 'AWS Internal', partNumber: 'CAT6-UTP-XXXM', unit: 'm', reason: 'linha livre de cobre (cabo da AWS, só instalação)' };
  }
  const key = sowFiberKey(sowType);
  if (kind !== 'fibra' || !key) return null;
  const rank = (s: string | null) => {
    const i = preferredSuppliers.findIndex((p) => p.toLowerCase() === (s ?? '').trim().toLowerCase());
    return i < 0 ? 0 : preferredSuppliers.length - i;
  };
  const scored = lines
    .filter((l) => l.category === 'Fiber' && !l.code.startsWith('free_'))
    .map((l) => ({ l, k: lineFiberKey(l.description) }))
    .filter((x) => x.k && x.k.fibers === key.fibers && x.k.ends === key.ends)
    .map((x) => ({ ...x, score: (x.k!.singleMode ? 8 : 0) + (x.k!.yellow ? 4 : 0) + (hasSupplier(x.l.supplier) ? 2 : 0) + rank(x.l.supplier) / 100 }))
    .sort((a, b) => b.score - a.score || a.l.row - b.l.row);
  const best = scored[0];
  if (!best) return null;
  const supplier = hasSupplier(best.l.supplier) ? best.l.supplier : (preferredSuppliers[0] ?? null);
  return {
    code: best.l.code,
    supplier: hasSupplier(best.l.supplier) ? null : supplier,
    reason: [`${key.fibers}F`, key.ends.replace('|', '/'), best.k!.singleMode ? 'monomodo' : null, best.k!.yellow ? 'amarelo' : null, hasSupplier(best.l.supplier) ? best.l.supplier : supplier].filter(Boolean).join(', '),
  };
}

/** Fornecedores das linhas já mapeadas no perfil, do mais usado para o menos usado. */
export function preferredSuppliers(profileCodes: string[], lines: TemplateLine[]): string[] {
  const count = new Map<string, number>();
  for (const code of profileCodes) {
    const supplier = lines.find((l) => l.code === code && hasSupplier(l.supplier))?.supplier;
    if (supplier) count.set(supplier, (count.get(supplier) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

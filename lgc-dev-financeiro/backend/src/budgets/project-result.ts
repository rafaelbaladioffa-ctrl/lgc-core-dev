import { D, ZERO, money, sum, type Dec } from '../cost-centers/cc-engine.js';
import { RESULT_GROUPS, type GroupKey } from './project-groups.js';

/**
 * Resultado do projeto (PA-16): cotado × comprometido × realizado por grupo de custo, lendo **só** os
 * `cc_entries` do projeto (nada de livro paralelo) e, para o cotado, a revisão ganha.
 *
 * Regra de comprometido × realizado (sem estorno, centros-de-custo-especificacao §5):
 *  - `committed`: o orçado que a revisão ganha comprometeu (lançamentos de origem `projeto`);
 *  - `realized`: o que já foi realizado no projeto no grupo (compras recebidas, consumo da Logística, reembolsos…);
 *  - `committedNet = max(0, committed − realized)`: o que ainda resta do comprometido;
 *  - `openCommitments`: compras e adiantamentos aprovados e ainda não realizados (o CC já os baixa ao realizar);
 *  - `balance = committed − realized − openCommitments`: saldo a gastar do orçado (negativo = acima do orçado).
 */

export interface EntrySum {
  kind: 'receita' | 'custo';
  stage: 'comprometido' | 'realizado';
  category: string;
  source: string;
  amount: Dec | string | number | null;
}

export interface QuotedBaseline {
  revisionId: string;
  revisionNumber: number;
  revenue: Dec | string | number | null;
  /** `result.groups[].cost` da revisão ganha. */
  groups: Array<{ key: string; cost: string }>;
}

const dec = (v: Dec | string | number | null | undefined) => new D(v ?? 0);
const positive = (v: Dec) => D.max(ZERO, v);

export function buildProjectResult(baseline: QuotedBaseline | null, rows: EntrySum[], withCost: boolean) {
  const pick = (f: (r: EntrySum) => boolean) => sum(rows.filter(f).map((r) => dec(r.amount)));

  const revCommitted = pick((r) => r.kind === 'receita' && r.stage === 'comprometido');
  const revRealized = pick((r) => r.kind === 'receita' && r.stage === 'realizado');
  const revenue = {
    quoted: baseline ? money(dec(baseline.revenue)) : null,
    committed: money(revCommitted),
    realized: money(revRealized),
    /** Contratado ainda não faturado. */
    pending: money(positive(revCommitted.minus(revRealized))),
  };

  const groups = RESULT_GROUPS.map((g) => {
    const inGroup = (r: EntrySum) => r.kind === 'custo' && (g.categories as readonly string[]).includes(r.category);
    const quoted = baseline ? dec(baseline.groups.find((x) => x.key === (g.key as GroupKey))?.cost) : null;
    const committed = pick((r) => inGroup(r) && r.stage === 'comprometido' && r.source === 'projeto');
    const open = pick((r) => inGroup(r) && r.stage === 'comprometido' && r.source !== 'projeto');
    const realized = pick((r) => inGroup(r) && r.stage === 'realizado');
    return { key: g.key, label: g.label, quoted, committed, openCommitments: open, realized };
  });
  const present = (g: { quoted: Dec | null; committed: Dec; openCommitments: Dec; realized: Dec }) => ({
    quoted: g.quoted ? money(g.quoted) : null,
    committed: money(g.committed),
    realized: money(g.realized),
    openCommitments: money(g.openCommitments),
    committedNet: money(positive(g.committed.minus(g.realized))),
    balance: money(g.committed.minus(g.realized).minus(g.openCommitments)),
  });
  const total = {
    quoted: baseline ? sum(groups.map((g) => g.quoted ?? ZERO)) : null,
    committed: sum(groups.map((g) => g.committed)),
    openCommitments: sum(groups.map((g) => g.openCommitments)),
    realized: sum(groups.map((g) => g.realized)),
  };

  const costs = {
    groups: groups.map((g) => ({ key: g.key, label: g.label, ...present(g) })),
    total: present(total),
  };
  // Resultado direto: receita − custos diretos (sem impostos nem indiretos, que não são lançados no CC).
  const result = {
    quoted: baseline && total.quoted ? money(dec(baseline.revenue).minus(total.quoted)) : null,
    committed: money(revCommitted.minus(total.committed)),
    realized: money(revRealized.minus(total.realized)),
  };
  return { revenue, ...(withCost ? { costs, result } : {}) };
}

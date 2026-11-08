import type { Prisma } from '@prisma/client';

/**
 * Leituras do cache de mestres do Core (`axis_master_cache`) compartilhadas pelos módulos. O cache é a cópia local
 * dos cadastros do Core (mapa-interoperabilidade §1): o Financeiro guarda o id do Core e escolhe a partir daqui.
 */

export const MASTER_KINDS = ['USER', 'COLLABORATOR', 'CLIENT', 'PROJECT', 'COST_CENTER', 'SITE', 'JOB_TITLE', 'HOLIDAY'] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];

type CacheReader = Pick<Prisma.TransactionClient, 'axisMasterCache'>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Feriados ativos do Core (`holiday.*`), como datas `AAAA-MM-DD`. `null` quando o cache nunca recebeu um feriado
 * (o Core ainda não enviou o calendário): quem calcula dias úteis avisa que contou só segunda a sexta.
 * A data fica em `code` (e em `data.date`); feriado excluído no Core chega com `active: false` e não conta.
 */
export async function holidaySet(db: CacheReader, range?: { from?: string | null; to?: string | null }): Promise<Set<string> | null> {
  const rows = await db.axisMasterCache.findMany({ where: { kind: 'HOLIDAY' }, select: { code: true, active: true, data: true } });
  if (rows.length === 0) return null;
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.active) continue;
    const raw = r.code ?? (r.data as Record<string, unknown> | null)?.['date'];
    const date = typeof raw === 'string' ? raw.slice(0, 10) : null;
    if (!date || !DATE_ONLY.test(date)) continue;
    if (range?.from && date < range.from) continue;
    if (range?.to && date > range.to) continue;
    out.add(date);
  }
  return out;
}

/**
 * Dos ids informados, os que **não** estão no cache do tipo pedido (F5: id do Core gravado sem conferir). Não
 * bloqueia nada: quem chama decide se avisa, registra pendência ou só registra no log.
 */
export async function missingFromCache(db: CacheReader, kind: MasterKind, ids: Iterable<string | null | undefined>): Promise<string[]> {
  const list = [...new Set([...ids].filter((v): v is string => typeof v === 'string' && v !== ''))];
  if (list.length === 0) return [];
  const rows = await db.axisMasterCache.findMany({ where: { kind, axisId: { in: list } }, select: { axisId: true } });
  const found = new Set(rows.map((r) => r.axisId));
  return list.filter((id) => !found.has(id));
}

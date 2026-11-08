import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { problem } from './errors.js';

/**
 * Leitura do `axis_master_cache` (cadastros do Core: docs/mapa-interoperabilidade.md §1). O Core é o dono; a Logística guarda o id
 * do Core e mostra/valida pelo cache, alimentado pelos eventos do webhook.
 */

type CacheReader = { axisMasterCache: Prisma.TransactionClient['axisMasterCache'] };

/** Tipos de cadastro do Core que a Logística guarda e expõe aos seletores. */
export const AXIS_KINDS = ['PROJECT', 'COST_CENTER', 'COLLABORATOR', 'USER', 'SITE', 'CLIENT'] as const;
export type AxisKind = (typeof AXIS_KINDS)[number];

/** Pessoa do Core: o id pode ser de colaborador (`recipient_id` do Core) ou de usuário (`sub` do token). */
export const PERSON_KINDS: AxisKind[] = ['COLLABORATOR', 'USER'];

/** Rótulo legível de um registro do cache: "CÓDIGO — Nome", só o nome, só o código ou, sem nada, o próprio id. */
export const cacheLabel = (row: { axisId: string; code: string | null; name: string | null } | undefined | null, fallback: string) =>
  !row ? fallback : row.code && row.name ? `${row.code} — ${row.name}` : (row.name ?? row.code ?? fallback);

/**
 * Nomes de vários ids do Core de uma vez (telas e documentos). Ids sem cadastro no cache voltam com o próprio id.
 * Quando um id existe em mais de um tipo (pessoa), vale a ordem de `kinds`.
 */
export async function axisLabels(db: CacheReader, kinds: AxisKind[], ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const rows = await db.axisMasterCache.findMany({ where: { kind: { in: kinds }, axisId: { in: wanted } }, select: { kind: true, axisId: true, code: true, name: true } });
  const rank = (k: string) => kinds.indexOf(k as AxisKind);
  for (const r of [...rows].sort((a, b) => rank(b.kind) - rank(a.kind))) out.set(r.axisId, cacheLabel(r, r.axisId));
  return out;
}

/** Rótulo de um só id (ou '—' quando não há id). */
export async function axisLabel(db: CacheReader, kinds: AxisKind[], id: string | null | undefined): Promise<string> {
  if (!id) return '—';
  return (await axisLabels(db, kinds, [id])).get(id) ?? id;
}

/** Referência a um cadastro do Core numa escrita, com o que fazer quando ele está inativo. */
export interface AxisRef {
  id: string | null | undefined;
  kinds: AxisKind[];
  /** Nome do campo para a mensagem ("Projeto", "Responsável"…). */
  label: string;
  /** `block`: 422 com AXIS_REFERENCE_INVALID; `warn`: só aviso. Ausente no cache é sempre aviso. */
  onInactive: 'block' | 'warn';
}

/**
 * Regra 5 do mapa de interoperabilidade: id do Core é conferido contra o cache na escrita.
 *  - ausente do cache → aviso (o cadastro pode estar em trânsito ou o cache ainda vazio), nunca bloqueia;
 *  - inativo → 422 (`block`) ou aviso (`warn`), conforme a regra do fluxo.
 * Devolve os avisos em português, para gravar no registro ou no log.
 */
export async function checkAxisRefs(db: CacheReader, refs: AxisRef[]): Promise<string[]> {
  const warnings: string[] = [];
  for (const ref of refs) {
    if (!ref.id) continue;
    const row = await db.axisMasterCache.findFirst({ where: { axisId: ref.id, kind: { in: ref.kinds } }, orderBy: { syncedAt: 'desc' } });
    if (!row) {
      warnings.push(`${ref.label} ${ref.id} ainda não sincronizado do Axis.`);
      continue;
    }
    if (row.active) continue;
    const what = `${ref.label} ${cacheLabel(row, ref.id)}`;
    if (ref.onInactive === 'block') {
      throw new UnprocessableEntityException(problem(`${what} está inativo(a) no Axis: escolha um cadastro ativo.`, 'AXIS_REFERENCE_INVALID'));
    }
    warnings.push(`${what} está inativo(a) no Axis.`);
  }
  return warnings;
}

/**
 * Ids que representam a mesma pessoa do token: o usuário (`sub`), o colaborador do token e o colaborador ligado ao usuário no
 * cache `USER` (`collaborator_id` do evento `user.*`). O Core manda destinatário/custodiante como id de colaborador; o token pode
 * não trazer o colaborador (sessão antiga), então o cache completa.
 */
export async function resolveOwnIds(db: CacheReader, user: { userId: string; collaboratorId: string | null }): Promise<string[]> {
  const ids = new Set([user.userId, user.collaboratorId].filter((id): id is string => !!id));
  const cached = await db.axisMasterCache.findFirst({ where: { kind: 'USER', axisId: user.userId }, select: { data: true } });
  const linked = (cached?.data as Record<string, unknown> | undefined)?.['collaborator_id'];
  if (typeof linked === 'string' && linked) ids.add(linked);
  return [...ids];
}

/**
 * Id de quem fica com a custódia: o Core identifica pessoas por colaborador. Se o recebedor informado é um usuário do Core ligado
 * a um colaborador (cache `USER`), grava o colaborador; caso contrário, grava o id como veio.
 */
export async function custodianIdFor(db: CacheReader, receiverAxisId: string): Promise<string> {
  const user = await db.axisMasterCache.findFirst({ where: { kind: 'USER', axisId: receiverAxisId }, select: { data: true } });
  const linked = (user?.data as Record<string, unknown> | undefined)?.['collaborator_id'];
  return typeof linked === 'string' && linked ? linked : receiverAxisId;
}

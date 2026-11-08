import { BadRequestException, Controller, ForbiddenException, Get, Injectable, Param, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequireAnyPermission } from '../rbac/permissions.decorator.js';
import type { MasterKind } from './master-cache.js';

/** Tipo na URL → tipo do cache. Usuário (e-mail) não é exposto aqui. */
export const LOOKUP_KINDS: Record<string, Exclude<MasterKind, 'USER'>> = {
  sites: 'SITE',
  clients: 'CLIENT',
  projects: 'PROJECT',
  'cost-centers': 'COST_CENTER',
  collaborators: 'COLLABORATOR',
  'job-titles': 'JOB_TITLE',
  holidays: 'HOLIDAY',
};

/** Quem consulta o Financeiro escolhe site, cliente, projeto, cargo e feriado; CC e colaborador só quem vê todos os CCs. */
const READ_ANY = ['budget:read', 'budget_params:read', 'cost_center:read', 'cost_center:read_own'];
const RESTRICTED: Partial<Record<MasterKind, string>> = { COST_CENTER: 'cost_center:read', COLLABORATOR: 'cost_center:read' };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_IDS = 100;

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export interface MasterItem {
  axisId: string;
  code: string | null;
  name: string | null;
  active: boolean;
  /** Texto pronto para o seletor (ex.: "GRU53 — Prédio 53, Guarulhos/SP"). */
  label: string;
  info: Record<string, string | boolean | null>;
}

/** Linha do cache → item do seletor, com o que cada tipo precisa mostrar. Função pura (testável). */
export function presentMaster(kind: MasterKind, row: { axisId: string; code: string | null; name: string | null; active: boolean; data: unknown }): MasterItem {
  const d = (row.data ?? {}) as Record<string, unknown>;
  const head = [row.code, row.name].filter(Boolean).join(' — ') || row.axisId;
  let info: MasterItem['info'] = {};
  let label = head;
  switch (kind) {
    case 'SITE': {
      const city = text(d['address_city']);
      const state = text(d['address_state']);
      const place = [city, state].filter(Boolean).join('/');
      info = { clientId: text(d['client_id']), city, state };
      label = place ? `${head}, ${place}` : head;
      break;
    }
    case 'CLIENT':
      info = { tradeName: text(d['trade_name']), cnpj: text(d['cnpj']) };
      break;
    case 'PROJECT':
      info = { status: text(d['status']), clientId: text(d['client_id']), costCenterId: text(d['cost_center_id']), siteId: text(d['site_id']) };
      break;
    case 'COST_CENTER':
      info = { shortCode: text(d['short_code']), kind: text(d['kind']), parentId: text(d['parent_cost_center_id']) };
      break;
    case 'COLLABORATOR':
      info = { jobTitleId: text(d['job_title_id']), jobTitleName: text(d['job_title_name']), costCenterId: text(d['cost_center_id']), status: text(d['status']) };
      break;
    case 'JOB_TITLE':
      info = { isTechnician: typeof d['is_technician'] === 'boolean' ? (d['is_technician'] as boolean) : null };
      label = row.name ?? row.axisId;
      break;
    case 'HOLIDAY':
      info = { date: row.code };
      break;
  }
  return { axisId: row.axisId, code: row.code, name: row.name, active: row.active, label, info };
}

@Injectable()
export class MasterDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** Busca no cache por código ou nome (contém, sem diferenciar maiúsculas), ou pelos ids pedidos. */
  async lookup(user: AuthenticatedUser, kindParam: string, q: { search?: string; ids?: string; includeInactive?: string; limit?: string }): Promise<MasterItem[]> {
    const kind = LOOKUP_KINDS[kindParam];
    if (!kind) throw new BadRequestException(`Cadastro desconhecido. Use: ${Object.keys(LOOKUP_KINDS).join(', ')}.`);
    const needed = RESTRICTED[kind];
    if (needed && !user.permissions.includes(needed)) throw new ForbiddenException('Você não tem permissão para consultar este cadastro.');

    const ids = (q.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length > MAX_IDS) throw new BadRequestException(`No máximo ${MAX_IDS} ids por consulta.`);
    const term = (q.search ?? '').trim().slice(0, 80);
    const limit = Math.min(Math.max(Math.trunc(Number(q.limit)) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const includeInactive = q.includeInactive === 'true' || q.includeInactive === '1';

    const where: Prisma.AxisMasterCacheWhereInput = { kind };
    if (ids.length) where.axisId = { in: ids };
    else {
      if (!includeInactive) where.active = true;
      if (term) where.OR = [{ code: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }];
    }
    const rows = await this.prisma.axisMasterCache.findMany({
      where,
      orderBy: kind === 'JOB_TITLE' ? [{ name: 'asc' }] : [{ code: 'asc' }, { name: 'asc' }],
      take: ids.length ? ids.length : limit,
    });
    return rows.map((r) => presentMaster(kind, r));
  }
}

/**
 * Consulta do cache de mestres do Core para os seletores da tela (mapa-interoperabilidade §1, regra 4: seleção, não
 * digitação). `GET /master-data/:kind?search=&limit=&includeInactive=` ou `?ids=a,b` (para mostrar o já escolhido).
 * Só leitura; o cache é alimentado pelos eventos do Core.
 */
@Controller('master-data')
export class MasterDataController {
  constructor(private readonly service: MasterDataService) {}

  @Get(':kind')
  @RequireAnyPermission(...READ_ANY)
  lookup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind') kind: string,
    @Query('search') search?: string,
    @Query('ids') ids?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.lookup(user, kind, { search, ids, includeInactive, limit });
  }
}

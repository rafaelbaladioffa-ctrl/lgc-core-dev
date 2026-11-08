import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { holidaySet, missingFromCache } from './master-cache.js';
import { MasterDataService, presentMaster } from './master-data.controller.js';

/** Cache de mestres do Core (V2/V4): feriados, conferência de ids e a consulta dos seletores. Valores fictícios. */

type Row = { kind: string; axisId: string; code: string | null; name: string | null; active: boolean; data: Record<string, unknown> };

const row = (kind: string, axisId: string, code: string | null, name: string | null, active = true, data: Record<string, unknown> = {}): Row => ({ kind, axisId, code, name, active, data });

function db(rows: Row[]) {
  const findMany = vi.fn(async ({ where, take }: { where: Record<string, any>; take?: number }) => {
    let out = rows.filter((r) => r.kind === where.kind);
    if (where.axisId?.in) out = out.filter((r) => where.axisId.in.includes(r.axisId));
    if (where.active !== undefined) out = out.filter((r) => r.active === where.active);
    if (where.OR) {
      const term = String(where.OR[0].code.contains).toLowerCase();
      out = out.filter((r) => (r.code ?? '').toLowerCase().includes(term) || (r.name ?? '').toLowerCase().includes(term));
    }
    return take ? out.slice(0, take) : out;
  });
  return { axisMasterCache: { findMany } };
}

const user = (permissions: string[]) => ({ userId: 'u', email: 'u@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions }) as AuthenticatedUser;

describe('holidaySet (F3)', () => {
  it('só feriados ativos, filtrados pelo período; null quando o Core ainda não mandou o calendário', async () => {
    const cache = db([row('HOLIDAY', 'h1', '2026-11-20', 'Consciência Negra'), row('HOLIDAY', 'h2', '2026-12-25', 'Natal'), row('HOLIDAY', 'h3', '2026-11-02', 'Finados', false)]);
    expect(await holidaySet(cache as never)).toEqual(new Set(['2026-11-20', '2026-12-25']));
    expect(await holidaySet(cache as never, { from: '2026-11-01', to: '2026-11-30' })).toEqual(new Set(['2026-11-20']));
    expect(await holidaySet(db([]) as never)).toBeNull();
    // Todos excluídos no Core: o calendário existe, só não tem feriado.
    expect(await holidaySet(db([row('HOLIDAY', 'h3', '2026-11-02', 'Finados', false)]) as never)).toEqual(new Set());
  });
});

describe('missingFromCache (F5)', () => {
  it('devolve os ids que o cache não conhece, sem repetir e ignorando vazios', async () => {
    const cache = db([row('COST_CENTER', 'cc1', '110', 'Centro')]);
    expect(await missingFromCache(cache as never, 'COST_CENTER', ['cc1', 'cc2', 'cc2', null, ''])).toEqual(['cc2']);
    expect(await missingFromCache(cache as never, 'PROJECT', [null])).toEqual([]);
  });
});

describe('presentMaster', () => {
  it('site mostra código — nome, cidade/UF', () => {
    expect(presentMaster('SITE', row('SITE', 's1', 'GRU53', 'Prédio 53', true, { address_city: 'Guarulhos', address_state: 'SP', client_id: 'k1' }))).toEqual({
      axisId: 's1',
      code: 'GRU53',
      name: 'Prédio 53',
      active: true,
      label: 'GRU53 — Prédio 53, Guarulhos/SP',
      info: { clientId: 'k1', city: 'Guarulhos', state: 'SP' },
    });
    expect(presentMaster('SITE', row('SITE', 's2', 'X1', 'Sem cidade')).label).toBe('X1 — Sem cidade');
  });

  it('cargo mostra o nome e se é técnico; feriado mostra a data', () => {
    expect(presentMaster('JOB_TITLE', row('JOB_TITLE', 'jt1', null, 'Técnico', true, { is_technician: true }))).toMatchObject({ label: 'Técnico', info: { isTechnician: true } });
    expect(presentMaster('HOLIDAY', row('HOLIDAY', 'h1', '2026-12-25', 'Natal'))).toMatchObject({ label: '2026-12-25 — Natal', info: { date: '2026-12-25' } });
  });
});

describe('MasterDataService.lookup', () => {
  const rows = [
    row('SITE', 's1', 'GRU53', 'Prédio 53', true, { address_city: 'Guarulhos', address_state: 'SP' }),
    row('SITE', 's2', 'CPS01', 'Campinas', true),
    row('SITE', 's3', 'GRU99', 'Desativado', false),
    row('COST_CENTER', 'cc1', '110', 'Centro'),
  ];
  const service = (r = rows) => new MasterDataService(db(r) as unknown as PrismaService);

  it('busca por código ou nome, só ativos por padrão; com includeInactive traz os inativos', async () => {
    const orc = user(['budget:read']);
    expect((await service().lookup(orc, 'sites', { search: 'gru' })).map((i) => i.axisId)).toEqual(['s1']);
    expect((await service().lookup(orc, 'sites', { search: 'gru', includeInactive: 'true' })).map((i) => i.axisId)).toEqual(['s1', 's3']);
  });

  it('pelos ids traz o já escolhido, mesmo inativo', async () => {
    expect((await service().lookup(user(['budget:read']), 'sites', { ids: 's3' })).map((i) => i.label)).toEqual(['GRU99 — Desativado']);
  });

  it('tipo desconhecido é 400; CC e colaborador exigem ver todos os CCs', async () => {
    await expect(service().lookup(user(['budget:read']), 'users', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service().lookup(user(['cost_center:read_own']), 'cost-centers', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service().lookup(user(['cost_center:read']), 'cost-centers', {})).toHaveLength(1);
  });
});

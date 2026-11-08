import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { CatalogsService } from './catalogs.service.js';

/** Destino do orçamento ligado ao site do Core (F1). Km e pedágio continuam do Financeiro. Valores fictícios. */

const SITE = '11111111-1111-4111-8111-111111111111';
const OFF = '22222222-2222-4222-8222-222222222222';
const USER = { userId: 'u1', email: 'u@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions: ['budget_params:write'] } as AuthenticatedUser;

type Row = Record<string, any>;

function fixture(destinations: Row[] = []) {
  const sites = [
    { kind: 'SITE', axisId: SITE, code: 'GRU53', name: 'Prédio 53', active: true, data: { address_city: 'Guarulhos', address_state: 'SP', client_id: 'k1' } },
    { kind: 'SITE', axisId: OFF, code: 'OLD1', name: 'Antigo', active: false, data: {} },
  ];
  const tx = {
    budgetDestination: {
      create: vi.fn(async ({ data }: Row) => ({ id: 'd-new', ...data })),
      findUnique: vi.fn(async ({ where }: Row) => destinations.find((d) => d.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: Row) => ({ ...destinations.find((d) => d.id === where.id), ...data })),
      findMany: vi.fn(async () => destinations),
    },
    axisMasterCache: {
      findUnique: vi.fn(async ({ where }: Row) => sites.find((s) => s.axisId === where.kind_axisId.axisId) ?? null),
      findMany: vi.fn(async ({ where }: Row) => sites.filter((s) => where.axisId.in.includes(s.axisId))),
    },
  };
  const prisma = { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  const service = new CatalogsService(prisma as unknown as PrismaService, { record: vi.fn() } as unknown as AuditService);
  return { service, tx };
}

describe('destino × site do Core (F1)', () => {
  const dto = { name: 'GRU53', kmRoundTrip: '120', tollPerDay: '18.4' };

  it('grava o site escolhido do cache e devolve código, nome, cidade/UF', async () => {
    const { service, tx } = fixture([{ id: 'd1', name: 'GRU53', siteAxisId: SITE }]);
    await service.createDestination({ ...dto, siteAxisId: SITE }, USER);
    expect(tx.budgetDestination.create.mock.calls[0][0].data).toMatchObject({ siteAxisId: SITE, kmRoundTrip: '120' });
    const [d] = await service.listDestinations(false);
    expect(d.site).toEqual({ axisId: SITE, code: 'GRU53', name: 'Prédio 53', city: 'Guarulhos', state: 'SP', clientId: 'k1', active: true });
  });

  it('site fora do cache ou inativo é recusado; null desfaz o vínculo; manter o mesmo site inativo é aceito', async () => {
    const { service, tx } = fixture([{ id: 'd1', name: 'Antigo', siteAxisId: OFF }]);
    await expect(service.createDestination({ ...dto, siteAxisId: '33333333-3333-4333-8333-333333333333' }, USER)).rejects.toThrow('Site não encontrado');
    await expect(service.createDestination({ ...dto, siteAxisId: OFF }, USER)).rejects.toThrow('O site OLD1 está inativo no Axis Core.');
    await service.updateDestination('d1', { siteAxisId: OFF, kmRoundTrip: '90' }, USER);
    await service.updateDestination('d1', { siteAxisId: null }, USER);
    expect(tx.budgetDestination.update.mock.calls[1][0].data).toMatchObject({ siteAxisId: null });
  });
});

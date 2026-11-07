import { describe, it, expect, vi, afterEach } from 'vitest';
import { MaterialsService } from '../../src/materials/materials.service.js';
import type { AuthenticatedUser } from '../../src/auth/authenticated-request.js';

/**
 * SEED_REVISED_CATALOG é uma flag de SEED. Ela já escondeu da listagem e do catálogo de compra
 * todo material cujo código não começasse com "REV-", o que deixaria o catálogo real da LGC
 * invisível em produção, já que o compose a definia como "true". O filtro foi removido:
 * estes testes existem para que ele não volte.
 */
const USER = { userId: 'u1', permissions: ['material:read_cost'] } as unknown as AuthenticatedUser;

const semFiltroDeCodigo = (where: Record<string, unknown>) => expect(where).not.toHaveProperty('code');

afterEach(() => {
  delete process.env.SEED_REVISED_CATALOG;
  vi.restoreAllMocks();
});

describe('catálogo não é filtrado por código de seed', () => {
  it('list não restringe a "REV-" mesmo com SEED_REVISED_CATALOG=true', async () => {
    process.env.SEED_REVISED_CATALOG = 'true';
    const count = vi.fn();
    const findMany = vi.fn();
    const prisma = {
      material: { count, findMany },
      $transaction: vi.fn().mockResolvedValue([0, []]),
    };
    await new MaterialsService(prisma as never, {} as never).list({}, USER);

    expect(count).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    for (const chamada of [count, findMany]) {
      const where = chamada.mock.calls[0][0].where as Record<string, unknown>;
      semFiltroDeCodigo(where);
      expect(where.status).toBe('ATIVO');
    }
  });

  it('list continua filtrando por código quando o usuário busca', async () => {
    const count = vi.fn();
    const prisma = { material: { count, findMany: vi.fn() }, $transaction: vi.fn().mockResolvedValue([0, []]) };
    await new MaterialsService(prisma as never, {} as never).list({ q: 'EPI-BOT' }, USER);

    const where = count.mock.calls[0][0].where as { OR?: unknown[] };
    expect(where.OR).toBeDefined();
    expect(where).not.toHaveProperty('code');
  });

  it('purchaseCatalog devolve todo material ativo, não só os "REV-"', async () => {
    process.env.SEED_REVISED_CATALOG = 'true';
    const findMany = vi.fn().mockResolvedValue([
      { id: '1', code: 'EPI-BOT-0040', shortDescription: 'Bota 40', technicalDescription: null, category: 'EPI', subcategory: 'Pés', stockUom: { code: 'PAR', name: 'Par' }, averageCost: null, lastCost: '296' },
      { id: '2', code: 'UNI-CAG-0038', shortDescription: 'Calça gestor 38', technicalDescription: null, category: 'Uniformes', subcategory: 'Vestuário', stockUom: { code: 'UN', name: 'Unidade' }, averageCost: null, lastCost: null },
    ]);
    const prisma = { material: { findMany } };
    const itens = await new MaterialsService(prisma as never, {} as never).purchaseCatalog();

    semFiltroDeCodigo(findMany.mock.calls[0][0].where as Record<string, unknown>);
    // Item sem custo cadastrado continua fora: o Core precisa do preço para a alçada de aprovação.
    expect(itens.map((i) => i.code)).toEqual(['EPI-BOT-0040']);
  });
});

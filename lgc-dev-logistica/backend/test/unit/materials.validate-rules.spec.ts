import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { MaterialsService } from '../../src/materials/materials.service.js';
import type { AuthenticatedUser } from '../../src/auth/authenticated-request.js';

type Rules = Record<string, unknown>;

// validateRules é privado; é chamado por notação de colchetes para testar a regra isoladamente.
const rulesOf = (m: Rules) => {
  const service = new MaterialsService({} as never, {} as never);
  return () => (service as unknown as { validateRules: (x: Rules) => void }).validateRules(m);
};

describe('MaterialsService.validateRules', () => {
  it('material sem flags passa', () => {
    expect(rulesOf({})).not.toThrow();
  });

  it('validade exige controle por lote', () => {
    expect(rulesOf({ expiryControlled: true, lotControlled: false })).toThrow(BadRequestException);
    expect(rulesOf({ expiryControlled: true, lotControlled: true })).not.toThrow();
  });

  it('vida útil mínima só se aplica com controle de validade', () => {
    expect(rulesOf({ minShelfLifeDays: 30, expiryControlled: false })).toThrow('A vida útil mínima só se aplica');
    expect(rulesOf({ minShelfLifeDays: 30, expiryControlled: true, lotControlled: true })).not.toThrow();
    expect(rulesOf({ minShelfLifeDays: null, expiryControlled: false })).not.toThrow();
  });

  it('controle por série exige SERIE_ESPECIFICA quando o método é informado', () => {
    expect(rulesOf({ serialControlled: true, exitMethod: 'FIFO' })).toThrow('SERIE_ESPECIFICA');
    expect(rulesOf({ serialControlled: true, exitMethod: 'FEFO' })).toThrow('SERIE_ESPECIFICA');
    expect(rulesOf({ serialControlled: true, exitMethod: 'SERIE_ESPECIFICA' })).not.toThrow();
  });

  it('FEFO exige controle de validade', () => {
    expect(rulesOf({ exitMethod: 'FEFO', expiryControlled: false })).toThrow('FEFO exige controle de validade');
    expect(rulesOf({ exitMethod: 'FEFO', expiryControlled: true, lotControlled: true })).not.toThrow();
  });

  it('exigência de autorização exige quem autoriza', () => {
    expect(rulesOf({ requiresAuthorization: true, authorizationBy: null })).toThrow('Informe quem autoriza');
    expect(rulesOf({ requiresAuthorization: true, authorizationBy: '' })).toThrow('Informe quem autoriza');
    expect(rulesOf({ requiresAuthorization: true, authorizationBy: 'HSE' })).not.toThrow();
  });

  // Corrigido: create assume SERIE_ESPECIFICA para item seriado sem exitMethod (default FIFO do banco quebraria o PATCH).
  it('create de material serial sem exitMethod assume SERIE_ESPECIFICA', async () => {
    const prisma = {
      unitOfMeasure: { findUnique: vi.fn().mockResolvedValue({ id: 'u', active: true }) },
      $transaction: vi.fn(),
    };
    const service = new MaterialsService(prisma as never, { record: vi.fn() } as never);
    const user = { userId: 'x', permissions: [] } as unknown as AuthenticatedUser;
    await service.create(
        { family: 'TI', subcode: 'NOT', shortDescription: 'Teste', category: 'Teste', type: 'ATIVO', stockUomId: '00000000-0000-4000-8000-000000000000', serialControlled: true } as never,
        user,
    );
    expect(prisma.$transaction).toHaveBeenCalled(); // passou pelas regras (não lançou BadRequest)
  });
});

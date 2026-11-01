import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ReceivingService, receiptCode } from '../../src/receiving/receiving.service.js';

// Regras de armazenagem (checkLocationFit / suggestLocation) e código de recebimento, com Prisma mockado.
// Sem banco: o service recebe um tx falso cujos findMany devolvem saldos e endereços controlados.

const D = (v: number | string) => new Prisma.Decimal(v);

const loc = (over: Record<string, unknown> = {}) => ({
  id: 'loc-1', code: 'A-01', warehouseId: 'wh-1', level: 'POSICAO', status: 'ATIVO', isVirtual: false,
  allowedCategories: [] as string[], allowedRiskClasses: [] as string[], capacityKind: null as string | null, capacityValue: null as Prisma.Decimal | null,
  ...over,
});
const mat = (over: Record<string, unknown> = {}) => ({
  id: 'mat-1', code: 'M-1', category: 'Elétrica', riskClass: null as string | null, weightKg: null as Prisma.Decimal | null,
  ...over,
});
const bal = (quantity: number, over: Record<string, unknown> = {}) => ({ locationId: 'loc-1', quantity: D(quantity), material: { riskClass: null, weightKg: null }, ...over });

function build(opts: { locations?: unknown[]; held?: unknown[]; holding?: string[] } = {}) {
  const tx = {
    stockBalance: {
      findMany: vi.fn().mockImplementation(async (args: { select?: unknown }) => (args?.select ? (opts.holding ?? []).map((locationId) => ({ locationId })) : (opts.held ?? []))),
    },
    location: { findMany: vi.fn().mockResolvedValue(opts.locations ?? []) },
  };
  const service = new ReceivingService({} as never, {} as never, {} as never);
  return { service, tx: tx as never, raw: tx };
}

const fit = (service: ReceivingService, tx: never, l: unknown, m: unknown, qty: number) =>
  (service as unknown as { checkLocationFit: (tx: never, l: unknown, m: unknown, q: Prisma.Decimal) => Promise<string | null> }).checkLocationFit(tx, l, m, D(qty));
const suggest = (service: ReceivingService, tx: never, m: unknown, qty: number) =>
  (service as unknown as { suggestLocation: (tx: never, m: unknown, wh: string, recv: string, q: Prisma.Decimal) => Promise<{ id: string } | null> })
    .suggestLocation(tx, m, 'wh-1', 'doca', D(qty));

describe('receiptCode', () => {
  it('formata REC com 8 dígitos e preserva números maiores', () => {
    expect(receiptCode(1)).toBe('REC-00000001');
    expect(receiptCode(123456789)).toBe('REC-123456789');
  });
});

describe('checkLocationFit — compatibilidade do endereço', () => {
  it('recusa endereço virtual e endereço bloqueado/inativo', async () => {
    const { service, tx } = build();
    expect(await fit(service, tx, loc({ isVirtual: true }), mat(), 1)).toBe('endereço virtual');
    expect(await fit(service, tx, loc({ status: 'BLOQUEADO' }), mat(), 1)).toBe('endereço bloqueado ou inativo');
  });

  it('categoria: aceita quando a lista é vazia e recusa quando não consta na lista', async () => {
    const { service, tx } = build();
    expect(await fit(service, tx, loc({ allowedCategories: [] }), mat({ category: 'X' }), 1)).toBeNull();
    expect(await fit(service, tx, loc({ allowedCategories: ['Hidráulica'] }), mat({ category: 'Elétrica' }), 1)).toBe('categoria Elétrica não aceita');
  });

  it('classe de risco: material com risco em endereço restrito a outras classes; material sem risco em endereço restrito', async () => {
    const { service, tx } = build();
    expect(await fit(service, tx, loc({ allowedRiskClasses: ['CORROSIVO'] }), mat({ riskClass: 'INFLAMAVEL' }), 1)).toBe('classe de risco INFLAMAVEL não aceita');
    expect(await fit(service, tx, loc({ allowedRiskClasses: ['CORROSIVO'] }), mat(), 1)).toBe('endereço restrito a classes de risco');
    expect(await fit(service, tx, loc({ allowedRiskClasses: ['CORROSIVO'] }), mat({ riskClass: 'CORROSIVO' }), 1)).toBeNull();
  });

  it('mistura incompatível: classe de risco diferente já guardada no endereço', async () => {
    const { service, tx } = build({ held: [bal(1, { material: { riskClass: 'INFLAMAVEL', weightKg: null } })] });
    expect(await fit(service, tx, loc(), mat({ riskClass: 'CORROSIVO' }), 1)).toBe('mistura incompatível de classes de risco');
  });

  it('capacidade por QUANTIDADE: soma o que já existe com a entrada', async () => {
    const l = loc({ capacityKind: 'QUANTIDADE', capacityValue: D(10) });
    const { service, tx } = build({ held: [bal(7)] });
    expect(await fit(service, tx, l, mat(), 3)).toBeNull();
    expect(await fit(service, tx, l, mat(), 4)).toBe('capacidade (quantidade) excedida');
  });

  it('capacidade por PESO: exige peso cadastrado e soma peso × quantidade já guardada', async () => {
    const l = loc({ capacityKind: 'PESO', capacityValue: D(10) });
    const { service, tx } = build({ held: [bal(2, { material: { riskClass: null, weightKg: D(1.5) } })] }); // 3 kg já ocupados
    expect(await fit(service, tx, l, mat({ weightKg: null }), 1)).toBe('material sem peso cadastrado para validar capacidade');
    expect(await fit(service, tx, l, mat({ weightKg: D(2) }), 3)).toBeNull(); // 3 + 6 = 9 kg
    expect(await fit(service, tx, l, mat({ weightKg: D(2) }), 4)).toBe('capacidade (peso) excedida'); // 3 + 8 = 11 kg
  });

  it('capacidade por PESO considera o peso do material já guardado, não a quantidade', async () => {
    const l = loc({ capacityKind: 'PESO', capacityValue: D(10) });
    const { service, tx } = build({ held: [bal(9, { material: { riskClass: null, weightKg: D(1) } })] }); // 9 kg
    expect(await fit(service, tx, l, mat({ weightKg: D(1) }), 1)).toBeNull(); // 10 kg, no limite
    expect(await fit(service, tx, l, mat({ weightKg: D(1) }), 2)).toBe('capacidade (peso) excedida');
  });
});

describe('suggestLocation — sugestão de endereço', () => {
  it('devolve null quando nenhum candidato cabe', async () => {
    const { service, tx } = build({ locations: [loc({ id: 'loc-1', allowedCategories: ['Outra'] }), loc({ id: 'loc-2', isVirtual: true })] });
    expect(await suggest(service, tx, mat({ category: 'Elétrica' }), 1)).toBeNull();
  });

  it('devolve null quando não há nenhum endereço no almoxarifado', async () => {
    const { service, tx } = build({ locations: [] });
    expect(await suggest(service, tx, mat(), 1)).toBeNull();
  });

  it('prefere o endereço que já guarda o mesmo material (consolidação) mesmo com código maior', async () => {
    const { service, tx } = build({
      locations: [loc({ id: 'loc-a', code: 'A' }), loc({ id: 'loc-z', code: 'Z' })],
      holding: ['loc-z'],
    });
    expect((await suggest(service, tx, mat(), 1))?.id).toBe('loc-z');
  });

  it('pula candidatos incompatíveis e escolhe o primeiro compatível pela ordem de código', async () => {
    const { service, tx } = build({
      locations: [loc({ id: 'loc-a', code: 'A', allowedCategories: ['Hidráulica'] }), loc({ id: 'loc-b', code: 'B' }), loc({ id: 'loc-c', code: 'C' })],
    });
    expect((await suggest(service, tx, mat({ category: 'Elétrica' }), 1))?.id).toBe('loc-b');
  });
});

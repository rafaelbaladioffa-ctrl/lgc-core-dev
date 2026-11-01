import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { DocumentsService } from '../../src/documents/documents.service.js';

// Documentos com Prisma mockado: extrato (limite de 1000), lista de separação ordenada por endereço,
// e custo oculto sem material:read_cost. Não toca no banco.

const D = (v: number | string) => new Prisma.Decimal(v);
const uom = { code: 'UN', precision: 0 };
const mat = (id: string, code: string) => ({ id, code, shortDescription: `Desc ${code}`, stockUom: uom });
const user = (permissions: string[] = []) => ({ userId: 'u-1', permissions, roles: [] }) as never;

function build(prisma: Record<string, unknown>) {
  const rbac = { assertWarehouseAccess: vi.fn().mockResolvedValue(undefined), accessibleWarehouseIds: vi.fn().mockResolvedValue('ALL') };
  return new DocumentsService(prisma as never, rbac as never);
}

describe('extrato de movimentações', () => {
  const movement = (seq: number, unitCost: number | null = 12.5) => ({
    seq, effectiveAt: new Date('2026-10-02T12:00:00Z'), type: 'SAIDA_ENTREGA', quantity: D(1), reason: 'Teste', unitCost: unitCost == null ? null : D(unitCost), material: { code: 'M-1', stockUom: uom },
  });

  it('consulta no máximo 1000 movimentos e avisa quando atinge o limite', async () => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: 1000 }, (_, i) => movement(i + 1)));
    const svc = build({ stockMovement: { findMany } });
    const doc = await svc.statement({}, user(['material:read_cost']));
    expect(findMany.mock.calls[0][0].take).toBe(1000);
    expect(doc.table?.rows).toHaveLength(1000);
    expect(doc.notes).toEqual(['Limite de 1.000 registros: refine o período.']);
  });

  it('sem atingir o limite não há nota de truncamento', async () => {
    const svc = build({ stockMovement: { findMany: vi.fn().mockResolvedValue([movement(1)]) } });
    const doc = await svc.statement({}, user(['material:read_cost']));
    expect(doc.notes).toBeUndefined();
  });

  it('sem material:read_cost a coluna de custo some e o valor não vaza nas linhas', async () => {
    const svc = build({ stockMovement: { findMany: vi.fn().mockResolvedValue([movement(1, 999)]) } });
    const doc = await svc.statement({}, user([]));
    expect(doc.table?.columns).not.toContain('Custo unit.');
    expect(doc.table?.rows[0].join('|')).not.toContain('999');
  });

  it('custo unitário ausente aparece como travessão e moeda em R$ pt-BR com milhar', async () => {
    const svc = build({ stockMovement: { findMany: vi.fn().mockResolvedValue([movement(1, null), movement(2, 1234.5)]) } });
    const doc = await svc.statement({}, user(['material:read_cost']));
    expect(doc.table?.rows[0].at(-1)).toBe('—');
    expect(doc.table?.rows[1].at(-1)).toMatch(/^R\$\s1\.234,50$/);
  });

  it('a identificação do movimento é MOV-00000001 e a data em DD/MM/AAAA HH:mm', async () => {
    const svc = build({ stockMovement: { findMany: vi.fn().mockResolvedValue([movement(1)]) } });
    const doc = await svc.statement({}, user([]));
    expect(doc.table?.rows[0][0]).toBe('MOV-00000001');
    expect(doc.table?.rows[0][1]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });
});

describe('lista de separação', () => {
  it('ordena as linhas pelo código do endereço', async () => {
    const items = [
      { locationId: 'l-3', materialId: 'm-1', lotId: null, quantityPlanned: D(1), quantityPicked: D(0) },
      { locationId: 'l-1', materialId: 'm-2', lotId: null, quantityPlanned: D(1), quantityPicked: D(0) },
      { locationId: 'l-2', materialId: 'm-1', lotId: null, quantityPlanned: D(1), quantityPicked: D(0) },
    ];
    const prisma = {
      pickingTask: { findUnique: vi.fn().mockResolvedValue({ id: 't', seq: 1, warehouseId: 'w', orderId: 'o', priority: 1, requiresCheck: false, items }) },
      fulfillmentOrder: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'o', seq: 1, warehouseId: 'w', projectAxisId: null, neededBy: null }) },
      material: { findMany: vi.fn().mockResolvedValue([mat('m-1', 'M-1'), mat('m-2', 'M-2')]) },
      location: { findMany: vi.fn().mockResolvedValue([{ id: 'l-1', code: 'A-01' }, { id: 'l-2', code: 'A-02' }, { id: 'l-3', code: 'B-01' }]) },
      lot: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const doc = await build(prisma).picking('t', user());
    expect(doc.table?.rows.map((r) => r[0])).toEqual(['A-01', 'A-02', 'B-01']);
  });

  // BUG: localeCompare ordena texto, não número. Endereços sem zero à esquerda saem fora da ordem de percurso.
  // Passos: 2 itens em A-10 e A-2 → lista de separação mostra A-10 antes de A-2 (percurso errado).
  it.fails('endereços com dígitos sem zero à esquerda (A-2 e A-10) são ordenados numericamente', async () => {
    // Ordem física de corredor: A-2 antes de A-10. Ordenação lexicográfica coloca A-10 antes de A-2.
    const items = [
      { locationId: 'l-10', materialId: 'm-1', lotId: null, quantityPlanned: D(1), quantityPicked: D(0) },
      { locationId: 'l-2', materialId: 'm-1', lotId: null, quantityPlanned: D(1), quantityPicked: D(0) },
    ];
    const prisma = {
      pickingTask: { findUnique: vi.fn().mockResolvedValue({ id: 't', seq: 1, warehouseId: 'w', orderId: 'o', priority: 1, requiresCheck: false, items }) },
      fulfillmentOrder: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'o', seq: 1, warehouseId: 'w', projectAxisId: null, neededBy: null }) },
      material: { findMany: vi.fn().mockResolvedValue([mat('m-1', 'M-1')]) },
      location: { findMany: vi.fn().mockResolvedValue([{ id: 'l-10', code: 'A-10' }, { id: 'l-2', code: 'A-2' }]) },
      lot: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const doc = await build(prisma).picking('t', user());
    expect(doc.table?.rows.map((r) => r[0])).toEqual(['A-2', 'A-10']);
  });
});

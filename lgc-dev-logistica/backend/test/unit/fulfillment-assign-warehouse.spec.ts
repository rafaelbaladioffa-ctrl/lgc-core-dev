import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FulfillmentService } from '../../src/fulfillment/fulfillment.service.js';

const WH = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

type Order = { id: string; status: string; warehouseId: string | null; items: Array<{ reservations: unknown[] }> };

function setup(order: Order | null, warehouse: { id: string; code: string; status: string } | null = { id: WH, code: 'ALM-01', status: 'ATIVO' }) {
  const update = vi.fn().mockResolvedValue({});
  const tx = {
    fulfillmentOrder: { findUnique: vi.fn().mockResolvedValue(order), update },
    warehouse: { findUnique: vi.fn().mockResolvedValue(warehouse) },
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const service = new FulfillmentService(prisma as never, { get: () => undefined } as never);
  const reserve = vi.spyOn(service, 'reserve').mockResolvedValue({} as never);
  // `load` monta a resposta; aqui só interessa que a escrita aconteceu.
  vi.spyOn(service as unknown as { load: () => Promise<unknown> }, 'load').mockResolvedValue({ id: 'ord-1' });
  return { service, update, reserve };
}

const order = (over: Partial<Order> = {}): Order => ({ id: 'ord-1', status: 'AGUARDANDO_INFORMACAO', warehouseId: null, items: [{ reservations: [] }], ...over });

describe('definir o almoxarifado de uma ordem de atendimento', () => {
  it('grava o almoxarifado e já tenta reservar', async () => {
    const { service, update, reserve } = setup(order());
    await service.assignWarehouse('ord-1', WH);
    expect(update).toHaveBeenCalledWith({ where: { id: 'ord-1' }, data: { warehouseId: WH } });
    expect(reserve).toHaveBeenCalledWith(expect.anything(), 'ord-1');
  });

  it('recusa ordem que já passou da reserva', async () => {
    const { service, update } = setup(order({ status: 'EM_SEPARACAO' }));
    await expect(service.assignWarehouse('ord-1', WH)).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('não troca de almoxarifado com reserva ativa em outro', async () => {
    const { service, update } = setup(order({ status: 'RESERVADA_PARCIAL', warehouseId: OTHER, items: [{ reservations: [{ id: 'r1' }] }] }));
    await expect(service.assignWarehouse('ord-1', WH)).rejects.toThrow('reserva em outro almoxarifado');
    expect(update).not.toHaveBeenCalled();
  });

  it('recusa almoxarifado inexistente ou inativo', async () => {
    await expect(setup(order(), null).service.assignWarehouse('ord-1', WH)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup(order(), { id: WH, code: 'ALM-01', status: 'INATIVO' }).service.assignWarehouse('ord-1', WH)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('ordem inexistente', async () => {
    await expect(setup(null).service.assignWarehouse('ord-1', WH)).rejects.toBeInstanceOf(NotFoundException);
  });
});

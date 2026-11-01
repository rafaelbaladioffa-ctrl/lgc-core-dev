import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Availability {
  material_id: string;
  sku: string;
  stock_unit: string;
  physical: string;
  reserved: string;
  blocked: string;
  available: string;
  projected_on_needed_by: string;
  as_of: string;
}

/** Hoje (00:00) no fuso America/Sao_Paulo, expresso em UTC para comparar com colunas DATE. */
export function todayBR() {
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Conceitos de estoque da seção 4. Consulta nunca reduz saldo; é informativa até a reserva confirmada (12.4). */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(materialIds: string[], opts: { warehouseId?: string; neededBy?: Date } = {}): Promise<Availability[]> {
    const materials = await this.prisma.material.findMany({ where: { id: { in: materialIds } }, include: { stockUom: true } });
    const balances = await this.prisma.stockBalance.findMany({
      where: { materialId: { in: materialIds }, ownership: 'PROPRIO', quantity: { gt: 0 }, ...(opts.warehouseId && { location: { warehouseId: opts.warehouseId } }) },
      include: { lot: true },
    });

    // Demanda aprovada ainda sem cobertura de reserva, com data necessária até a data consultada.
    const demand = new Map<string, Prisma.Decimal>();
    if (opts.neededBy) {
      const items = await this.prisma.fulfillmentItem.findMany({
        where: {
          materialId: { in: materialIds },
          order: { status: { in: ['RECEBIDA', 'EM_ANALISE', 'RESERVADA_PARCIAL', 'AGUARDANDO_ESTOQUE'] }, OR: [{ neededBy: null }, { neededBy: { lte: opts.neededBy } }], ...(opts.warehouseId && { warehouseId: opts.warehouseId }) },
        },
        include: { reservations: { where: { status: { in: ['ATIVA', 'CONSUMIDA'] } } } },
      });
      for (const it of items) {
        const covered = it.reservations.reduce((s, r) => s.plus(r.quantity), new Prisma.Decimal(0));
        const open = Prisma.Decimal.max(it.quantity.minus(covered), 0);
        demand.set(it.materialId, (demand.get(it.materialId) ?? new Prisma.Decimal(0)).plus(open));
      }
    }

    const today = todayBR();
    const asOf = new Date().toISOString();
    return materials.map((m) => {
      let physical = new Prisma.Decimal(0), reserved = new Prisma.Decimal(0), blocked = new Prisma.Decimal(0), available = new Prisma.Decimal(0);
      for (const b of balances.filter((x) => x.materialId === m.id)) {
        physical = physical.plus(b.quantity);
        reserved = reserved.plus(b.reservedQty);
        const usable = b.condition === 'DISPONIVEL' && (!b.lot || (b.lot.status === 'LIBERADO' && !(b.lot.expiresAt && b.lot.expiresAt < today)));
        if (usable) available = available.plus(b.quantity.minus(b.reservedQty));
        else blocked = blocked.plus(b.quantity);
      }
      const projected = opts.neededBy ? available.minus(demand.get(m.id) ?? 0) : available;
      return {
        material_id: m.id, sku: m.code, stock_unit: m.stockUom.code,
        physical: physical.toString(), reserved: reserved.toString(), blocked: blocked.toString(), available: available.toString(),
        projected_on_needed_by: projected.toString(), as_of: asOf,
      };
    });
  }
}

import { Prisma } from '@prisma/client';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round4 = (v: Prisma.Decimal) => v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Custo médio móvel na entrada por recebimento: (saldo × custo médio + quantidade × custo da entrada) ÷ (saldo + quantidade).
 * Saldo zero (ou sem custo anterior) → o custo da entrada vira o custo médio. Arredonda a 4 casas, como a coluna `average_cost`.
 * Tudo em `Prisma.Decimal`, sem ponto flutuante.
 */
export function averageAfterEntry(onHand: Prisma.Decimal.Value, currentAverage: Prisma.Decimal.Value | null | undefined, quantity: Prisma.Decimal.Value, unitCost: Prisma.Decimal.Value): Prisma.Decimal {
  const stock = D(onHand);
  if (stock.lte(0) || currentAverage == null) return round4(D(unitCost));
  return round4(stock.times(currentAverage).plus(D(quantity).times(unitCost)).dividedBy(stock.plus(quantity)));
}

/**
 * Custo médio depois de estornar uma entrada: retira do saldo a quantidade e o valor que ela trouxe.
 * Se não sobrar saldo, ou o valor retirado ficar maior que o que resta (parte já saiu a custo diferente), mantém o custo médio atual.
 */
export function averageAfterEntryReversal(onHand: Prisma.Decimal.Value, currentAverage: Prisma.Decimal.Value | null | undefined, quantity: Prisma.Decimal.Value, unitCost: Prisma.Decimal.Value): Prisma.Decimal | null {
  if (currentAverage == null) return null;
  const remaining = D(onHand).minus(quantity);
  if (remaining.lte(0)) return round4(D(currentAverage));
  const value = D(onHand).times(currentAverage).minus(D(quantity).times(unitCost));
  return value.lt(0) ? round4(D(currentAverage)) : round4(value.dividedBy(remaining));
}

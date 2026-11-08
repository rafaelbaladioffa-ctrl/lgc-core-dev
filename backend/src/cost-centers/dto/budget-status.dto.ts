import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsInt, IsNumber, Matches, Max, Min } from 'class-validator';
import { CostCenterBudgetStatus } from '@prisma/client';

/** Valor em reais: string decimal com até 2 casas (aceita número e converte). */
const MONEY = /^-?\d{1,15}(\.\d{1,2})?$/;
const toMoneyString = ({ value }: { value: unknown }) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : value);

/**
 * Financeiro → Core: situação do orçamento do centro de custo
 * (`PUT /integration/cost-centers/:id/budget-status`, docs/integracao-centros-de-custo.md §4).
 * Nomes em snake_case como no contrato.
 */
export class ReceiveCostCenterBudgetStatusDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @Transform(toMoneyString)
  @Matches(MONEY, { message: 'budget must be a decimal string with up to 2 places' })
  budget!: string;

  @Transform(toMoneyString)
  @Matches(MONEY, { message: 'committed must be a decimal string with up to 2 places' })
  committed!: string;

  @Transform(toMoneyString)
  @Matches(MONEY, { message: 'realized must be a decimal string with up to 2 places' })
  realized!: string;

  /** Consumo = (comprometido + realizado) ÷ orçamento × 100. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999)
  percent!: number;

  @IsEnum(CostCenterBudgetStatus)
  status!: CostCenterBudgetStatus;

  @IsISO8601({ strict: true })
  computed_at!: string;
}

import { Prisma } from '@prisma/client';

/** Cálculos de parâmetros (projetos-especificacao §6.1 e §6.3). Funções puras, só `Decimal`. */

type Dec = Prisma.Decimal;
type DecInput = Prisma.Decimal | string | number | null | undefined;
const D = Prisma.Decimal;
const ZERO = new D(0);
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

const dec = (v: DecInput): Dec | null => (v === null || v === undefined || v === '' ? null : new D(v));
const orZero = (v: DecInput): Dec => dec(v) ?? ZERO;
export const money = (v: Dec) => v.toDecimalPlaces(2, HALF_UP);
export const rate4 = (v: Dec) => v.toDecimalPlaces(4, HALF_UP);

export interface PayrollParams {
  hoursPerDay: DecInput;
  workingDaysYear: number | null | undefined;
  vacationWorkDays: number | null | undefined;
  inssRate: DecInput;
  ratRate: DecInput;
  thirdPartyRate: DecInput;
  fgtsRate: DecInput;
  fgtsFineProvision: DecInput;
  vtSalaryDiscount: boolean | null | undefined;
}

export interface RoleCostInput {
  billingRate: DecInput;
  monthlySalary: DecInput;
  plrSalariesPerYear: DecInput;
  mealPerWorkedDay: DecInput;
  transportPerMonth: DecInput;
  gymPerMonth: DecInput;
  healthPerMonth: DecInput;
  otherBenefitsPerMonth: DecInput;
  costPerHourOverride: DecInput;
}

export interface HourlyCost {
  source: 'calculado' | 'informado';
  workedDays: number | null;
  workedHours: string | null;
  /** Componentes do custo anual (R$, 2 casas); nulos quando o custo hora é informado. */
  annual: {
    salaries: string;
    thirteenth: string;
    vacationThird: string;
    employerCharges: string;
    fgts: string;
    plr: string;
    meal: string;
    transport: string;
    fixedBenefits: string;
    total: string;
    monthlyAverage: string;
  } | null;
  costPerHour: string;
  billingRate: string | null;
  /** Valor hora cobrado ÷ custo hora − 1 (fração, 4 casas). */
  hourMarkup: string | null;
}

export type HourlyCostResult = { ok: true; value: HourlyCost } | { ok: false; missing: string[] };

const PAYROLL_REQUIRED: Array<[keyof PayrollParams, string]> = [
  ['hoursPerDay', 'Horas por dia'],
  ['workingDaysYear', 'Dias úteis no ano'],
  ['vacationWorkDays', 'Dias de férias'],
  ['inssRate', 'INSS patronal'],
  ['ratRate', 'RAT × FAP'],
  ['thirdPartyRate', 'Terceiros'],
  ['fgtsRate', 'FGTS'],
];

function markup(billing: Dec | null, cost: Dec): string | null {
  if (!billing || cost.isZero()) return null;
  return rate4(billing.div(cost).minus(1)).toFixed(4);
}

/**
 * Custo por hora efetivamente trabalhada de uma função CLT:
 * custo anual (12 salários + 13º + 1/3 de férias + encargos + FGTS + PLR + benefícios) ÷ horas trabalhadas no ano.
 */
export function hourlyCost(params: PayrollParams, role: RoleCostInput): HourlyCostResult {
  const billing = dec(role.billingRate);
  const override = dec(role.costPerHourOverride);
  if (override) {
    return {
      ok: true,
      value: { source: 'informado', workedDays: null, workedHours: null, annual: null, costPerHour: rate4(override).toFixed(4), billingRate: billing ? money(billing).toFixed(2) : null, hourMarkup: markup(billing, override) },
    };
  }

  const missing = PAYROLL_REQUIRED.filter(([k]) => params[k] === null || params[k] === undefined || params[k] === '').map(([, label]) => label);
  const salary = dec(role.monthlySalary);
  if (!salary) missing.push('Salário mensal');
  if (missing.length > 0) return { ok: false, missing };

  const workedDays = Number(params.workingDaysYear) - Number(params.vacationWorkDays);
  const workedHours = new D(workedDays).mul(new D(params.hoursPerDay!));
  if (workedDays <= 0 || workedHours.lte(0)) return { ok: false, missing: ['Dias e horas trabalhados no ano precisam ser maiores que zero'] };

  const s = salary!;
  const salaries = s.mul(12);
  const thirteenth = s;
  const vacationThird = s.div(3);
  const payrollBase = salaries.plus(thirteenth).plus(vacationThird);
  const employerCharges = payrollBase.mul(orZero(params.inssRate).plus(orZero(params.ratRate)).plus(orZero(params.thirdPartyRate)));
  const fgts = payrollBase.mul(orZero(params.fgtsRate)).mul(orZero(params.fgtsFineProvision).plus(1));
  const plr = s.mul(orZero(role.plrSalariesPerYear));
  const meal = orZero(role.mealPerWorkedDay).mul(workedDays);
  const vtDiscount = params.vtSalaryDiscount ? s.mul('0.06') : ZERO;
  const transport = D.max(ZERO, orZero(role.transportPerMonth).minus(vtDiscount).mul(11));
  const fixedBenefits = orZero(role.gymPerMonth).plus(orZero(role.healthPerMonth)).plus(orZero(role.otherBenefitsPerMonth)).mul(12);
  const total = payrollBase.plus(employerCharges).plus(fgts).plus(plr).plus(meal).plus(transport).plus(fixedBenefits);
  const costPerHour = total.div(workedHours);

  const m = (v: Dec) => money(v).toFixed(2);
  return {
    ok: true,
    value: {
      source: 'calculado',
      workedDays,
      workedHours: workedHours.toFixed(2),
      annual: {
        salaries: m(salaries),
        thirteenth: m(thirteenth),
        vacationThird: m(vacationThird),
        employerCharges: m(employerCharges),
        fgts: m(fgts),
        plr: m(plr),
        meal: m(meal),
        transport: m(transport),
        fixedBenefits: m(fixedBenefits),
        total: m(total),
        monthlyAverage: m(total.div(12)),
      },
      costPerHour: rate4(costPerHour).toFixed(4),
      billingRate: billing ? money(billing).toFixed(2) : null,
      hourMarkup: markup(billing, costPerHour),
    },
  };
}

export interface TaxParams {
  pisRate: DecInput;
  cofinsRate: DecInput;
  issRate: DecInput;
  irpjPresumption: DecInput;
  irpjRate: DecInput;
  irpjSurcharge: boolean | null | undefined;
  csllPresumption: DecInput;
  csllRate: DecInput;
}

const TAX_KEYS: Array<keyof TaxParams> = ['pisRate', 'cofinsRate', 'issRate', 'irpjPresumption', 'irpjRate', 'csllPresumption', 'csllRate'];

/**
 * Alíquota total sobre a nota no lucro presumido (fração, 6 casas):
 * PIS + COFINS + ISS + presunção IRPJ × (IRPJ + adicional 10 %) + presunção CSLL × CSLL.
 * Nula enquanto faltar algum percentual.
 */
export function invoiceTaxRate(p: TaxParams): string | null {
  if (TAX_KEYS.some((k) => p[k] === null || p[k] === undefined || p[k] === '')) return null;
  const irpj = new D(p.irpjRate!).plus(p.irpjSurcharge ? '0.1' : 0);
  const total = new D(p.pisRate!)
    .plus(p.cofinsRate!)
    .plus(p.issRate!)
    .plus(new D(p.irpjPresumption!).mul(irpj))
    .plus(new D(p.csllPresumption!).mul(p.csllRate!));
  return total.toDecimalPlaces(6, HALF_UP).toFixed(6);
}

/** Diária real da plataforma = locação mensal ÷ dias de uso no mês (R$, 2 casas). */
export function platformDailyCost(monthlyRent: DecInput, daysPerMonth: number | null | undefined): string | null {
  const rent = dec(monthlyRent);
  if (!rent || !daysPerMonth || daysPerMonth <= 0) return null;
  return money(rent.div(daysPerMonth)).toFixed(2);
}

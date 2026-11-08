import { Prisma } from '@prisma/client';
import { hourlyCost, invoiceTaxRate, type PayrollParams, type RoleCostInput, type TaxParams } from '../budget-params/hourly-cost.js';

/**
 * Motor de cálculo do orçamento (projetos-especificacao §6.2–§6.7). Função pura com `Decimal`.
 * Cada linha é arredondada em 2 casas e os totais somam as linhas arredondadas, para a tela fechar.
 */

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const ZERO = new D(0);
const n = (v: unknown): Dec => (v === null || v === undefined || v === '' ? ZERO : new D(v as Prisma.Decimal.Value));
const r2 = (v: Dec) => v.toDecimalPlaces(2, HALF_UP);
const s2 = (v: Dec) => r2(v).toFixed(2);
const s4 = (v: Dec) => v.toDecimalPlaces(4, HALF_UP).toFixed(4);
const sum = (xs: Dec[]) => xs.reduce((a, b) => a.plus(b), ZERO);

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export interface TeamInput {
  roleKey: string;
  /** Funções de campo: pessoas × dias × horas/dia. */
  people?: number | null;
  /** Funções fora do campo (ex.: gerente): horas informadas. */
  hours?: string | number | null;
}

export interface MaterialInput {
  materialId?: string | null;
  description: string;
  unit?: string | null;
  quantity: string | number;
  billedUnitPrice: string | number;
  /** Nulo = custo não cadastrado: usa o preço cobrado e marca como estimado. */
  realUnitCost?: string | number | null;
}

export interface BudgetInputs {
  workDays: number;
  team: TeamInput[];
  materials: MaterialInput[];
  materialFreight?: string | null;
  materialLossRate?: string | null;
  travel?: {
    destinationId?: string | null;
    destinationName?: string | null;
    kmRoundTrip?: string | null;
    tollPerDay?: string | null;
    cars?: number | null;
    carRentalPerDay?: string | null;
    parkingPerDay?: string | null;
  };
  platform?: { days?: number | null; dailyBilled?: string | null; realCost?: string | null };
  lodging?: { people?: number | null; nights?: number | null; nightValue?: string | null; realCost?: string | null };
  meals?: { people?: number | null; days?: number | null; dayValue?: string | null; realCost?: string | null };
  extraLabor?: { overtimeCost?: string | null; onboardingCost?: string | null };
  otherCosts?: { epi?: string | null; tools?: string | null; insurance?: string | null; other?: string | null; otherDescription?: string | null };
}

export interface EngineRole extends RoleCostInput {
  roleKey: string;
  label: string;
  fieldRole: boolean;
}

export type EngineParams = PayrollParams &
  TaxParams & {
    kmRate: unknown;
    fuelKmPerLiter: unknown;
    fuelPricePerLiter: unknown;
    vehicleWearPerKm: unknown;
    materialMarkup: unknown;
    platformMonthlyRent: unknown;
    platformDaysPerMonth: number | null;
    platformFreight: unknown;
    contingencyRate: unknown;
    overheadRate: unknown;
    commissionRate: unknown;
    receivableDays: number | null;
    moneyCostMonthly: unknown;
    targetProfitOnCost: unknown;
    roles: EngineRole[];
  };

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export type ResultStatus = 'PREJUIZO' | 'ABAIXO_DA_META' | 'META_ATINGIDA';

export interface LaborLine {
  roleKey: string;
  label: string;
  fieldRole: boolean;
  people: number | null;
  hours: string;
  billingRate: string;
  billed: string;
  costPerHour: string | null;
  cost: string;
}

export interface MaterialLine {
  materialId: string | null;
  description: string;
  unit: string;
  quantity: string;
  billedUnitPrice: string;
  billed: string;
  realUnitCost: string | null;
  cost: string;
  estimatedCost: boolean;
}

export interface GroupLine {
  key: 'mao_de_obra' | 'material' | 'deslocamento_e_estadia' | 'outros';
  label: string;
  billed: string;
  cost: string;
  result: string;
  profitOnCost: string | null;
}

export interface BudgetResult {
  workDays: number;
  fieldHours: string;
  vehicleDays: number;
  kmTotal: string;
  labor: LaborLine[];
  materials: MaterialLine[];
  revenue: { labor: string; material: string; travel: string; platform: string; lodgingMeals: string; total: string };
  taxes: { rate: string | null; amount: string };
  directCosts: {
    labor: string;
    laborDetail: { hours: string; overtime: string; onboarding: string };
    material: string;
    materialDetail: { items: string; freight: string; losses: string };
    travel: string;
    travelDetail: { fuel: string; tolls: string; wear: string; rentalAndParking: string };
    platform: string;
    lodgingMeals: string;
    other: string;
    total: string;
  };
  indirect: { contingency: string; overhead: string; commission: string; financial: string; total: string };
  result: {
    contributionMargin: string;
    profit: string;
    totalCost: string;
    profitOnCost: string | null;
    margin: string | null;
    target: string | null;
    status: ResultStatus;
    profitPerDay: string | null;
    profitPerFieldHour: string | null;
  };
  pricing: {
    minimumPrice: string | null;
    targetPrice: string | null;
    gapToTarget: string | null;
    hourRatesForTarget: Array<{ roleKey: string; label: string; current: string; needed: string }>;
  };
  groups: GroupLine[];
  estimatedCost: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

export function computeBudget(params: EngineParams, inputs: BudgetInputs): BudgetResult {
  const warnings: string[] = [];
  const hoursPerDay = n(params.hoursPerDay);
  const days = Math.max(0, Math.trunc(inputs.workDays || 0));
  const roles = new Map(params.roles.map((r) => [r.roleKey, r]));

  // Mão de obra (§6.2 e §6.4)
  const labor: LaborLine[] = [];
  let fieldHours = ZERO;
  let fieldPeople = 0;
  for (const t of inputs.team) {
    const role = roles.get(t.roleKey);
    if (!role) {
      warnings.push(`Função "${t.roleKey}" não existe no conjunto de parâmetros e foi ignorada.`);
      continue;
    }
    const people = role.fieldRole ? Math.max(0, Math.trunc(t.people ?? 0)) : null;
    const hours = role.fieldRole ? hoursPerDay.mul(people ?? 0).mul(days) : n(t.hours);
    if (hours.isZero()) continue;
    if (role.fieldRole) {
      fieldHours = fieldHours.plus(hours);
      fieldPeople += people ?? 0;
    }
    const rate = n(role.billingRate);
    if (rate.isZero()) warnings.push(`${role.label}: sem valor hora cobrado nos parâmetros.`);
    const hc = hourlyCost(params, role);
    if (!hc.ok) warnings.push(`${role.label}: custo hora não calculado (falta ${hc.missing.join(', ')}).`);
    const costPerHour = hc.ok ? new D(hc.value.costPerHour) : null;
    labor.push({
      roleKey: role.roleKey,
      label: role.label,
      fieldRole: role.fieldRole,
      people,
      hours: hours.toFixed(2),
      billingRate: s2(rate),
      billed: s2(hours.mul(rate)),
      costPerHour: costPerHour ? costPerHour.toFixed(4) : null,
      cost: s2(costPerHour ? hours.mul(costPerHour) : ZERO),
    });
  }
  const laborBilled = sum(labor.map((l) => new D(l.billed)));
  const laborHoursCost = sum(labor.map((l) => new D(l.cost)));
  const overtime = r2(n(inputs.extraLabor?.overtimeCost));
  const onboarding = r2(n(inputs.extraLabor?.onboardingCost));
  const laborCost = laborHoursCost.plus(overtime).plus(onboarding);

  // Material
  const markup = n(params.materialMarkup).plus(1);
  let estimatedCost = false;
  const materials: MaterialLine[] = inputs.materials.map((m) => {
    const qty = n(m.quantity);
    const price = n(m.billedUnitPrice);
    const estimated = m.realUnitCost === null || m.realUnitCost === undefined || m.realUnitCost === '';
    if (estimated) estimatedCost = true;
    const costUnit = estimated ? price : n(m.realUnitCost);
    return {
      materialId: m.materialId ?? null,
      description: m.description,
      unit: m.unit || 'un',
      quantity: qty.toString(),
      billedUnitPrice: price.toString(),
      billed: s2(qty.mul(price).mul(markup)),
      realUnitCost: estimated ? null : costUnit.toString(),
      cost: s2(qty.mul(costUnit)),
      estimatedCost: estimated,
    };
  });
  if (estimatedCost) warnings.push('Há material sem custo real cadastrado: o custo usa o preço cobrado (custo estimado).');
  const materialBilled = sum(materials.map((m) => new D(m.billed)));
  const materialItems = sum(materials.map((m) => new D(m.cost)));
  const freight = r2(n(inputs.materialFreight));
  const losses = r2(materialItems.mul(n(inputs.materialLossRate)));
  const materialCost = materialItems.plus(freight).plus(losses);

  // Deslocamento
  const cars = Math.max(0, Math.trunc(inputs.travel?.cars ?? 0));
  const vehicleDays = cars * days;
  const km = n(inputs.travel?.kmRoundTrip);
  const toll = n(inputs.travel?.tollPerDay);
  const carDay = km.mul(n(params.kmRate)).plus(toll);
  const travelBilled = r2(carDay.mul(vehicleDays));
  const kmTotal = km.mul(vehicleDays);
  const kmPerLiter = n(params.fuelKmPerLiter);
  if (vehicleDays > 0 && kmPerLiter.isZero()) warnings.push('Consumo do carro não informado nos parâmetros: combustível ficou zero.');
  const fuel = r2(kmPerLiter.isZero() ? ZERO : kmTotal.div(kmPerLiter).mul(n(params.fuelPricePerLiter)));
  const tolls = r2(toll.mul(vehicleDays));
  const wear = r2(kmTotal.mul(n(params.vehicleWearPerKm)));
  const rental = r2(n(inputs.travel?.carRentalPerDay).plus(n(inputs.travel?.parkingPerDay)).mul(vehicleDays));
  const travelCost = fuel.plus(tolls).plus(wear).plus(rental);

  // Plataforma
  const platformDays = Math.max(0, Math.trunc(inputs.platform?.days ?? 0));
  const platformBilled = r2(n(inputs.platform?.dailyBilled).mul(platformDays));
  let platformCost = ZERO;
  if (inputs.platform?.realCost !== null && inputs.platform?.realCost !== undefined && inputs.platform.realCost !== '') {
    platformCost = r2(n(inputs.platform.realCost));
  } else if (platformDays > 0) {
    const perMonth = params.platformDaysPerMonth ?? 0;
    if (perMonth <= 0 || n(params.platformMonthlyRent).isZero()) warnings.push('Diária real da plataforma não configurada nos parâmetros: informe o custo real.');
    else platformCost = r2(n(params.platformMonthlyRent).div(perMonth).mul(platformDays));
  }
  if (platformDays > 0) platformCost = platformCost.plus(r2(n(params.platformFreight)));

  // Hospedagem e alimentação
  const lodgingBilled = r2(n(inputs.lodging?.nightValue).mul(inputs.lodging?.people ?? 0).mul(inputs.lodging?.nights ?? 0));
  const mealsBilled = r2(n(inputs.meals?.dayValue).mul(inputs.meals?.people ?? 0).mul(inputs.meals?.days ?? 0));
  const realOr = (real: string | null | undefined, billed: Dec) => (real === null || real === undefined || real === '' ? billed : r2(n(real)));
  const lodgingMealsBilled = lodgingBilled.plus(mealsBilled);
  const lodgingMealsCost = realOr(inputs.lodging?.realCost, lodgingBilled).plus(realOr(inputs.meals?.realCost, mealsBilled));

  // Outros custos (não cobrados à parte)
  const o = inputs.otherCosts ?? {};
  const otherCost = sum([o.epi, o.tools, o.insurance, o.other].map((v) => r2(n(v))));

  // Receita, impostos e custos
  const revenue = laborBilled.plus(materialBilled).plus(travelBilled).plus(platformBilled).plus(lodgingMealsBilled);
  const taxRateStr = invoiceTaxRate(params);
  if (!taxRateStr) warnings.push('Faltam percentuais de imposto nos parâmetros: impostos ficaram zero.');
  const taxRate = n(taxRateStr);
  const taxes = r2(revenue.mul(taxRate));
  const direct = laborCost.plus(materialCost).plus(travelCost).plus(platformCost).plus(lodgingMealsCost).plus(otherCost);

  const contingency = r2(direct.mul(n(params.contingencyRate)));
  const overheadRate = n(params.overheadRate);
  const commissionRate = n(params.commissionRate);
  const overhead = r2(revenue.mul(overheadRate));
  const commission = r2(revenue.mul(commissionRate));
  const financial = r2(direct.mul(n(params.moneyCostMonthly)).mul(params.receivableDays ?? 0).div(30));
  const indirect = contingency.plus(overhead).plus(commission).plus(financial);

  const contributionMargin = revenue.minus(taxes).minus(direct);
  const profit = contributionMargin.minus(indirect);
  const totalCost = direct.plus(indirect);
  const target = params.targetProfitOnCost === null || params.targetProfitOnCost === undefined ? null : n(params.targetProfitOnCost);
  const profitOnCost = totalCost.isZero() ? null : profit.div(totalCost);
  // Sem custo nenhum, qualquer lucro cumpre a meta.
  const status: ResultStatus = profit.isNeg() ? 'PREJUIZO' : target && profitOnCost && profitOnCost.lt(target) ? 'ABAIXO_DA_META' : 'META_ATINGIDA';

  // Preço mínimo, preço da meta e valor hora necessário (§6.6)
  const k = direct.plus(contingency).plus(financial);
  const rc = overheadRate.plus(commissionRate);
  const minDen = new D(1).minus(taxRate).minus(rc);
  const minimumPrice = minDen.lte(0) ? null : r2(k.div(minDen));
  let targetPrice: Dec | null = null;
  if (target) {
    const den = new D(1).minus(taxRate).minus(target.plus(1).mul(rc));
    targetPrice = den.lte(0) ? null : r2(target.plus(1).mul(k).div(den));
  }
  const gap = targetPrice ? targetPrice.minus(revenue) : null;
  const hourRatesForTarget =
    gap && !laborBilled.isZero()
      ? labor.map((l) => ({ roleKey: l.roleKey, label: l.label, current: l.billingRate, needed: s2(new D(l.billingRate).mul(laborBilled.plus(gap)).div(laborBilled)) }))
      : [];

  const group = (key: GroupLine['key'], label: string, billed: Dec, cost: Dec): GroupLine => ({
    key,
    label,
    billed: s2(billed),
    cost: s2(cost),
    result: s2(billed.minus(cost)),
    profitOnCost: cost.isZero() ? null : s4(billed.minus(cost).div(cost)),
  });

  return {
    workDays: days,
    fieldHours: fieldHours.toFixed(2),
    vehicleDays,
    kmTotal: kmTotal.toFixed(2),
    labor,
    materials,
    revenue: { labor: s2(laborBilled), material: s2(materialBilled), travel: s2(travelBilled), platform: s2(platformBilled), lodgingMeals: s2(lodgingMealsBilled), total: s2(revenue) },
    taxes: { rate: taxRateStr, amount: s2(taxes) },
    directCosts: {
      labor: s2(laborCost),
      laborDetail: { hours: s2(laborHoursCost), overtime: s2(overtime), onboarding: s2(onboarding) },
      material: s2(materialCost),
      materialDetail: { items: s2(materialItems), freight: s2(freight), losses: s2(losses) },
      travel: s2(travelCost),
      travelDetail: { fuel: s2(fuel), tolls: s2(tolls), wear: s2(wear), rentalAndParking: s2(rental) },
      platform: s2(platformCost),
      lodgingMeals: s2(lodgingMealsCost),
      other: s2(otherCost),
      total: s2(direct),
    },
    indirect: { contingency: s2(contingency), overhead: s2(overhead), commission: s2(commission), financial: s2(financial), total: s2(indirect) },
    result: {
      contributionMargin: s2(contributionMargin),
      profit: s2(profit),
      totalCost: s2(totalCost),
      profitOnCost: profitOnCost ? s4(profitOnCost) : null,
      margin: revenue.isZero() ? null : s4(profit.div(revenue)),
      target: target ? s4(target) : null,
      status,
      profitPerDay: days > 0 ? s2(profit.div(days)) : null,
      profitPerFieldHour: fieldHours.isZero() ? null : s2(profit.div(fieldHours)),
    },
    pricing: { minimumPrice: minimumPrice ? s2(minimumPrice) : null, targetPrice: targetPrice ? s2(targetPrice) : null, gapToTarget: gap ? s2(gap) : null, hourRatesForTarget },
    groups: [
      group('mao_de_obra', 'Mão de obra', laborBilled, laborCost),
      group('material', 'Material', materialBilled, materialCost),
      group('deslocamento_e_estadia', 'Deslocamento, plataforma, hospedagem e alimentação', travelBilled.plus(platformBilled).plus(lodgingMealsBilled), travelCost.plus(platformCost).plus(lodgingMealsCost)),
      group('outros', 'Outros custos (não cobrados à parte)', ZERO, otherCost),
    ],
    estimatedCost,
    warnings: fieldPeople === 0 && days > 0 ? [...warnings, 'Nenhuma pessoa de campo na equipe.'] : warnings,
  };
}

import { hourlyCost, invoiceTaxRate, platformDailyCost, type PayrollParams, type RoleCostInput } from './hourly-cost.js';

// Valores fictícios: os parâmetros reais da LGC ficam só no banco (repositório público).
const params: PayrollParams = {
  hoursPerDay: '8',
  workingDaysYear: 252,
  vacationWorkDays: 22,
  inssRate: '0.2',
  ratRate: '0.03',
  thirdPartyRate: '0.058',
  fgtsRate: '0.08',
  fgtsFineProvision: '0',
  vtSalaryDiscount: false,
};

const role: RoleCostInput = {
  billingRate: '60',
  monthlySalary: '3000',
  plrSalariesPerYear: '1',
  mealPerWorkedDay: '30',
  transportPerMonth: '200',
  gymPerMonth: '0',
  healthPerMonth: '500',
  otherBenefitsPerMonth: null,
  costPerHourOverride: null,
};

function ok(r: ReturnType<typeof hourlyCost>) {
  if (!r.ok) throw new Error(`esperava custo calculado, faltou: ${r.missing.join(', ')}`);
  return r.value;
}

describe('hourlyCost', () => {
  it('compõe o custo anual como a planilha e divide pelas horas trabalhadas', () => {
    const v = ok(hourlyCost(params, role));
    expect(v.source).toBe('calculado');
    expect(v.workedDays).toBe(230);
    expect(v.workedHours).toBe('1840.00');
    expect(v.annual).toEqual({
      salaries: '36000.00',
      thirteenth: '3000.00',
      vacationThird: '1000.00',
      employerCharges: '11520.00', // 40.000 × (20 % + 3 % + 5,8 %)
      fgts: '3200.00',
      plr: '3000.00',
      meal: '6900.00', // 30 × 230 dias
      transport: '2200.00', // 200 × 11 meses
      fixedBenefits: '6000.00',
      total: '72820.00',
      monthlyAverage: '6068.33',
    });
    expect(v.costPerHour).toBe('39.5761'); // 72.820 ÷ 1.840
    expect(v.hourMarkup).toBe('0.5161'); // 60 ÷ 39,5761 − 1
  });

  it('provisiona a multa do FGTS e desconta 6 % do salário no vale-transporte', () => {
    const v = ok(hourlyCost({ ...params, fgtsFineProvision: '0.4', vtSalaryDiscount: true }, role));
    expect(v.annual!.fgts).toBe('4480.00'); // 3.200 × 1,4
    expect(v.annual!.transport).toBe('220.00'); // 11 × (200 − 180)
  });

  it('vale-transporte menor que o desconto não vira custo negativo', () => {
    const v = ok(hourlyCost({ ...params, vtSalaryDiscount: true }, { ...role, transportPerMonth: '100' }));
    expect(v.annual!.transport).toBe('0.00');
  });

  it('custo hora informado substitui o cálculo, mesmo sem salário', () => {
    const v = ok(hourlyCost(params, { ...role, monthlySalary: null, costPerHourOverride: '75.5' }));
    expect(v).toMatchObject({ source: 'informado', annual: null, costPerHour: '75.5000', hourMarkup: '-0.2053' }); // cobra abaixo do custo
    expect(ok(hourlyCost(params, { ...role, billingRate: '151', costPerHourOverride: '75.5' })).hourMarkup).toBe('1.0000');
  });

  it('lista o que falta para calcular', () => {
    const r = hourlyCost({ ...params, ratRate: null, hoursPerDay: '' }, { ...role, monthlySalary: null });
    expect(r).toEqual({ ok: false, missing: ['Horas por dia', 'RAT × FAP', 'Salário mensal'] });
  });

  it('recusa ano sem horas trabalhadas', () => {
    expect(hourlyCost({ ...params, vacationWorkDays: 252 }, role).ok).toBe(false);
  });

  it('sem valor cobrado não há markup', () => {
    expect(ok(hourlyCost(params, { ...role, billingRate: null })).hourMarkup).toBeNull();
  });
});

describe('invoiceTaxRate', () => {
  const taxes = { pisRate: '0.0065', cofinsRate: '0.03', issRate: '0.05', irpjPresumption: '0.32', irpjRate: '0.15', irpjSurcharge: true, csllPresumption: '0.32', csllRate: '0.09' };

  it('soma PIS, COFINS, ISS e IRPJ/CSLL sobre a presunção', () => {
    expect(invoiceTaxRate(taxes)).toBe('0.195300');
    expect(invoiceTaxRate({ ...taxes, irpjSurcharge: false })).toBe('0.163300');
  });

  it('é nula enquanto faltar percentual', () => {
    expect(invoiceTaxRate({ ...taxes, issRate: null })).toBeNull();
  });
});

describe('platformDailyCost', () => {
  it('divide a locação mensal pelos dias de uso', () => {
    expect(platformDailyCost('2100', 21)).toBe('100.00');
    expect(platformDailyCost('1000', 3)).toBe('333.33');
  });

  it('é nula sem locação ou sem dias', () => {
    expect(platformDailyCost(null, 21)).toBeNull();
    expect(platformDailyCost('1000', 0)).toBeNull();
  });
});

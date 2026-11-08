import { computeBudget, type BudgetInputs, type EngineParams } from './budget-engine.js';

// Cenário fictício conferido à mão com as fórmulas da planilha (abas Calculadora e Custos e Lucro).
const params: EngineParams = {
  hoursPerDay: '8',
  workingDaysYear: 252,
  vacationWorkDays: 22,
  inssRate: '0.2',
  ratRate: '0.03',
  thirdPartyRate: '0.058',
  fgtsRate: '0.08',
  fgtsFineProvision: '0',
  vtSalaryDiscount: false,
  pisRate: '0.0065',
  cofinsRate: '0.03',
  issRate: '0.05',
  irpjPresumption: '0.32',
  irpjRate: '0.15',
  irpjSurcharge: true,
  csllPresumption: '0.32',
  csllRate: '0.09',
  kmRate: '1',
  fuelKmPerLiter: '10',
  fuelPricePerLiter: '6',
  vehicleWearPerKm: null,
  materialMarkup: '0.1',
  platformMonthlyRent: '2100',
  platformDaysPerMonth: 21,
  platformFreight: '50',
  contingencyRate: '0.05',
  overheadRate: '0.1',
  commissionRate: '0',
  receivableDays: 30,
  moneyCostMonthly: '0.01',
  targetProfitOnCost: '1',
  roles: [
    { roleKey: 'tecnico', label: 'Técnico', fieldRole: true, billingRate: '60', costPerHourOverride: '40', monthlySalary: null, plrSalariesPerYear: null, mealPerWorkedDay: null, transportPerMonth: null, gymPerMonth: null, healthPerMonth: null, otherBenefitsPerMonth: null },
    { roleKey: 'encarregado', label: 'Encarregado', fieldRole: true, billingRate: '100', costPerHourOverride: '50', monthlySalary: null, plrSalariesPerYear: null, mealPerWorkedDay: null, transportPerMonth: null, gymPerMonth: null, healthPerMonth: null, otherBenefitsPerMonth: null },
    { roleKey: 'gerente_projeto', label: 'Gerente de projeto', fieldRole: false, billingRate: '150', costPerHourOverride: '90', monthlySalary: null, plrSalariesPerYear: null, mealPerWorkedDay: null, transportPerMonth: null, gymPerMonth: null, healthPerMonth: null, otherBenefitsPerMonth: null },
  ],
};

const inputs: BudgetInputs = {
  workDays: 5,
  team: [
    { roleKey: 'tecnico', people: 2 },
    { roleKey: 'encarregado', people: 1 },
  ],
  materials: [{ description: 'Item A', unit: 'un', quantity: '10', billedUnitPrice: '8', realUnitCost: '2' }],
  travel: { kmRoundTrip: '100', tollPerDay: '10', cars: 1 },
  otherCosts: { epi: '100' },
};

describe('computeBudget — cenário de referência', () => {
  const r = computeBudget(params, inputs);

  it('receita: horas × valor hora, material com markup e carro/dia', () => {
    expect(r.labor.map((l) => [l.roleKey, l.hours, l.billed, l.cost])).toEqual([
      ['tecnico', '80.00', '4800.00', '3200.00'],
      ['encarregado', '40.00', '4000.00', '2000.00'],
    ]);
    expect(r.revenue).toEqual({ labor: '8800.00', material: '88.00', travel: '550.00', platform: '0.00', lodgingMeals: '0.00', total: '9438.00' });
    expect(r.fieldHours).toBe('120.00');
    expect(r.vehicleDays).toBe(5);
  });

  it('impostos e custos diretos', () => {
    expect(r.taxes).toEqual({ rate: '0.195300', amount: '1843.24' });
    expect(r.directCosts.travelDetail).toEqual({ fuel: '300.00', tolls: '50.00', wear: '0.00', rentalAndParking: '0.00' });
    expect(r.directCosts).toMatchObject({ labor: '5200.00', material: '20.00', travel: '350.00', platform: '0.00', other: '100.00', total: '5670.00' });
  });

  it('indiretos, lucro real e lucro sobre o custo', () => {
    expect(r.indirect).toEqual({ contingency: '283.50', overhead: '943.80', commission: '0.00', financial: '56.70', total: '1284.00' });
    expect(r.result).toEqual({
      contributionMargin: '1924.76',
      profit: '640.76',
      totalCost: '6954.00',
      profitOnCost: '0.0921',
      margin: '0.0679',
      target: '1.0000',
      status: 'ABAIXO_DA_META',
      profitPerDay: '128.15',
      profitPerFieldHour: '5.34',
    });
  });

  it('preço mínimo, preço da meta e valor hora necessário', () => {
    expect(r.pricing.minimumPrice).toBe('8528.74'); // 6.010,20 ÷ (1 − 19,53 % − 10 %)
    expect(r.pricing.targetPrice).toBe('19878.29'); // 2 × 6.010,20 ÷ (1 − 19,53 % − 2 × 10 %)
    expect(r.pricing.gapToTarget).toBe('10440.29');
    expect(r.pricing.hourRatesForTarget).toEqual([
      { roleKey: 'tecnico', label: 'Técnico', current: '60.00', needed: '131.18' },
      { roleKey: 'encarregado', label: 'Encarregado', current: '100.00', needed: '218.64' },
    ]);
  });

  it('no preço da meta o lucro é igual ao custo total (meta de 100 %)', () => {
    const p = Number(r.pricing.targetPrice);
    const k = 5670 + 283.5 + 56.7; // diretos + contingência + custo financeiro
    const lucro = p - p * 0.1953 - k - p * 0.1;
    const custo = k + p * 0.1;
    expect(Math.abs(lucro - custo)).toBeLessThan(0.02);
  });

  it('resultado por grupo mostra onde está o lucro', () => {
    expect(r.groups.map((g) => [g.key, g.billed, g.cost, g.result])).toEqual([
      ['mao_de_obra', '8800.00', '5200.00', '3600.00'],
      ['material', '88.00', '20.00', '68.00'],
      ['deslocamento_e_estadia', '550.00', '350.00', '200.00'],
      ['outros', '0.00', '100.00', '-100.00'],
    ]);
    expect(r.estimatedCost).toBe(false);
    expect(r.warnings).toEqual([]);
  });
});

describe('computeBudget — regras', () => {
  it('gerente entra por horas informadas e não conta como hora de campo', () => {
    const r = computeBudget(params, { ...inputs, team: [...inputs.team, { roleKey: 'gerente_projeto', hours: '10' }] });
    expect(r.labor[2]).toMatchObject({ roleKey: 'gerente_projeto', people: null, hours: '10.00', billed: '1500.00', cost: '900.00' });
    expect(r.fieldHours).toBe('120.00');
  });

  it('material sem custo real usa o preço cobrado e marca custo estimado', () => {
    const r = computeBudget(params, { ...inputs, materials: [{ description: 'Sem custo', quantity: '3', billedUnitPrice: '10', realUnitCost: null }] });
    expect(r.materials[0]).toMatchObject({ billed: '33.00', cost: '30.00', estimatedCost: true });
    expect(r.estimatedCost).toBe(true);
    expect(r.warnings).toContain('Há material sem custo real cadastrado: o custo usa o preço cobrado (custo estimado).');
  });

  it('plataforma: dias × locação ÷ dias do mês + frete; custo real informado substitui', () => {
    const base = computeBudget(params, { ...inputs, platform: { days: 3, dailyBilled: '500' } });
    expect(base.revenue.platform).toBe('1500.00');
    expect(base.directCosts.platform).toBe('350.00'); // 3 × 100 + 50 de frete
    const real = computeBudget(params, { ...inputs, platform: { days: 3, dailyBilled: '500', realCost: '420' } });
    expect(real.directCosts.platform).toBe('470.00');
  });

  it('hospedagem e alimentação: custo igual ao cobrado, salvo custo real informado', () => {
    const r = computeBudget(params, { ...inputs, lodging: { people: 3, nights: 4, nightValue: '150' }, meals: { people: 3, days: 5, dayValue: '60', realCost: '800' } });
    expect(r.revenue.lodgingMeals).toBe('2700.00'); // 1.800 + 900
    expect(r.directCosts.lodgingMeals).toBe('2600.00'); // 1.800 + 800
  });

  it('perdas e frete entram no custo do material', () => {
    const r = computeBudget(params, { ...inputs, materialFreight: '15', materialLossRate: '0.1' });
    expect(r.directCosts.materialDetail).toEqual({ items: '20.00', freight: '15.00', losses: '2.00' });
    expect(r.directCosts.material).toBe('37.00');
  });

  it('prejuízo quando o custo passa a receita', () => {
    const r = computeBudget(params, { ...inputs, extraLabor: { overtimeCost: '9000' } });
    expect(r.result.status).toBe('PREJUIZO');
    expect(Number(r.result.profit)).toBeLessThan(0);
  });

  it('percentuais inviáveis não geram preço', () => {
    const r = computeBudget({ ...params, overheadRate: '0.5' }, inputs);
    expect(r.pricing.minimumPrice).toBe('19724.98'); // 6.010,20 ÷ (1 − 19,53 % − 50 %)
    expect(r.pricing.targetPrice).toBeNull(); // 1 − 19,53 % − 2 × 50 % < 0
    expect(r.pricing.hourRatesForTarget).toEqual([]);
  });

  it('avisa função desconhecida e parâmetros faltando', () => {
    const r = computeBudget({ ...params, issRate: null }, { ...inputs, team: [{ roleKey: 'eletricista', people: 1 }] });
    expect(r.warnings).toContain('Função "eletricista" não existe no conjunto de parâmetros e foi ignorada.');
    expect(r.warnings).toContain('Faltam percentuais de imposto nos parâmetros: impostos ficaram zero.');
    expect(r.warnings).toContain('Nenhuma pessoa de campo na equipe.');
  });
});

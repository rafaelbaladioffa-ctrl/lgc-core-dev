import { businessDays, computeAwsQuote, distribute, suggestTeam, type AwsQuoteInput } from './aws-quote.js';
import type { BidTargets } from './bid-template-reader.js';

/** Números fictícios conferidos à mão (comentários mostram a conta). */

const TARGETS: BidTargets = {
  templateVersion: '9.1',
  cluster: 'TST',
  currency: 'BRL',
  fx: 5,
  targets: { costPerPortUsd: 40, hoursPerPort: 0.3, hoursPerMeter: 0.03, laborCostPerPortUsd: 10, hoursPerDevice: 0.5 },
  converted: { costPerPort: 200, laborCostPerPort: 50 },
  weights: { meters: 0.4, ports: 0.6, devices: 1 },
  thresholds: { efficiency: -0.15, costPerPort: 0.1, laborCostPerPort: 0.15, hoursPerPort: 0.25, hoursPerMeter: 0.25 },
  warnings: [],
};

function input(over: Partial<AwsQuoteInput> = {}): AwsQuoteInput {
  return {
    types: [
      { type: '2F LC-LC', kind: 'fibra', fibers: 2, quantity: 10, meters: 305, averageLengthM: 30, ports: 10 },
      { type: 'Cat6 green', kind: 'cobre', fibers: 0, quantity: 5, meters: 48, averageLengthM: 10, ports: 0 },
    ],
    targets: TARGETS,
    result: {
      workDays: 5,
      fieldHours: '80.00',
      vehicleDays: 5,
      labor: [
        { roleKey: 'tecnico', label: 'Técnico', fieldRole: true, people: 2, hours: '80.00', billingRate: '50.00', billed: '4000.00' },
        { roleKey: 'gerente_projeto', label: 'Gerente', fieldRole: false, people: null, hours: '10.00', billingRate: '100.00', billed: '1000.00' },
      ],
      revenue: { total: '6000.00', labor: '5000.00', travel: '500.00', platform: '0.00' },
    },
    hoursPerDay: 8,
    window: { start: '2030-02-01', end: '2030-02-10' },
    hoursOverrides: {},
    justifications: {},
    bid: { proposalName: 'PROP-100.001-1126 R1', start: '2030-02-01', end: '2030-02-08', platformDays: 0, platformDaily: null },
    ...over,
  };
}

describe('computeAwsQuote', () => {
  const q = computeAwsQuote(input());

  it('horas-meta por tipo com os pesos e metas do modelo e comprimento médio', () => {
    // 2F: 0,4 × (10 × 30 m) × 0,03 + 0,6 × 10 portas × 0,3 = 3,6 + 1,8 = 5,4. Cat6: 0,4 × 50 m × 0,03 = 0,6.
    expect(q.perType.map((t) => [t.type, t.consideredMeters, t.targetHours])).toEqual([
      ['2F LC-LC', 300, 5.4],
      ['Cat6 green', 50, 0.6],
    ]);
    expect(q.totals).toEqual({ targetHours: 6, meters: 350, ports: 10, fieldHours: 80, totalLaborHours: 90, fieldPeople: 2 });
  });

  it('dias sugeridos, janela e horas T proporcionais somando as horas de campo', () => {
    expect(q.suggestedDays).toBe(1); // ceil(6 / (2 pessoas × 8 h))
    expect(q.windowBusinessDays).toBe(6); // sex 01/02 + seg–sex 04 a 08/02
    expect(q.fitsWindow).toBe(true);
    expect(q.perType.map((t) => t.hoursT)).toEqual([72, 8]); // 80 × 5,4/6 e 80 × 0,6/6
    expect(q.hoursTMatches).toBe(true);
  });

  it('indicadores com meta, desvio e tolerância; fora da meta pede justificativa', () => {
    const byKey = Object.fromEntries(q.kpis.map((k) => [k.key, k]));
    expect(byKey.efficiency).toMatchObject({ value: 0.0667, target: 1, flagged: true, missingJustification: true }); // 6 / 90
    expect(byKey.costPerPort).toMatchObject({ value: 600, target: 200, delta: 2, flagged: true }); // 6000 / 10
    expect(byKey.laborCostPerPort).toMatchObject({ value: 500, target: 50 });
    expect(byKey.hoursPerPort).toMatchObject({ value: 9, target: 0.3 });
    expect(byKey.hoursPerMeter).toMatchObject({ value: 0.2571, target: 0.03 });
    expect(q.blockers).toHaveLength(5);
  });

  it('justificativas e horas T à mão destravam ou travam o envio', () => {
    const justified = computeAwsQuote(
      input({ justifications: { efficiency: 'x', costPerPort: 'x', laborCostPerPort: 'x', hoursPerPort: 'x', hoursPerMeter: 'Long runs' } }),
    );
    expect(justified.blockers).toEqual([]);
    const wrong = computeAwsQuote(input({ hoursOverrides: { 'Cat6 green': 10 }, justifications: justified.kpis.reduce((a, k) => ({ ...a, [k.key]: 'x' }), {}) }));
    expect(wrong.perType.find((t) => t.type === 'Cat6 green')).toMatchObject({ hoursT: 10, hoursTAuto: 8, overridden: true });
    expect(wrong.blockers).toEqual(['As horas por tipo de cabo somam 82; precisam ser iguais às horas de campo (80).']);
  });

  it('dentro da meta não pede justificativa', () => {
    const ok = computeAwsQuote(
      input({
        result: {
          ...input().result,
          // horas totais 6 = horas-meta; custo 2000/10 = 200 = meta
          labor: [{ roleKey: 'tecnico', label: 'Técnico', fieldRole: true, people: 1, hours: '6.00', billingRate: '50', billed: '300' }],
          fieldHours: '6.00',
          revenue: { total: '2000.00', labor: '500.00', travel: '0', platform: '0' },
        },
      }),
    );
    const byKey = Object.fromEntries(ok.kpis.map((k) => [k.key, k]));
    expect(byKey.efficiency.flagged).toBe(false);
    expect(byKey.costPerPort.flagged).toBe(false);
    expect(byKey.laborCostPerPort.flagged).toBe(false); // 500/10 = 50 = meta
  });

  it('valores para a Bid', () => {
    expect(q.bidValues).toMatchObject({
      proposalName: 'PROP-100.001-1126 R1',
      labor: [
        { roleKey: 'tecnico', rate: '50.00', hours: '80.00' },
        { roleKey: 'gerente_projeto', rate: '100.00', hours: '10.00' },
      ],
      travel: { perCarDay: 100, vehicleDays: 5 },
      cables: [
        { type: '2F LC-LC', averageLengthM: 30, quantity: 10, hoursT: 72 },
        { type: 'Cat6 green', averageLengthM: 10, quantity: 5, hoursT: 8 },
      ],
    });
  });
});

describe('peças', () => {
  it('dias úteis', () => {
    expect(businessDays('2030-02-01', '2030-02-01')).toBe(1);
    expect(businessDays('2030-02-02', '2030-02-03')).toBe(0); // sáb e dom
    expect(businessDays('2030-02-10', '2030-02-01')).toBeNull();
    expect(businessDays(null, '2030-02-01')).toBeNull();
  });

  it('distribuição com sobra na primeira linha', () => {
    expect(distribute(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(distribute(10, [0, 0])).toEqual([0, 0]);
  });
});

describe('suggestTeam', () => {
  it('menor equipe que cabe na janela e menores dias para ela (caso da Bid real)', () => {
    expect(suggestTeam(176.4, 7, 8)).toEqual({ foremen: 1, technicians: 3, days: 6 });
  });

  it('janela folgada: 1 encarregado + 1 técnico; janela apertada: mais técnicos', () => {
    expect(suggestTeam(40, 10, 8)).toEqual({ foremen: 1, technicians: 1, days: 3 });
    expect(suggestTeam(400, 5, 8)).toEqual({ foremen: 1, technicians: 9, days: 5 });
  });

  it('sem janela usa 1 técnico; sem horas-meta não sugere', () => {
    expect(suggestTeam(100, null, 8)).toEqual({ foremen: 1, technicians: 1, days: 7 });
    expect(suggestTeam(0, 7, 8)).toBeNull();
    expect(suggestTeam(100, 7, null)).toBeNull();
  });
});

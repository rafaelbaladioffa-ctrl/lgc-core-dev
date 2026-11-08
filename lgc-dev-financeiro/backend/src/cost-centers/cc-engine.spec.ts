import { describe, expect, it } from 'vitest';
import {
  D,
  attributeRevenue,
  budgetStatus,
  daysAllocatedInMonth,
  descendantsMap,
  distributeOverhead,
  emptyFigures,
  idleHours,
  monthlyRoleCost,
  parseMonth,
  parsePeriod,
  personDays,
  presentFigures,
  workingDays,
} from './cc-engine.js';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('período', () => {
  it('padrão é janeiro até o mês de hoje e lista os meses', () => {
    const p = parsePeriod(undefined, undefined, '2026-03-15');
    expect(p.from).toBe('2026-01');
    expect(p.months).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(p.end.toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  it('atravessa o ano e recusa início depois do fim', () => {
    expect(parsePeriod('2025-11', '2026-02', '2026-05-01').months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(() => parsePeriod('2026-05', '2026-01')).toThrow('início');
    expect(() => parseMonth('2026-13')).toThrow('AAAA-MM');
  });

  it('dias úteis param em hoje', () => {
    const days = workingDays(parsePeriod('2026-11', '2026-11'), '2026-11-04');
    // 2026-11-02 (seg), 03, 04
    expect(days.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('dias úteis sem os feriados do Core (F3)', () => {
    const days = workingDays(parsePeriod('2026-11', '2026-11'), '2026-11-30', new Set(['2026-11-02', '2026-11-20', '2026-11-15']));
    const iso = days.map((x) => x.toISOString().slice(0, 10));
    expect(iso).not.toContain('2026-11-02');
    expect(iso).not.toContain('2026-11-20');
    expect(days).toHaveLength(21 - 2); // novembro/2026 tem 21 dias úteis; 15/11 é domingo
  });
});

describe('alocação', () => {
  it('conta pessoas-dia com fim exclusivo', () => {
    const days = workingDays(parsePeriod('2026-11', '2026-11'), '2026-11-06'); // 2..6 = 5 dias úteis
    const pd = personDays(
      [
        { collaboratorId: 'a', costCenterId: 'x', validFrom: d('2026-01-01'), validTo: null },
        { collaboratorId: 'b', costCenterId: 'x', validFrom: d('2026-11-04'), validTo: d('2026-11-06') },
      ],
      days,
    );
    expect(pd.get('a')).toBe(5);
    expect(pd.get('b')).toBe(2);
  });

  it('dias alocados no mês para a folha proporcional', () => {
    const month = parseMonth('2026-02');
    expect(daysAllocatedInMonth({ validFrom: d('2026-01-10'), validTo: null }, month)).toBe(28);
    expect(daysAllocatedInMonth({ validFrom: d('2026-02-15'), validTo: null }, month)).toBe(14);
    expect(daysAllocatedInMonth({ validFrom: d('2026-01-01'), validTo: d('2026-02-11') }, month)).toBe(10);
    expect(daysAllocatedInMonth({ validFrom: d('2026-03-01'), validTo: null }, month)).toBe(0);
  });
});

describe('orçamento', () => {
  it('faixas ok, alerta, estourado e sem orçamento', () => {
    expect(budgetStatus(new D(1000), new D(500))).toEqual({ percent: '0.5000', status: 'ok' });
    expect(budgetStatus(new D(1000), new D(800)).status).toBe('alerta');
    expect(budgetStatus(new D(1000), new D(1000)).status).toBe('estourado');
    expect(budgetStatus(new D(0), new D(10))).toEqual({ percent: null, status: 'sem_orcamento' });
  });
});

describe('rateio', () => {
  const none = { headcount: new Map(), receita: new Map(), custo_direto: new Map() };

  it('headcount distribui proporcional e fecha centavos no último destino', () => {
    const r = distributeOverhead(
      [{ source: 'adm', driver: 'headcount', targets: [{ costCenterId: 't1', percent: null }, { costCenterId: 't2', percent: null }, { costCenterId: 't3', percent: null }] }],
      new Map([['adm', new D('100.00')]]),
      { ...none, headcount: new Map([['t1', new D(1)], ['t2', new D(1)], ['t3', new D(1)]]) },
    );
    const got = r.received;
    expect(got.get('t1')![0].amount.toFixed(2)).toBe('33.33');
    expect(got.get('t2')![0].amount.toFixed(2)).toBe('33.33');
    expect(got.get('t3')![0].amount.toFixed(2)).toBe('33.34');
    expect(r.ceded.get('adm')!.reduce((s, x) => s.plus(x.amount), new D(0)).toFixed(2)).toBe('100.00');
  });

  it('percentual abaixo de 100% deixa o resto na origem', () => {
    const r = distributeOverhead([{ source: 'adm', driver: 'percentual', targets: [{ costCenterId: 't1', percent: new D('0.6') }] }], new Map([['adm', new D(200)]]), none);
    expect(r.received.get('t1')![0].amount.toFixed(2)).toBe('120.00');
  });

  it('sem base no direcionador: não distribui e avisa', () => {
    const r = distributeOverhead([{ source: 'adm', driver: 'receita', targets: [{ costCenterId: 't1', percent: null }] }], new Map([['adm', new D(50)]]), none);
    expect(r.received.size).toBe(0);
    expect(r.warnings[0].costCenterId).toBe('adm');
  });
});

describe('árvore e resultado', () => {
  it('descendentes em vários níveis, sem ciclo infinito', () => {
    const m = descendantsMap([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ]);
    expect(m.get('a')!.sort()).toEqual(['b', 'c']);
    expect(m.get('x')).toEqual(['y']);
  });

  it('resultado = receita − custo − rateio recebido + cedido', () => {
    const f = { ...emptyFigures(), revenue: new D(1000), cost: new D(600), overheadIn: new D(100), overheadOut: new D(50) };
    expect(presentFigures(f)).toMatchObject({ result: '350.00', margin: '0.3500' });
    expect(presentFigures(emptyFigures()).margin).toBeNull();
  });
});

describe('equipe técnica', () => {
  it('receita atribuída pela participação nas horas do projeto', () => {
    const r = attributeRevenue(new Map([['p1', new D(30)], ['p2', new D(10)]]), new Map([['p1', new D(40)], ['p2', new D(10)]]), new Map([['p1', new D(1000)]]));
    expect(r.rows.find((x) => x.projectId === 'p1')!.revenue.toFixed(2)).toBe('750.00');
    expect(r.total.toFixed(2)).toBe('750.00');
  });

  it('ociosidade não fica negativa e ignora horas lançadas como ocioso', () => {
    expect(idleHours(new D(100), new Map([['projeto', new D(60)], ['ocioso', new D(20)]])).toFixed(0)).toBe('40');
    expect(idleHours(new D(10), new Map([['projeto', new D(60)]])).toFixed(0)).toBe('0');
  });

  it('custo mensal com custo hora informado usa as horas trabalhadas do ano', () => {
    const params = { hoursPerDay: '8', workingDaysYear: 250, vacationWorkDays: 20, inssRate: null, ratRate: null, thirdPartyRate: null, fgtsRate: null, fgtsFineProvision: null, vtSalaryDiscount: null };
    const role = { billingRate: null, monthlySalary: null, plrSalariesPerYear: null, mealPerWorkedDay: null, transportPerMonth: null, gymPerMonth: null, healthPerMonth: null, otherBenefitsPerMonth: null, costPerHourOverride: '30' };
    // 30 × 8 × 230 ÷ 12 = 4600
    expect(monthlyRoleCost(params, role)!.toFixed(2)).toBe('4600.00');
    expect(monthlyRoleCost(params, { ...role, costPerHourOverride: null })).toBeNull();
  });
});

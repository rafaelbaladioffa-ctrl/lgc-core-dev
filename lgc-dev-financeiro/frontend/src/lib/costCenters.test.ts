import {
  ACTIVITY_LABEL,
  budgetTotals,
  buildTree,
  CATEGORY_LABEL,
  ccLabel,
  consumptionWidth,
  COST_CATEGORIES,
  currentMonth,
  defaultPeriod,
  DRIVER_LABEL,
  formatMonth,
  FUNNEL_LABEL,
  labelOf,
  normalizeBudgetRows,
  percentTargetsComplete,
  periodFromPath,
  SOURCE_LABEL,
  sumDecimals,
  toScaled,
  validateDayRange,
  validateMonth,
  validatePeriod,
  validateTeamLog,
  type TeamLogForm,
} from './costCenters';

describe('rótulos dos centros de custo', () => {
  it('traduz categorias, atividades, origens, direcionadores e funil', () => {
    expect(CATEGORY_LABEL.faturamento).toBe('Faturamento');
    expect(CATEGORY_LABEL.despesas_campo).toBe('Despesas de campo');
    expect(COST_CATEGORIES.every((c) => CATEGORY_LABEL[c])).toBe(true);
    expect(ACTIVITY_LABEL.manutencao).toBe('Manutenção');
    expect(SOURCE_LABEL.logistica).toBe('Logística');
    expect(SOURCE_LABEL.mao_de_obra).toBe('Mão de obra (Field)');
    expect(DRIVER_LABEL.headcount).toBe('Pessoas-dia alocadas');
    expect(FUNNEL_LABEL.recebida_parcial).toBe('Recebida em parte');
  });

  it('chave desconhecida aparece como veio e nula vira travessão', () => {
    expect(labelOf(CATEGORY_LABEL, 'nova_categoria')).toBe('nova_categoria');
    expect(labelOf(CATEGORY_LABEL, null)).toBe('—');
  });

  it('nome do centro com código', () => {
    expect(ccLabel({ code: 'DC-001-JAI', name: 'Equipe Jaime' })).toBe('DC-001-JAI — Equipe Jaime');
    expect(ccLabel({ code: null, shortCode: 'JAI', name: null })).toBe('JAI');
    expect(ccLabel({ code: null, name: null })).toBe('Centro sem nome');
  });
});

describe('árvore por parentId', () => {
  const cc = (id: string, parentId: string | null, code: string) => ({ id, parentId, code, name: null });
  const items = [cc('c', 'a', 'A.2'), cc('b', 'a', 'A.1'), cc('a', null, 'A'), cc('d', 'b', 'A.1.1'), cc('z', 'fora', 'Z')];

  it('pai antes dos filhos, irmãos por código, profundidade e pai fora da lista vira raiz', () => {
    const rows = buildTree(items);
    expect(rows.map((r) => [r.item.id, r.depth, r.hasChildren])).toEqual([
      ['a', 0, true],
      ['b', 1, true],
      ['d', 2, false],
      ['c', 1, false],
      ['z', 0, false],
    ]);
  });

  it('ramo recolhido esconde os descendentes', () => {
    expect(buildTree(items, new Set(['b'])).map((r) => r.item.id)).toEqual(['a', 'b', 'c', 'z']);
    expect(buildTree(items, new Set(['a'])).map((r) => r.item.id)).toEqual(['a', 'z']);
  });

  it('ciclo não trava e cada item aparece uma vez', () => {
    const rows = buildTree([cc('x', 'y', 'X'), cc('y', 'x', 'Y')]);
    expect(rows.map((r) => r.item.id).sort()).toEqual(['x', 'y']);
  });
});

describe('período e competência', () => {
  const now = new Date('2026-11-08T12:00:00Z');

  it('padrão é janeiro até o mês corrente em São Paulo', () => {
    expect(defaultPeriod(now)).toEqual({ from: '2026-01', to: '2026-11' });
    // 01/12 00:30 UTC ainda é 30/11 em São Paulo.
    expect(currentMonth(new Date('2026-12-01T00:30:00Z'))).toBe('2026-11');
  });

  it('valida competência AAAA-MM', () => {
    expect(validateMonth('2026-10')).toBeNull();
    expect(validateMonth('')).toBe('Informe a competência.');
    expect(validateMonth('2026-13')).toBe('Use o formato AAAA-MM.');
    expect(validateMonth('10/2026')).toBe('Use o formato AAAA-MM.');
  });

  it('valida o período e lê da rota, com padrão quando inválido', () => {
    expect(validatePeriod({ from: '2026-01', to: '2026-03' })).toBeNull();
    expect(validatePeriod({ from: '2026-04', to: '2026-03' })).toBe('O mês inicial não pode ser depois do final.');
    expect(periodFromPath('/centros-de-custo?from=2026-02&to=2026-05', now)).toEqual({ from: '2026-02', to: '2026-05' });
    expect(periodFromPath('/centros-de-custo?from=2026-06&to=2026-05', now)).toEqual({ from: '2026-01', to: '2026-11' });
    expect(periodFromPath('/equipes', now)).toEqual({ from: '2026-01', to: '2026-11' });
  });

  it('mês por extenso', () => {
    expect(formatMonth('2026-03')).toBe('mar/2026');
  });
});

describe('totais exatos', () => {
  it('soma decimais sem ponto flutuante', () => {
    expect(sumDecimals(['0.10', '0.20'])).toBe('0.30');
    expect(sumDecimals(['1234.56', '-34.56', '', null, 'x'])).toBe('1200.00');
    expect(sumDecimals(['-0.05'])).toBe('-0.05');
    expect(toScaled('1.234')).toBeNull();
  });

  it('totais da grade do orçamento por categoria, mês e geral', () => {
    const rows = [Array(12).fill('100.00'), ['0.5', ...Array(11).fill('0')]];
    const t = budgetTotals(rows);
    expect(t.rowTotals).toEqual(['1200.00', '0.50']);
    expect(t.monthTotals[0]).toBe('100.50');
    expect(t.monthTotals[11]).toBe('100.00');
    expect(t.total).toBe('1200.50');
  });

  it('grade completa com todas as categorias de custo na ordem', () => {
    const rows = normalizeBudgetRows([{ category: 'frota', months: ['10.00'] }]);
    expect(rows.map((r) => r.category)).toEqual([...COST_CATEGORIES]);
    expect(rows.find((r) => r.category === 'frota')?.months.slice(0, 2)).toEqual(['10.00', '0.00']);
    expect(rows.every((r) => r.months.length === 12)).toBe(true);
  });

  it('barra de consumo limita a 100% e destinos percentuais somam 100%', () => {
    expect(consumptionWidth('0.8125')).toBe(81.3);
    expect(consumptionWidth('1.5')).toBe(100);
    expect(consumptionWidth(null)).toBe(0);
    expect(percentTargetsComplete(['0.6', '0.4'])).toBe(true);
    expect(percentTargetsComplete(['0.6', '0.3'])).toBe(false);
  });
});

describe('diário da equipe', () => {
  const base: TeamLogForm = { date: '2026-11-03', activity: 'projeto', projectId: 'p1', people: '4', hoursPerPerson: '8,5', km: '120', producedQuantity: '1,25', producedUnit: ' km de fibra ', notes: '' };

  it('monta o corpo da API com números normalizados', () => {
    const r = validateTeamLog(base);
    expect(r).toEqual({ ok: true, body: { date: '2026-11-03', activity: 'projeto', projectId: 'p1', people: 4, hoursPerPerson: '8.5', km: '120', producedQuantity: '1.25', producedUnit: 'km de fibra' } });
  });

  it('exige projeto quando a atividade é projeto e valida pessoas, horas e produção', () => {
    const r = validateTeamLog({ ...base, projectId: '', people: '0', hoursPerPerson: '25', producedUnit: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['hoursPerPerson', 'people', 'producedUnit', 'projectId']);
  });

  it('atividade fora de projeto não exige projeto', () => {
    const r = validateTeamLog({ ...base, activity: 'ocioso', projectId: '', producedQuantity: '', producedUnit: '' });
    expect(r.ok && r.body.projectId).toBe(undefined);
  });
});

describe('período da importação das horas do Field', () => {
  const now = new Date('2026-11-08T15:00:00Z');
  it('aceita até 62 dias e recusa invertido, longo demais ou futuro', () => {
    expect(validateDayRange('2026-11-01', '2026-11-07', now)).toBeNull();
    expect(validateDayRange('2026-09-07', '2026-11-07', now)).toBeNull(); // 62 dias
    expect(validateDayRange('2026-09-06', '2026-11-07', now)).toMatch(/62 dias/);
    expect(validateDayRange('2026-11-07', '2026-11-01', now)).toMatch(/depois do fim/);
    expect(validateDayRange('2026-11-01', '2026-11-09', now)).toMatch(/futuro/);
    expect(validateDayRange('', '2026-11-01', now)).toMatch(/Informe/);
  });
});

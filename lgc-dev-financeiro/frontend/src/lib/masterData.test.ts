import { masterQuery } from './masterData';
import { destinationForSite, siteLabel, type BudgetDestination } from './budgetParams';
import { logisticsImportWarning } from './costCenters';

describe('consulta dos cadastros do Core', () => {
  it('ids têm prioridade; busca vai com termo, inativos e limite', () => {
    expect(masterQuery({ ids: ['a', 'b'], search: 'x' })).toBe('?ids=a%2Cb');
    expect(masterQuery({ search: ' gru ', includeInactive: true, limit: 10 })).toBe('?search=gru&includeInactive=true&limit=10');
    expect(masterQuery({})).toBe('');
  });
});

describe('destino × site do Core (F1)', () => {
  const dest = (id: string, siteAxisId: string | null, active = true) => ({ id, name: id, siteAxisId, active }) as BudgetDestination;

  it('rótulo do site: código — nome, cidade/UF', () => {
    expect(siteLabel({ code: 'GRU53', name: 'Prédio 53', city: 'Guarulhos', state: 'SP' })).toBe('GRU53 — Prédio 53, Guarulhos/SP');
    expect(siteLabel({ code: 'GRU53', name: null, city: null, state: null })).toBe('GRU53');
  });

  it('o deslocamento sugere o destino ativo ligado ao site do projeto', () => {
    const list = [dest('inativo', 's1', false), dest('certo', 's1'), dest('outro', 's2')];
    expect(destinationForSite(list, 's1')?.id).toBe('certo');
    expect(destinationForSite(list, 's9')).toBeNull();
    expect(destinationForSite(list, null)).toBeNull();
  });
});

describe('importação da Logística com ids fora do cache (F5)', () => {
  it('avisa quando há CC ou projeto desconhecido; sem eles, nada', () => {
    expect(logisticsImportWarning({ month: '2026-11', created: 1, replaced: 0, unchanged: 0 })).toBeNull();
    expect(logisticsImportWarning({ month: '2026-11', created: 1, replaced: 0, unchanged: 0, unknownCostCenters: ['c1'], unknownProjects: ['p1', 'p2'] })).toMatch(
      /^A Logística citou 1 centro de custo e 2 projetos que o Financeiro ainda não recebeu do Axis Core/,
    );
  });
});

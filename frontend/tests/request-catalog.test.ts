import { describe, expect, it } from 'vitest';
import { approvalFromWorkflow, fieldDraftToSchema, hoursToMinutes, keyFromLabel, minutesToHours, newFieldDraft, workflowFromApproval } from '../src/utils/requestCatalog';

describe('horas úteis e minutos', () => {
  it('converte horas para minutos, aceitando vírgula e passos de 0,25h', () => {
    expect(hoursToMinutes(4)).toBe(240);
    expect(hoursToMinutes('0,25')).toBe(15);
    expect(hoursToMinutes('1.5')).toBe(90);
    expect(hoursToMinutes(48)).toBe(2880);
  });
  it('rejeita valores inválidos', () => {
    expect(hoursToMinutes(0)).toBeNull();
    expect(hoursToMinutes('-1')).toBeNull();
    expect(hoursToMinutes('abc')).toBeNull();
    expect(hoursToMinutes('0,1')).toBeNull();
  });
  it('converte minutos para horas', () => {
    expect(minutesToHours(240)).toBe(4);
    expect(minutesToHours(15)).toBe(0.25);
    expect(minutesToHours(2880)).toBe(48);
  });
});

describe('chave do campo a partir do rótulo', () => {
  it('gera snake_case sem acento', () => {
    expect(keyFromLabel('Centro de Custo')).toBe('centro_de_custo');
    expect(keyFromLabel('Descrição do problema')).toBe('descricao_do_problema');
    expect(keyFromLabel('  Valor (R$)  ')).toBe('valor_r');
  });
  it('começa sempre por letra e respeita 40 caracteres', () => {
    expect(keyFromLabel('2ª via')).toBe('campo_2a_via');
    expect(keyFromLabel('x'.repeat(60))).toHaveLength(40);
    expect(keyFromLabel('???')).toBe('');
  });
});

describe('aprovação e campos', () => {
  it('ida e volta do fluxo por níveis, em ordem hierárquica', () => {
    const steps = workflowFromApproval({ ...approvalFromWorkflow([]), mode: 'niveis', levels: ['gerente', 'supervisor'] });
    expect(steps).toEqual([
      { stepOrder: 1, approverRule: 'management_level', requiredLevel: 'supervisor' },
      { stepOrder: 2, approverRule: 'management_level', requiredLevel: 'gerente' },
    ]);
    expect(approvalFromWorkflow(steps).levels).toEqual(['supervisor', 'gerente']);
  });
  it('colaboradores só envia requiredCount em n_de_m', () => {
    const base = { ...approvalFromWorkflow([]), mode: 'colaboradores' as const, collaboratorIds: ['a', 'b'], requiredCount: 2 };
    expect(workflowFromApproval({ ...base, completionRule: 'todos' })[0]).not.toHaveProperty('requiredCount');
    expect(workflowFromApproval({ ...base, completionRule: 'n_de_m' })[0]).toHaveProperty('requiredCount', 2);
  });
  it('fluxo desconhecido é mantido como está', () => {
    const steps = [
      { stepOrder: 1, approverRule: 'gestor_direto' as const },
      { stepOrder: 2, approverRule: 'colaboradores' as const, collaboratorIds: ['a'], completionRule: 'todos' as const },
    ];
    const state = approvalFromWorkflow(steps);
    expect(state.mode).toBe('custom');
    expect(workflowFromApproval(state)).toEqual(steps);
  });
  it('lista de opções vira options sem linhas vazias; fonte vira optionsSource', () => {
    const base = { ...newFieldDraft(), label: 'Tipo', key: 'tipo', type: 'select' as const };
    expect(fieldDraftToSchema({ ...base, optionsText: 'A\n\n B \n' }).options).toEqual(['A', 'B']);
    const fonte = fieldDraftToSchema({ ...base, optionsMode: 'source', optionsSource: 'clients' });
    expect(fonte.optionsSource).toBe('clients');
    expect(fonte.options).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { sla } from './Fulfillment';

describe('sla (prazo da ordem de atendimento)', () => {
  const today = '2026-11-10';
  it('sem prazo não classifica', () => expect(sla({ neededBy: null, status: 'RECEBIDA' }, today)).toBe('none'));
  it('entregue ou encerrada nunca está atrasada', () => {
    expect(sla({ neededBy: '2026-11-01', status: 'ENTREGUE' }, today)).toBe('done');
    expect(sla({ neededBy: '2026-11-01', status: 'ENCERRADA' }, today)).toBe('done');
  });
  it('data passada em andamento é atrasada', () => expect(sla({ neededBy: '2026-11-09T00:00:00.000Z', status: 'EM_SEPARACAO' }, today)).toBe('late'));
  it('hoje e amanhã vencem em breve; depois está no prazo', () => {
    expect(sla({ neededBy: '2026-11-10', status: 'RESERVADA' }, today)).toBe('soon');
    expect(sla({ neededBy: '2026-11-11', status: 'RESERVADA' }, today)).toBe('soon');
    expect(sla({ neededBy: '2026-11-12', status: 'RESERVADA' }, today)).toBe('ok');
  });
  it('cancelada nunca está atrasada', () => expect(sla({ neededBy: '2026-11-01', status: 'CANCELADA' }, today)).toBe('done'));
  it('prazo de hoje não fica atrasado à noite em BRT (padrão usa o dia de São Paulo)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T01:30:00Z')); // 22h30 de 10/11 em São Paulo
    try {
      expect(sla({ neededBy: '2026-11-10T00:00:00.000Z', status: 'EM_SEPARACAO' })).toBe('soon');
    } finally {
      vi.useRealTimers();
    }
  });
});

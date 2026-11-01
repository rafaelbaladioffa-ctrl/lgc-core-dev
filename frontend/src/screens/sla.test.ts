import { describe, expect, it } from 'vitest';
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
});

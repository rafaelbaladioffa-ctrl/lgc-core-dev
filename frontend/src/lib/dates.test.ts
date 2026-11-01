import { describe, expect, it } from 'vitest';
import { dateBr, todaySaoPaulo } from './dates';

describe('todaySaoPaulo (dia de calendário da operação)', () => {
  it('à noite em BRT (já é dia 11 em UTC) continua sendo o dia 10', () => {
    expect(todaySaoPaulo(new Date('2026-11-11T01:30:00Z'))).toBe('2026-11-10');
  });
  it('logo após a meia-noite de BRT já é o dia seguinte', () => {
    expect(todaySaoPaulo(new Date('2026-11-11T03:00:00Z'))).toBe('2026-11-11');
  });
  it('usa formato AAAA-MM-DD', () => {
    expect(todaySaoPaulo(new Date('2026-03-05T15:00:00Z'))).toBe('2026-03-05');
  });
});

describe('dateBr', () => {
  it('converte data DATE serializada em UTC para DD/MM/AAAA', () => {
    expect(dateBr('2026-11-10T00:00:00.000Z')).toBe('10/11/2026');
  });
  it('aceita AAAA-MM-DD puro', () => expect(dateBr('2026-01-02')).toBe('02/01/2026'));
  it('sem valor vira traço', () => {
    expect(dateBr(null)).toBe('—');
    expect(dateBr(undefined)).toBe('—');
  });
});

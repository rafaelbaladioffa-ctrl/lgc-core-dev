import { describe, expect, it } from 'vitest';
import { isOverdueCustody } from './Returns';

describe('isOverdueCustody (termo de custódia atrasado)', () => {
  const today = '2026-11-10';
  it('ativo com devolução anterior a hoje está atrasado', () => {
    expect(isOverdueCustody({ status: 'ATIVO', expectedReturnAt: '2026-11-09T00:00:00.000Z' }, today)).toBe(true);
  });
  it('devolução prevista para hoje ainda não está atrasada', () => {
    expect(isOverdueCustody({ status: 'ATIVO', expectedReturnAt: '2026-11-10T00:00:00.000Z' }, today)).toBe(false);
  });
  it('termo devolvido ou perdido nunca está atrasado', () => {
    expect(isOverdueCustody({ status: 'DEVOLVIDO', expectedReturnAt: '2026-11-01T00:00:00.000Z' }, today)).toBe(false);
    expect(isOverdueCustody({ status: 'PERDIDO', expectedReturnAt: '2026-11-01T00:00:00.000Z' }, today)).toBe(false);
  });
  it('sem data prevista não está atrasado', () => {
    expect(isOverdueCustody({ status: 'ATIVO', expectedReturnAt: null }, today)).toBe(false);
  });
});

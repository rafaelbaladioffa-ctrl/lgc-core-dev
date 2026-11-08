import { describe, expect, it } from 'vitest';
import { axisItemLabel, axisName, type AxisItem } from './lookups';

const item = (over: Partial<AxisItem> = {}): AxisItem => ({ kind: 'PROJECT', id: 'p-1', code: 'PRJ-001', name: 'Data center Sumaré', active: true, ...over });

describe('nomes dos cadastros do Core (cache)', () => {
  it('rótulo "código — nome", só nome ou só código; inativo marcado', () => {
    expect(axisItemLabel(item())).toBe('PRJ-001 — Data center Sumaré');
    expect(axisItemLabel(item({ code: null }))).toBe('Data center Sumaré');
    expect(axisItemLabel(item({ name: null }))).toBe('PRJ-001');
    expect(axisItemLabel(item({ active: false }))).toBe('PRJ-001 — Data center Sumaré (inativo)');
  });

  it('id sem cadastro no cache aparece encurtado e sinalizado; sem id, travessão', () => {
    const m = new Map([['p-1', item()]]);
    expect(axisName(m, 'p-1')).toBe('PRJ-001 — Data center Sumaré');
    expect(axisName(m, '0d1f4c2a-aaaa-bbbb-cccc-1234567890ab')).toBe('0d1f4c2a… (não sincronizado)');
    expect(axisName(m, null)).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import { buildAdjustment } from './StockAdjust';

const bal = { materialId: 'm', locationId: 'l', lotId: null, condition: 'DISPONIVEL', ownership: 'PROPRIO', quantity: '10', reserved: '2' };

describe('buildAdjustment', () => {
  it('zerar com reserva é recusado (não vira saldo abaixo do reservado)', () => {
    const r = buildAdjustment(bal, 'zero', '', 'Contagem', 'APR-1');
    expect('error' in r && r.error).toMatch(/reservado/);
  });
  it('zerar sem reserva gera ajuste negativo do saldo inteiro, sem apagar nada', () => {
    const r = buildAdjustment({ ...bal, reserved: '0' }, 'zero', '', ' Contagem ', 'APR-1');
    expect(r).toEqual({ body: { type: 'AJUSTE_NEGATIVO', fromLocationId: 'l', fromCondition: 'DISPONIVEL', materialId: 'm', quantity: 10, reason: 'Contagem', axisApprovalRef: 'APR-1', ownership: 'PROPRIO' } });
  });
  it('ajustar para mais gera ajuste positivo da diferença; para menos, negativo', () => {
    const up = buildAdjustment(bal, 'set', '12,5', 'Achado', 'APR-1');
    expect('body' in up && up.body).toMatchObject({ type: 'AJUSTE_POSITIVO', toLocationId: 'l', quantity: 2.5 });
    const down = buildAdjustment(bal, 'set', '4', 'Quebra', 'APR-1');
    expect('body' in down && down.body).toMatchObject({ type: 'AJUSTE_NEGATIVO', quantity: 6 });
  });
  it('valida quantidade, igualdade, motivo e aprovação', () => {
    expect('error' in buildAdjustment(bal, 'set', '', 'Motivo', 'A')).toBe(true);
    expect('error' in buildAdjustment(bal, 'set', '10', 'Motivo', 'A')).toBe(true);
    expect('error' in buildAdjustment(bal, 'set', '5', 'x', 'A')).toBe(true);
    expect('error' in buildAdjustment(bal, 'set', '5', 'Motivo', ' ')).toBe(true);
    expect('error' in buildAdjustment(bal, 'set', '1', 'Motivo', 'A')).toBe(true); // abaixo do reservado (2)
  });
  it('mantém o lote do saldo', () => {
    const r = buildAdjustment({ ...bal, lotId: 'lot1', reserved: '0' }, 'zero', '', 'Contagem', 'A');
    expect('body' in r && r.body.lotId).toBe('lot1');
  });
});

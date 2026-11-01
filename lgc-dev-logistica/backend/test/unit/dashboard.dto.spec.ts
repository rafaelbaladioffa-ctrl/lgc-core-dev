import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { KpiQuery } from '../../src/dashboard/dashboard.service.js';

// Filtros do painel de indicadores (sem banco). Replica o ValidationPipe global do app.

const props = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(KpiQuery, body), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);

describe('KpiQuery', () => {
  it('aceita período ISO e ausência de filtros', () => {
    expect(props({})).toEqual([]);
    expect(props({ from: '2026-01-01', to: '2026-01-31' })).toEqual([]);
  });

  it('rejeita datas fora do formato ISO', () => {
    expect(props({ from: '31/12/2026' })).toContain('from');
    expect(props({ to: 'amanha' })).toContain('to');
  });

  it('rejeita almoxarifado que não é UUID', () => {
    expect(props({ warehouseId: 'x' })).toContain('warehouseId');
  });

  it('rejeita campos fora da lista permitida (ex.: filtro por operador)', () => {
    expect(props({ pickedBy: 'x' })).toContain('pickedBy');
    expect(props({ userId: 'x' })).toContain('userId');
  });
});

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListAlertsQuery } from '../../src/alerts/alerts.service.js';

// Filtros de alertas (sem banco). Replica o ValidationPipe global do app.

const props = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(ListAlertsQuery, body), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);

describe('ListAlertsQuery', () => {
  it('aceita cada status, severidade e papel do enum', () => {
    for (const status of ['ABERTO', 'RECONHECIDO', 'RESOLVIDO']) expect(props({ status })).toEqual([]);
    for (const severity of ['INFO', 'ATENCAO', 'CRITICO']) expect(props({ severity })).toEqual([]);
    for (const role of ['ALMOXARIFE', 'GESTOR_ALMOXARIFADO', 'COMPRAS', 'HSE_QUALIDADE', 'CONTROLE_PATRIMONIO', 'ADMIN_TECNICO']) expect(props({ role })).toEqual([]);
  });

  it('rejeita valores fora do enum e campos desconhecidos', () => {
    expect(props({ status: 'FECHADO' })).toContain('status');
    expect(props({ severity: 'ENORME' })).toContain('severity');
    expect(props({ role: 'SUPERVISOR' })).toContain('role');
    expect(props({ kind: 'RUPTURA_PREVISTA' })).toContain('kind');
  });

  it('aceita filtro sem nenhum campo (listagem padrão)', () => {
    expect(props({})).toEqual([]);
  });
});

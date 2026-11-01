import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LabelsService, PrintLabelDto, fmtDate, fmtDateTime } from '../../src/labels/labels.service.js';

// Etiquetas sem banco: DTO de impressão, formatação de datas pt-BR e geração ZPL (método privado, via cast).

const U = '11111111-1111-4111-8111-111111111111';
const dto = (body: Record<string, unknown>) => plainToInstance(PrintLabelDto, { kind: 'LOCATION', refId: U, ...body });
const props = (body: Record<string, unknown>) => validateSync(dto(body), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
const zpl = (label: { kind: 'LOCATION'; title: string; lines: string[]; code: string }) =>
  (new LabelsService({} as never, {} as never) as unknown as { zpl: (l: unknown) => string }).zpl(label);

describe('PrintLabelDto', () => {
  it('copies: aceita de 1 a 100 e recusa 0, 101, decimal e texto', () => {
    expect(props({ copies: 1 })).toEqual([]);
    expect(props({ copies: 100 })).toEqual([]);
    expect(props({ copies: 0 })).toContain('copies');
    expect(props({ copies: 101 })).toContain('copies');
    expect(props({ copies: 2.5 })).toContain('copies');
    expect(props({ copies: 'três' })).toContain('copies');
  });

  it('copies enviado como string da query/JSON é convertido para número', () => {
    expect(dto({ copies: '3' }).copies).toBe(3);
  });

  it('kind e format são enumerados', () => {
    expect(props({ kind: 'BOX' })).toContain('kind');
    expect(props({ format: 'pdf' })).toContain('format');
    expect(props({ format: 'zpl' })).toEqual([]);
  });

  it('reason: curto demais é recusado; até 300 caracteres é aceito', () => {
    expect(props({ reason: 'ab' })).toContain('reason');
    expect(props({ reason: 'x'.repeat(301) })).toContain('reason');
    expect(props({ reason: 'Etiqueta danificada' })).toEqual([]);
  });

  it('lotId opcional, mas quando enviado precisa ser UUID', () => {
    expect(props({ kind: 'MATERIAL', lotId: 'lote-1' })).toContain('lotId');
    expect(props({ kind: 'MATERIAL' })).toEqual([]);
  });
});

describe('formatação pt-BR das etiquetas e documentos', () => {
  it('fmtDate usa DD/MM/AAAA e trata nulo como travessão', () => {
    expect(fmtDate(new Date('2031-05-20T00:00:00Z'))).toBe('20/05/2031');
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
  });

  it('fmtDateTime usa DD/MM/AAAA HH:mm no horário de São Paulo, sem vírgula', () => {
    expect(fmtDateTime(new Date('2026-11-01T17:30:00Z'))).toBe('01/11/2026 14:30');
    expect(fmtDateTime(null)).toBe('—');
  });

  it('fmtDateTime à meia-noite em São Paulo é 00:00 (não 24:00)', () => {
    expect(fmtDateTime(new Date('2026-11-01T03:00:00Z'))).toBe('01/11/2026 00:00');
  });
});

describe('geração ZPL', () => {
  it('começa com ^XA, usa UTF-8 (^CI28) e termina com ^XZ', () => {
    const z = zpl({ kind: 'LOCATION', title: 'A-01', lines: ['Armazém'], code: 'LGC:LOC:X:A-01' });
    expect(z.startsWith('^XA^CI28')).toBe(true);
    expect(z.endsWith('^XZ')).toBe(true);
  });

  it('remove ^ ~ e \\ dos campos de texto para não quebrar o comando ZPL', () => {
    const z = zpl({ kind: 'LOCATION', title: 'M^1~2\\3', lines: ['Peça ^XA ~JA'], code: 'LGC:MAT:M^1' });
    expect(z).toContain('^FDM 1 2 3^FS');
    expect(z).toContain('^FDPeça  XA  JA^FS');
    expect(z).not.toContain('^FDM^1');
  });

  it('preserva acentuação pt-BR no texto dos campos', () => {
    const z = zpl({ kind: 'LOCATION', title: 'FER', lines: ['Furadeira de impacto', 'Condição: BOM', 'Patrimônio: PAT-1'], code: 'LGC:SER:FER:SN1' });
    expect(z).toContain('^FDCondição: BOM^FS');
    expect(z).toContain('^FDPatrimônio: PAT-1^FS');
  });

  // BUG: o ZPL gerado ignora `copies` (falta ^PQn). Impressora de etiquetas imprime 1 cópia mesmo com copies=3.
  // Passos: POST /labels/print {kind: LOCATION, format: zpl, copies: 3} → resposta diz copies 3, mas o ZPL não tem ^PQ3.
  it('o ZPL respeita o número de cópias pedido (^PQ)', async () => {
    const prisma = {
      location: { findUnique: vi.fn().mockResolvedValue({ id: U, code: 'A-01', level: 'AREA', status: 'ATIVO', warehouseId: 'w', warehouse: { code: 'W1', name: 'Central' } }) },
      labelPrint: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'p-1', isReprint: false }) },
    };
    const rbac = { assertWarehouseAccess: vi.fn().mockResolvedValue(undefined) };
    const svc = new LabelsService(prisma as never, rbac as never);
    const out = await svc.print(dto({ format: 'zpl', copies: 3 }) as never, { userId: 'u', permissions: [], roles: [] } as never);
    expect(out.zpl).toMatch(/\^PQ3/);
  });

  it('trunca campos longos em 60 caracteres', () => {
    const z = zpl({ kind: 'LOCATION', title: 'T', lines: ['x'.repeat(100)], code: 'C' });
    expect(z).toContain(`^FD${'x'.repeat(60)}^FS`);
    expect(z).not.toContain('x'.repeat(61));
  });
});

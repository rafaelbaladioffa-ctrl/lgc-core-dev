import { describe, it, expect } from 'vitest';
import { fmtBRL } from './format';

/**
 * O custo chega do backend como string decimal e é omitido por completo de quem não tem
 * `material:read_cost`. O risco aqui é um item sem custo aparecer como R$ 0,00 e ser lido
 * como "de graça" — por isso ausência vira travessão.
 */
/** pt-BR separa "R$" do número com espaço não quebrável (U+00A0), como no formatBRL do Core. */
const BRL = (corpo: string) => `R$ ${corpo}`;

describe('fmtBRL', () => {
  it('formata string decimal no padrão brasileiro', () => {
    expect(fmtBRL('0.24')).toBe(BRL('0,24'));
    expect(fmtBRL('296')).toBe(BRL('296,00'));
    expect(fmtBRL('1234.5')).toBe(BRL('1.234,50'));
  });

  it('aceita número', () => {
    expect(fmtBRL(252)).toBe(BRL('252,00'));
  });

  it('sem custo vira travessão, nunca R$ 0,00', () => {
    expect(fmtBRL(null)).toBe('—');
    expect(fmtBRL(undefined)).toBe('—');
    expect(fmtBRL('')).toBe('—');
    expect(fmtBRL('nao-numero')).toBe('—');
  });

  it('zero de verdade continua sendo zero', () => {
    expect(fmtBRL('0')).toBe(BRL('0,00'));
  });
});

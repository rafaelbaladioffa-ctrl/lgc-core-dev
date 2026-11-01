import { describe, expect, it } from 'vitest';
import { fmtQty, parseQty } from './format';

describe('parseQty — milhar, notação científica e listas', () => {
  it('milhar no formato pt-BR com vírgula decimal', () => {
    expect(parseQty('1.234.567,89')).toBe(1234567.89);
  });
  it('"12.000" sem vírgula é lido com ponto decimal (regra atual, documentada)', () => {
    expect(parseQty('12.000')).toBe(12);
  });
  it('"1,2,3" não vira número (inválido, nunca zero)', () => {
    expect(parseQty('1,2,3')).toBeNull();
  });
  it('notação científica "1e3" é aceita pela conversão numérica (comportamento atual)', () => {
    expect(parseQty('1e3')).toBe(1000);
  });
  it('negativos são lidos como número; a validação de sinal fica no formulário e no backend', () => {
    expect(parseQty('-5')).toBe(-5);
    expect(parseQty('-1,5')).toBe(-1.5);
  });
  it('vazio, só espaços, Infinity e NaN viram null; zero continua zero', () => {
    expect(parseQty('')).toBeNull();
    expect(parseQty('   ')).toBeNull();
    expect(parseQty('Infinity')).toBeNull();
    expect(parseQty('NaN')).toBeNull();
    expect(parseQty('0')).toBe(0);
    expect(parseQty(' 0,0 ')).toBe(0);
  });
  // Bug: quando há vírgula, todos os pontos são removidos como milhar; em "1,000.5" o ponto some e a vírgula vira decimal.
  // Passos: digitar "1,000.5" no campo de quantidade. Esperado: null ou 1000.5. Obtido: 1.0005.
  it.fails('formato americano "1,000.5" não pode ser lido como 1.0005', () => {
    expect(parseQty('1,000.5')).not.toBe(1.0005);
  });
});

describe('fmtQty', () => {
  it('limita casas decimais e usa separador de milhar pt-BR', () => {
    expect(fmtQty('1234.5678')).toBe('1.234,5678');
    expect(fmtQty('1234.56789', 2)).toBe('1.234,57');
    expect(fmtQty(0)).toBe('0');
  });
});

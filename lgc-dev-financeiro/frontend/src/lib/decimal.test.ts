import { decimalToInput, fractionToPercentInput, parseDecimal, parsePercent, shiftDecimal } from './decimal';
import { matchRoute } from './router';

describe('parseDecimal', () => {
  it('aceita o formato brasileiro e o ponto decimal', () => {
    expect(parseDecimal('1.234,56', 2)).toEqual({ ok: true, value: '1234.56' });
    expect(parseDecimal('79,9', 2)).toEqual({ ok: true, value: '79.9' });
    expect(parseDecimal('1.30', 2)).toEqual({ ok: true, value: '1.3' });
    expect(parseDecimal(' 0 ', 2)).toEqual({ ok: true, value: '0' });
    expect(parseDecimal('', 2)).toEqual({ ok: true, value: null });
  });

  it('recusa texto, negativo e casas demais', () => {
    expect(parseDecimal('abc', 2).ok).toBe(false);
    expect(parseDecimal('-5', 2).ok).toBe(false);
    expect(parseDecimal('1,234', 2)).toEqual({ ok: false, error: 'Use no máximo 2 casas decimais.' });
    expect(parseDecimal('2,5', 0)).toEqual({ ok: false, error: 'Use um número inteiro.' });
  });
});

describe('percentual', () => {
  it('converte percentual digitado em fração exata', () => {
    expect(parsePercent('20')).toEqual({ ok: true, value: '0.2' });
    expect(parsePercent('5,8')).toEqual({ ok: true, value: '0.058' });
    expect(parsePercent('0,65')).toEqual({ ok: true, value: '0.0065' });
    expect(parsePercent('100')).toEqual({ ok: true, value: '1' });
    expect(parsePercent('0,00001')).toEqual({ ok: false, error: 'Use no máximo 4 casas decimais no percentual.' });
  });

  it('mostra a fração da API como percentual editável', () => {
    expect(fractionToPercentInput('0.058000')).toBe('5,8');
    expect(fractionToPercentInput('1.000000')).toBe('100');
    expect(fractionToPercentInput('0.0065')).toBe('0,65');
    expect(fractionToPercentInput(null)).toBe('');
  });

  it('desloca a vírgula sem erro de ponto flutuante', () => {
    expect(shiftDecimal('0.07', 2)).toBe('7');
    expect(shiftDecimal('7', -2)).toBe('0.07');
    expect(shiftDecimal('123.45', -2)).toBe('1.2345');
  });
});

describe('decimalToInput', () => {
  it('tira zeros à direita e usa vírgula', () => {
    expect(decimalToInput('1234.5000')).toBe('1234,5');
    expect(decimalToInput('8.00')).toBe('8');
    expect(decimalToInput(null)).toBe('');
  });
});

describe('rotas', () => {
  it('casa caminho com parâmetro', () => {
    expect(matchRoute('/parametros/:id', '/parametros/abc')).toEqual({ id: 'abc' });
    expect(matchRoute('/parametros/:id', '/parametros')).toBeNull();
    expect(matchRoute('/materiais/novo', '/materiais/novo')).toEqual({});
  });
});

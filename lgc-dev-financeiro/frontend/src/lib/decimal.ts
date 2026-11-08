/**
 * Conversão entre o que a pessoa digita (pt-BR: "1.234,56", "20") e o texto decimal da API ("1234.56", "0.2").
 * Só manipula texto — o Financeiro nunca calcula dinheiro no navegador.
 */

export type Parsed = { ok: true; value: string | null } | { ok: false; error: string };

/** Normaliza para "1234.56". Com vírgula, pontos são milhar; sem vírgula, o ponto é decimal. */
function normalize(input: string): string | null {
  const s = input.trim().replace(/\s/g, '');
  if (s === '') return null;
  const n = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return /^\d+(\.\d+)?$/.test(n) ? n : 'invalid';
}

function trimZeros(n: string): string {
  if (!n.includes('.')) return n.replace(/^0+(?=\d)/, '');
  const [i, d] = n.split('.');
  const dec = d.replace(/0+$/, '');
  const int = i.replace(/^0+(?=\d)/, '');
  return dec ? `${int}.${dec}` : int;
}

/** Desloca a vírgula decimal: shift = −2 divide por 100, +2 multiplica por 100. Exato, sem ponto flutuante. */
export function shiftDecimal(n: string, shift: number): string {
  const [i, d = ''] = n.split('.');
  let digits = i + d;
  let point = i.length + shift;
  if (point <= 0) {
    digits = '0'.repeat(1 - point) + digits;
    point = 1;
  }
  if (point > digits.length) digits = digits + '0'.repeat(point - digits.length);
  return trimZeros(`${digits.slice(0, point)}.${digits.slice(point)}`.replace(/\.$/, ''));
}

/** Número digitado → texto da API, com no máximo `scale` casas. Vazio → null. */
export function parseDecimal(input: string, scale: number): Parsed {
  const n = normalize(input);
  if (n === null) return { ok: true, value: null };
  if (n === 'invalid') return { ok: false, error: 'Número inválido.' };
  const value = trimZeros(n);
  const decimals = value.split('.')[1]?.length ?? 0;
  if (decimals > scale) return { ok: false, error: scale === 0 ? 'Use um número inteiro.' : `Use no máximo ${scale} casas decimais.` };
  return { ok: true, value };
}

/** Percentual digitado ("5,8") → fração da API ("0.058"). `scale` = casas da fração. */
export function parsePercent(input: string, scale = 6): Parsed {
  const n = normalize(input);
  if (n === null) return { ok: true, value: null };
  if (n === 'invalid') return { ok: false, error: 'Percentual inválido.' };
  const value = shiftDecimal(trimZeros(n), -2);
  const decimals = value.split('.')[1]?.length ?? 0;
  if (decimals > scale) return { ok: false, error: `Use no máximo ${scale - 2} casas decimais no percentual.` };
  return { ok: true, value };
}

/** Texto da API → campo de edição em pt-BR ("1234.5000" → "1234,5"). */
export function decimalToInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return trimZeros(String(value)).replace('.', ',');
}

/** Fração da API → percentual para edição ("0.058" → "5,8"). */
export function fractionToPercentInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return shiftDecimal(trimZeros(String(value)), 2).replace('.', ',');
}

const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

/** Fração da API → "20,00 %" para leitura. */
export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? pct.format(n) : '—';
}

export function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? num.format(n) : '—';
}

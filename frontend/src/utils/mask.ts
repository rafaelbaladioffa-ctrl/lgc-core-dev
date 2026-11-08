/**
 * Simple pattern-based input mask: '9' in the pattern is a digit placeholder, every other
 * character is a literal inserted automatically as the user types. No external dependency —
 * light enough not to need one, and keeps the mask logic visible/auditable in one place.
 */
export function applyMask(raw: string, pattern: string): string {
  const digits = raw.replace(/\D/g, '');
  let result = '';
  let di = 0;
  for (let i = 0; i < pattern.length && di < digits.length; i++) {
    if (pattern[i] === '9') {
      result += digits[di];
      di++;
    } else {
      result += pattern[i];
    }
  }
  return result;
}

export const MASKS = {
  phone: '(99) 99999-9999',
  rg: '99.999.999-9',
  cpf: '999.999.999-99',
  cnpj: '99.999.999/9999-99',
  ctps: '9999999/9999',
  pis: '999.99999.99-9',
  cep: '99999-999',
  cnhNumber: '99999999999',
} as const;

/**
 * Telefone fixo ou celular: até 10 dígitos usa `(99) 9999-9999`; no 11º passa para o formato de
 * celular. O padrão de fixo tem uma posição a mais para deixar o 11º dígito ser digitado.
 */
export function formatPhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return applyMask(digits, digits.length > 10 ? MASKS.phone : '(99) 9999-99999');
}

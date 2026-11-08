/** Formata progressivamente um telefone brasileiro para "+55 (11) 99999-9999"
 * conforme o usuário digita. Aceita colar um número já com ou sem "+55" —
 * só remove o "55" inicial quando sobra dígito suficiente pra ainda ser um
 * DDD+número válido (evita confundir código de país com DDD 55, que existe
 * de verdade — região de Santa Maria/RS). */
export function formatBrazilPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 11);
  if (!digits) return "";

  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);

  let out = `+55 (${ddd}`;
  if (digits.length >= 2) out += ")";
  if (rest) {
    const splitAt = rest.length > 8 ? 5 : 4;
    out += rest.length > splitAt ? ` ${rest.slice(0, splitAt)}-${rest.slice(splitAt)}` : ` ${rest}`;
  }
  return out;
}

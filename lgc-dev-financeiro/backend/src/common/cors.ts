/** Origens liberadas por CORS (lista separada por vírgula). Vazio = nenhuma origem externa. */
export function corsOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

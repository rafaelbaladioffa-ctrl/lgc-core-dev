export interface PageResult<T> { total: number; items: T[] }

/**
 * Busca todas as páginas de uma listagem paginada no servidor. Usado quando há filtro local
 * (ex.: "somente atrasadas"): filtrar só a página atual deixaria o total e a paginação errados.
 */
export async function fetchAllPages<T>(fetchPage: (page: number) => Promise<PageResult<T>>, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  for (let p = 1; p <= maxPages; p++) {
    const r = await fetchPage(p);
    out.push(...r.items);
    if (out.length >= r.total || r.items.length === 0) break;
  }
  return out;
}

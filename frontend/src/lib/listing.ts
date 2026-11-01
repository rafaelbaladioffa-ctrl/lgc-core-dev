/** Lógica pura de listagens (paginação, filtros e consulta), sem React, para ser testada isoladamente. */

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

/** Página válida dentro do intervalo: se os resultados encolheram (filtro, troca de almoxarifado), volta para a última página. */
export const clampPage = (page: number, total: number, pageSize: number) => Math.min(Math.max(1, page), pageCount(total, pageSize));

/** Intervalo exibido "from–to de total"; vazio mostra 0–0. */
export const pageRange = (page: number, pageSize: number, total: number) => ({
  from: total === 0 ? 0 : (page - 1) * pageSize + 1,
  to: Math.min(total, page * pageSize),
});

export interface MaterialsFilter { page: number; pageSize: number; status: string; q: string; type: string; category: string }

/** Query string de GET /materials. Filtros vazios não são enviados. */
export function materialsQuery(f: MaterialsFilter): string {
  const p = new URLSearchParams({ page: String(f.page), pageSize: String(f.pageSize), status: f.status });
  if (f.q) p.set('q', f.q);
  if (f.type) p.set('type', f.type);
  if (f.category) p.set('category', f.category);
  return p.toString();
}

/** Texto pesquisado de um saldo: código, descrição, endereço e lote. Material ausente do mapa não bloqueia a busca pelos demais campos. */
export function balanceSearchText(b: { locationCode: string; lotNumber: string | null }, m?: { code: string; shortDescription: string }) {
  return `${m?.code ?? ''} ${m?.shortDescription ?? ''} ${b.locationCode} ${b.lotNumber ?? ''}`.toLowerCase();
}

/** Filtra por termo (já com trim) sobre o texto de busca. Termo vazio mantém tudo. */
export function filterBalances<B extends { materialId: string; locationCode: string; lotNumber: string | null }, M extends { code: string; shortDescription: string }>(
  rows: B[], byId: Map<string, M>, term: string,
): B[] {
  const t = term.trim().toLowerCase();
  if (!t) return rows;
  return rows.filter((b) => balanceSearchText(b, byId.get(b.materialId)).includes(t));
}

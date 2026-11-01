import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from './paging';

/** Simula um endpoint paginado com `total` itens e tamanho de página `size`. */
function server(total: number, size: number) {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  return vi.fn(async (page: number) => ({ total, items: all.slice((page - 1) * size, page * size) }));
}

describe('fetchAllPages', () => {
  it('junta todas as páginas até cobrir o total', async () => {
    const fetchPage = server(45, 20);
    const items = await fetchAllPages(fetchPage);
    expect(items).toHaveLength(45);
    expect(items[0]).toBe(1);
    expect(items[44]).toBe(45);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('não pede página extra quando a primeira já traz tudo', async () => {
    const fetchPage = server(5, 100);
    await fetchAllPages(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('para numa página vazia mesmo se o total informado for maior', async () => {
    const fetchPage = vi.fn(async (page: number) => ({ total: 999, items: page === 1 ? [1, 2] : [] }));
    expect(await fetchAllPages(fetchPage)).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('respeita o limite de páginas', async () => {
    const fetchPage = server(1000, 10);
    expect(await fetchAllPages(fetchPage, 3)).toHaveLength(30);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('sem registros retorna lista vazia', async () => {
    expect(await fetchAllPages(server(0, 20))).toEqual([]);
  });
});

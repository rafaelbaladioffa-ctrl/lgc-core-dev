import { translateApiError } from './apiError';

/**
 * Runs one delete call per row with allSettled (not Promise.all) so one failure doesn't stop the
 * rest, then always re-fetches so the table reflects whatever actually got deleted — a
 * Promise.all here previously left failed-and-succeeded rows both showing as "still there" until
 * a manual page reload.
 */
export async function runBulkDelete<T>(
  rows: T[],
  remove: (row: T) => Promise<unknown>,
  refresh: () => Promise<void>,
): Promise<string | null> {
  const results = await Promise.allSettled(rows.map((row) => remove(row)));
  await refresh();
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length === 0) return null;
  const detail = translateApiError(failures[0].reason, 'Não foi possível excluir — verifique se há registros vinculados.');
  return `${failures.length} de ${rows.length} exclusão(ões) falharam. ${detail}`;
}

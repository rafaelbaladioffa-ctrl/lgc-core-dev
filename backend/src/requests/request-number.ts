import type { Prisma } from '@prisma/client';

/**
 * Próximo código `REQ-AAAA-NNNNNN`. O contador é incrementado por `UPDATE ... RETURNING` dentro da
 * transação de quem cria a requisição, então dois pedidos simultâneos nunca recebem o mesmo número.
 * Usado pelo `RequestsService` e pela criação automática do envio de material (aprovação do projeto).
 */
export async function nextRequestCode(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  await tx.$executeRaw`INSERT INTO request_number_counters (year, last_value) VALUES (${year}, 0) ON CONFLICT (year) DO NOTHING`;
  const rows = await tx.$queryRaw<Array<{ last_value: number }>>`UPDATE request_number_counters SET last_value = last_value + 1 WHERE year = ${year} RETURNING last_value`;
  return `REQ-${year}-${String(rows[0].last_value).padStart(6, '0')}`;
}

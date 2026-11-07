import type { Prisma, RequestCategoryKind } from '@prisma/client';

/** Comportamento especial por tipo da categoria — único lugar que decide "é compra" / "é denúncia".
 * Antes isso era decidido por código/nome (`SUP-COMPRA`, `CMP-DENUNCIA`). */
export function isPurchase(category: { kind: RequestCategoryKind }): boolean {
  return category.kind === 'compra_material';
}

export function isWhistleblower(category: { kind: RequestCategoryKind }): boolean {
  return category.kind === 'denuncia';
}

type VersionClient = Pick<Prisma.TransactionClient, 'categoryVersion'>;

/** Maior versão **publicada** da categoria (rascunho nunca é usado por requisições). `null` se
 * a categoria ainda não tem nenhuma. */
export function findLatestPublishedVersion(client: VersionClient, categoryId: string) {
  return client.categoryVersion.findFirst({
    where: { categoryId, status: 'publicada' },
    orderBy: { version: 'desc' },
  });
}

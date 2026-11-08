import type { BudgetRevisionSow } from '@prisma/client';
import { summarizeTypes, totalsOf, type SowCableLine, type SowDevices, type SowHeader } from './sow-parser.js';

/** SOW da revisão como a tela mostra (sem o texto original, que exige budget:write). */
export function presentSow(row: BudgetRevisionSow | null) {
  if (!row) return null;
  const cables = row.cables as unknown as SowCableLine[];
  const types = summarizeTypes(cables);
  return {
    source: row.source as 'core_pdf' | 'texto',
    quoteRequestId: row.quoteRequestId,
    sowDocumentId: row.sowDocumentId,
    sowVersion: row.sowVersion,
    pages: row.pages,
    header: row.header as unknown as SowHeader,
    devices: row.devices as unknown as SowDevices,
    cables,
    edited: JSON.stringify(row.parsedCables) !== JSON.stringify(row.cables),
    types,
    totals: totalsOf(types),
    warnings: row.warnings as unknown as string[],
    importedAt: row.importedAt,
    importedBy: row.importedBy,
    updatedAt: row.updatedAt,
  };
}

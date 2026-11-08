import { BadRequestException } from '@nestjs/common';
import type { BidPlan } from './bid-plan.js';
import { excelDate, XlsxEditor } from './xlsx-editor.js';

const ITEMS = 'Item Selection';
const KPIS = 'Bid KPIs';

export interface BidFillResult {
  content: Buffer;
  filename: string;
  /** Endereços escritos (para conferência e auditoria). */
  writes: Array<{ sheet: string; ref: string; value: string | number }>;
}

/** Fornecedor ainda a escolher: valor digitado "Select" (nas linhas de mão de obra, D é fórmula). */
const isSelect = (c: { v: string | null; f: string | null } | null) => !!c && !c.f && (c.v ?? '').trim().toLowerCase() === 'select';

/**
 * Linha da Item Selection pelo código da coluna C. O mesmo código pode aparecer mais de uma vez (uma linha com
 * fornecedor definido e outra em "Select"): vale a do fornecedor pedido; sem ele, a que já tem fornecedor.
 */
async function rowOf(editor: XlsxEditor, code: string, supplier: string | null | undefined): Promise<{ row: number; needsSupplier: boolean }> {
  const rows = await editor.findRows(ITEMS, 'C', (v) => v.trim() === code);
  if (rows.length === 0) throw new BadRequestException(`A linha "${code}" não existe neste Bid Template. Revise o perfil da Bid.`);
  const withD = await Promise.all(rows.map(async (row) => ({ row, d: await editor.cell(ITEMS, `D${row}`) })));
  const pick =
    (supplier ? withD.find((r) => (r.d?.v ?? '').trim().toLowerCase() === supplier.trim().toLowerCase()) : undefined) ??
    withD.find((r) => !isSelect(r.d)) ??
    withD[0];
  return { row: pick.row, needsSupplier: isSelect(pick.d) };
}

/** Nome do arquivo como a LGC usa: `AAAA-MM-DD_BID_<FBN>_<site>_v<revisão>.xlsm`. */
export function bidFilename(date: string, fbn: string | null, site: string | null, revision: number, fallback: string): string {
  const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');
  return `${date}_BID_${safe(fbn || fallback)}${site ? `_${safe(site)}` : ''}_v${revision}.xlsm`;
}

/** Aplica o plano no Bid Template do RFQ e devolve a planilha preenchida (macros preservadas). */
export async function fillBid(template: Buffer, plan: BidPlan, revisionNumber: number): Promise<BidFillResult> {
  const editor = await XlsxEditor.load(template);
  const writes: BidFillResult['writes'] = [];

  const named = async (name: string, value: string | number) => {
    const { path, ref } = editor.resolveNamed(name);
    await editor.set(path, ref, value);
    writes.push({ sheet: 'Summary', ref, value });
  };
  const h = plan.header;
  await named('rngSummaryVendorName', h.vendorName);
  await named('rngSummaryBidPOC', h.pocName);
  await named('rngSummaryBidEmail', h.pocEmail);
  await named('rngSummaryVendorProposalName', h.proposalName);
  await named('rngSummaryProjectStartDate', excelDate(h.start));
  await named('rngSummaryProjectCompletionDate', excelDate(h.end));
  await named('rngSummarySubmissionDate', excelDate(h.submissionDate));
  await named('rngMfgQuotedLeadTime', h.leadTimeDays);

  const itemsPath = editor.sheetPath(ITEMS);
  for (const line of plan.lines) {
    const { row, needsSupplier } = await rowOf(editor, line.code, line.supplier);
    const cells = { ...line.cells };
    // Linhas de catálogo em "Select" pedem o fornecedor; linhas livres trazem D no próprio plano.
    if (needsSupplier && !line.code.startsWith('free_') && cells.D === undefined) {
      if (!line.supplier) throw new BadRequestException(`A linha "${line.code}" do Bid Template pede o fornecedor; informe-o no perfil da Bid.`);
      cells.D = line.supplier;
    }
    for (const [col, value] of Object.entries(cells)) {
      // Quantidade instalada (S) é fórmula `=O` no modelo; a LGC digita por cima (cabo da AWS, sem custo de material).
      await editor.set(itemsPath, `${col}${row}`, value, { overwriteFormula: col === 'S' });
      writes.push({ sheet: ITEMS, ref: `${col}${row}`, value });
    }
  }

  if (plan.kpiYes.length) {
    const kpiPath = editor.sheetPath(KPIS);
    for (const label of plan.kpiYes) {
      const rows = await editor.findRows(KPIS, 'A', (v) => v.trim() === label);
      if (!rows.length) throw new BadRequestException(`O indicador "${label}" não foi encontrado na aba Bid KPIs.`);
      await editor.set(kpiPath, `F${rows[0]}`, 'Yes');
      writes.push({ sheet: KPIS, ref: `F${rows[0]}`, value: 'Yes' });
    }
  }

  const fbn = await editor.reader.named('rngSummaryFBN');
  const site = await editor.reader.named('rngSummarySite');
  return { content: await editor.save(), filename: bidFilename(h.submissionDate, fbn, site, revisionNumber, h.proposalName), writes };
}

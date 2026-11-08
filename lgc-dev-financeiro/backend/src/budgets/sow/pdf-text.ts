import { BadRequestException } from '@nestjs/common';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** SOWs reais têm até ~25 páginas; o limite evita PDF malicioso ou fora do escopo travar o servidor. */
const MAX_PAGES = 200;

interface TextItem {
  str: string;
  transform: number[];
}

/**
 * Texto do PDF linha a linha (projetos-especificacao §7.1): agrupa os trechos pela coordenada y e ordena
 * por x, como a leitura na tela. Sem OCR: PDF escaneado vira texto vazio e a tela pede para colar o texto.
 */
export async function extractPdfText(content: Buffer): Promise<{ text: string; pages: number }> {
  if (content.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('O arquivo da SOW não é um PDF.');
  let doc;
  try {
    doc = await getDocument({ data: new Uint8Array(content), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  } catch {
    throw new BadRequestException('Não foi possível ler o PDF da SOW. Se ele estiver protegido ou corrompido, cole o texto da SOW.');
  }
  try {
    if (doc.numPages > MAX_PAGES) throw new BadRequestException(`A SOW tem ${doc.numPages} páginas; o limite é ${MAX_PAGES}.`);
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const rows = new Map<number, TextItem[]>();
      for (const item of content.items as TextItem[]) {
        if (typeof item.str !== 'string' || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        const row = rows.get(y) ?? [];
        row.push(item);
        rows.set(y, row);
      }
      out.push(`=== página ${i} ===`);
      for (const y of [...rows.keys()].sort((a, b) => b - a)) {
        const line = rows
          .get(y)!
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((it) => it.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (line) out.push(line);
      }
      page.cleanup();
    }
    return { text: out.join('\n'), pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

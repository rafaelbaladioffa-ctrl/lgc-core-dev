import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import { Workbook } from './bid-template-reader.js';

/**
 * Escrita no Bid Template do RFQ sem regravar a pasta (projetos-especificacao §7.4, prova de 2026-11-08):
 * edita só o XML das células de entrada, mantém o estilo, marca `fullCalcOnLoad` e deixa intactos o projeto
 * VBA, tabelas, nomes, validações e comentários. Bibliotecas que reescrevem o arquivo descartam as macros.
 */

export type CellValue = string | number;

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colNumber(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + col.charCodeAt(i) - 64;
  return n;
}

function splitRef(ref: string): { col: string; row: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Referência inválida: ${ref}`);
  return { col: m[1], row: Number(m[2]) };
}

/** Data `AAAA-MM-DD` → número de série do Excel (dias desde 30/12/1899). */
export function excelDate(isoDate: string): number {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Data inválida: ${isoDate}`);
  return Math.round(t / 86_400_000) + 25569;
}

export class XlsxEditor {
  private readonly dirty = new Map<string, string>();
  private formulasRemoved = false;

  private constructor(
    private readonly zip: JSZip,
    readonly reader: Workbook,
  ) {}

  static async load(content: Buffer): Promise<XlsxEditor> {
    const reader = await Workbook.load(content);
    return new XlsxEditor(await JSZip.loadAsync(content), reader);
  }

  sheetPath(name: string): string {
    const path = this.reader.sheetPaths.get(name);
    if (!path) throw new BadRequestException(`O Bid Template não tem a aba "${name}".`);
    return path;
  }

  /** Intervalo nomeado de uma célula → aba e endereço. */
  resolveNamed(name: string): { path: string; ref: string } {
    const m = this.reader.names.get(name)?.match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)$/);
    if (!m) throw new BadRequestException(`O Bid Template não tem o campo "${name}".`);
    return { path: this.sheetPath(m[1]), ref: `${m[2]}${m[3]}` };
  }

  /** Linhas da aba cujo valor na coluna atende ao filtro (valores em cache, como o Excel salvou). */
  async findRows(sheetName: string, col: string, match: (value: string) => boolean): Promise<number[]> {
    const cells = await this.reader.sheet(this.sheetPath(sheetName));
    const rows: number[] = [];
    for (const [ref, cell] of cells) {
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (m && m[1] === col && cell.v !== null && match(cell.v)) rows.push(Number(m[2]));
    }
    return rows.sort((a, b) => a - b);
  }

  async value(sheetName: string, ref: string): Promise<string | null> {
    return (await this.reader.sheet(this.sheetPath(sheetName))).get(ref)?.v ?? null;
  }

  /** Valor em cache e fórmula (se houver) de uma célula. */
  async cell(sheetName: string, ref: string): Promise<{ v: string | null; f: string | null } | null> {
    return (await this.reader.sheet(this.sheetPath(sheetName))).get(ref) ?? null;
  }

  private async xml(path: string): Promise<string> {
    const cached = this.dirty.get(path);
    if (cached !== undefined) return cached;
    const file = this.zip.file(path);
    if (!file) throw new BadRequestException(`Aba não encontrada no Bid Template: ${path}.`);
    return file.async('string');
  }

  /**
   * Escreve um valor. Célula com fórmula só com `overwriteFormula` (ex.: quantidade instalada da linha de
   * cabo, como a LGC preenche); célula mestra de fórmula compartilhada nunca (quebraria as vizinhas).
   */
  async set(path: string, ref: string, value: CellValue, opts: { overwriteFormula?: boolean } = {}): Promise<void> {
    let xml = await this.xml(path);
    const body = typeof value === 'number' ? `<v>${value}</v>` : `<is><t xml:space="preserve">${escapeXml(value)}</t></is>`;
    const typeAttr = typeof value === 'number' ? '' : ' t="inlineStr"';
    const cellRe = new RegExp(`<c r="${ref}"((?:\\s[^>]*?)?)(?:/>|>([\\s\\S]*?)</c>)`);
    const found = xml.match(cellRe);
    if (found) {
      const inner = found[2] ?? '';
      const formula = inner.match(/<f\b[^>]*>/) ?? inner.match(/<f\b[^>]*\/>/);
      if (formula) {
        if (!opts.overwriteFormula) throw new BadRequestException(`A célula ${ref} do Bid Template tem fórmula e não pode ser preenchida.`);
        if (/t="shared"/.test(formula[0]) && /\sref="/.test(formula[0])) {
          throw new BadRequestException(`A célula ${ref} do Bid Template é a base de uma fórmula compartilhada; use o modelo original do RFQ.`);
        }
        this.formulasRemoved = true;
      }
      const attrs = found[1].replace(/\s+t="[^"]*"/, '');
      xml = xml.replace(cellRe, () => `<c r="${ref}"${attrs}${typeAttr}>${body}</c>`);
    } else {
      const { col, row } = splitRef(ref);
      const rowRe = new RegExp(`<row r="${row}"([^>]*?)(?:/>|>([\\s\\S]*?)</row>)`);
      const rowMatch = xml.match(rowRe);
      if (!rowMatch) throw new BadRequestException(`A linha ${row} não existe no Bid Template.`);
      const cells = rowMatch[2] ?? '';
      const newCell = `<c r="${ref}"${typeAttr}>${body}</c>`;
      // Insere na ordem das colunas: o Excel recusa células fora de ordem.
      let insertAt = cells.length;
      for (const m of cells.matchAll(/<c r="([A-Z]+)\d+"/g)) {
        if (colNumber(m[1]) > colNumber(col)) {
          insertAt = m.index!;
          break;
        }
      }
      const nextCells = cells.slice(0, insertAt) + newCell + cells.slice(insertAt);
      xml = xml.replace(rowRe, () => `<row r="${row}"${rowMatch[1].replace(/\/$/, '')}>${nextCells}</row>`);
    }
    this.dirty.set(path, xml);
  }

  async setNamed(name: string, value: CellValue): Promise<void> {
    const { path, ref } = this.resolveNamed(name);
    await this.set(path, ref, value);
  }

  async save(): Promise<Buffer> {
    for (const [path, xml] of this.dirty) this.zip.file(path, xml);
    const wbPath = 'xl/workbook.xml';
    const wb = await this.zip.file(wbPath)!.async('string');
    const withCalc = /<calcPr\b/.test(wb)
      ? wb.replace(/<calcPr([^>]*?)\/?>/, (_m, a: string) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`)
      : wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    this.zip.file(wbPath, withCalc);
    if (this.formulasRemoved && this.zip.file('xl/calcChain.xml')) {
      // A cadeia de cálculo citaria células que não têm mais fórmula; o Excel a refaz ao abrir.
      this.zip.remove('xl/calcChain.xml');
      const rels = await this.zip.file('xl/_rels/workbook.xml.rels')?.async('string');
      if (rels) this.zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>/, ''));
      const types = await this.zip.file('[Content_Types].xml')?.async('string');
      if (types) this.zip.file('[Content_Types].xml', types.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
    }
    return this.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}

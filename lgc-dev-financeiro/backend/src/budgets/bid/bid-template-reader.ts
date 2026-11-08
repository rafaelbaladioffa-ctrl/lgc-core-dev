import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

/**
 * Leitura das metas do Bid Template do RFQ (projetos-especificacao §7.3). O modelo traz, por cluster, as
 * metas de custo por porta, horas por porta/metro/dispositivo e custo de mão de obra por porta (em USD), o
 * câmbio por moeda, os pesos das horas-meta e as tolerâncias dos indicadores. Nada é endereço fixo: as
 * tabelas são achadas pelo nome e as células da proposta pelos intervalos nomeados. Se o formato mudar, vale
 * o padrão da versão 3.26 e a leitura avisa.
 */

export interface BidTargets {
  templateVersion: string | null;
  cluster: string | null;
  currency: string | null;
  /** Unidades da moeda da proposta por 1 USD. */
  fx: number | null;
  targets: {
    costPerPortUsd: number | null;
    hoursPerPort: number | null;
    hoursPerMeter: number | null;
    laborCostPerPortUsd: number | null;
    hoursPerDevice: number | null;
  };
  /** Metas de custo já na moeda da proposta (USD × câmbio), como a aba Bid KPIs calcula. */
  converted: { costPerPort: number | null; laborCostPerPort: number | null };
  weights: { meters: number; ports: number; devices: number };
  /** Desvio máximo aceito sem justificativa (fração; eficiência é o mínimo, negativo). */
  thresholds: { efficiency: number; costPerPort: number; laborCostPerPort: number; hoursPerPort: number; hoursPerMeter: number };
  warnings: string[];
}

export const DEFAULT_WEIGHTS = { meters: 0.4, ports: 0.6, devices: 1 };
export const DEFAULT_THRESHOLDS = { efficiency: -0.15, costPerPort: 0.1, laborCostPerPort: 0.15, hoursPerPort: 0.25, hoursPerMeter: 0.25 };

type Cell = { v: string | null; f: string | null };
type Sheet = Map<string, Cell>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#t',
  isArray: (n) => ['si', 'r', 'row', 'c', 'sheet', 'Relationship', 'definedName', 'tableColumn'].includes(n),
});

/** Texto de um nó do XML: valor simples ou `#t` quando o nó tem atributos (ex.: `xml:space`). */
const text = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (node && typeof node === 'object') return text((node as Record<string, unknown>)['#t']);
  return '';
};

function colRow(ref: string): { col: string; row: number } {
  const m = ref.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Referência inválida: ${ref}`);
  return { col: m[1], row: Number(m[2]) };
}

/** Coluna em letras (só A–Z) → número. */
const colNumber = (col: string) => {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + col.charCodeAt(i) - 64;
  return n;
};
const colLetter = (n: number): string => (n <= 0 ? '' : colLetter(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));

export class Workbook {
  private sheetCache = new Map<string, Sheet>();
  private constructor(
    private readonly zip: JSZip,
    private readonly strings: string[],
    /** nome da aba → caminho do XML */
    readonly sheetPaths: Map<string, string>,
    readonly names: Map<string, string>,
  ) {}

  static async load(content: Buffer): Promise<Workbook> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(content);
    } catch {
      throw new BadRequestException('O Bid Template não é uma planilha válida (.xlsx/.xlsm).');
    }
    const read = async (p: string) => (zip.file(p) ? zip.file(p)!.async('string') : null);
    const wbXml = await read('xl/workbook.xml');
    const relsXml = await read('xl/_rels/workbook.xml.rels');
    if (!wbXml || !relsXml) throw new BadRequestException('O Bid Template não é uma planilha válida (.xlsx/.xlsm).');
    const wb = parser.parse(wbXml).workbook;
    const rels = parser.parse(relsXml).Relationships.Relationship as Array<{ Id: string; Target: string }>;
    const sheetPaths = new Map<string, string>();
    for (const s of wb.sheets.sheet as Array<{ name: string; 'r:id': string }>) {
      const rel = rels.find((r) => r.Id === s['r:id']);
      if (rel) sheetPaths.set(s.name, `xl/${rel.Target.replace(/^\/?xl\//, '')}`);
    }
    const names = new Map<string, string>();
    for (const d of (wb.definedNames?.definedName ?? []) as Array<{ name: string; '#t'?: string }>) {
      if (!names.has(d.name) && d['#t']) names.set(d.name, String(d['#t']));
    }
    const ssXml = await read('xl/sharedStrings.xml');
    const si = ssXml ? ((parser.parse(ssXml).sst?.si ?? []) as Array<Record<string, unknown>>) : [];
    const strings = si.map((s) => (s.t !== undefined ? text(s.t) : ((s.r ?? []) as Array<Record<string, unknown>>).map((r) => text(r.t)).join('')));
    return new Workbook(zip, strings, sheetPaths, names);
  }

  async sheet(path: string): Promise<Sheet> {
    const cached = this.sheetCache.get(path);
    if (cached) return cached;
    const xml = await this.zip.file(path)?.async('string');
    const cells: Sheet = new Map();
    if (xml) {
      const rows = (parser.parse(xml).worksheet?.sheetData?.row ?? []) as Array<{ c?: Array<Record<string, unknown>> }>;
      for (const row of rows) {
        for (const c of row.c ?? []) {
          let v: string | null = c.v !== undefined ? text(c.v) : c.is !== undefined ? text((c.is as Record<string, unknown>).t) : null;
          if (c.t === 's' && v !== null) v = this.strings[Number(v)] ?? null;
          cells.set(String(c.r), { v, f: c.f !== undefined ? text(c.f) : null });
        }
      }
    }
    this.sheetCache.set(path, cells);
    return cells;
  }

  /** Valor (em cache) de um intervalo nomeado de uma célula, ex.: `Summary!$B$35`. */
  async named(name: string): Promise<string | null> {
    const ref = this.names.get(name);
    const m = ref?.match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)$/);
    if (!m) return null;
    const path = this.sheetPaths.get(m[1]);
    if (!path) return null;
    return (await this.sheet(path)).get(`${m[2]}${m[3]}`)?.v ?? null;
  }

  /** Tabela do Excel pelo nome: linhas como objetos pela linha de cabeçalho, e a aba onde está. */
  async table(name: string): Promise<{ rows: Array<Record<string, string | null>>; sheetPath: string } | null> {
    for (const f of Object.keys(this.zip.files).filter((p) => /^xl\/tables\/table\d+\.xml$/.test(p))) {
      const t = parser.parse(await this.zip.file(f)!.async('string')).table;
      if (t?.name !== name && t?.displayName !== name) continue;
      const sheetPath = await this.sheetOfTable(f.split('/').pop()!);
      if (!sheetPath) return null;
      const cells = await this.sheet(sheetPath);
      const [from, to] = String(t.ref).split(':').map(colRow);
      const headers = ((t.tableColumns?.tableColumn ?? []) as Array<{ name: string }>).map((c) => c.name);
      const rows: Array<Record<string, string | null>> = [];
      for (let r = from.row + 1; r <= to.row; r++) {
        const row: Record<string, string | null> = {};
        headers.forEach((h, i) => (row[h] = cells.get(`${colLetter(colNumber(from.col) + i)}${r}`)?.v ?? null));
        rows.push(row);
      }
      return { rows, sheetPath };
    }
    return null;
  }

  private async sheetOfTable(tableFile: string): Promise<string | null> {
    for (const [, path] of this.sheetPaths) {
      const rels = await this.zip.file(path.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels'))?.async('string');
      if (rels && rels.includes(`tables/${tableFile}"`)) return path;
    }
    return null;
  }
}

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Pesos da fórmula de horas-meta: `a*(…)+b*(…)+c*(…)` dentro de um IFERROR na aba das metas. */
export function parseWeights(formulas: string[]): { meters: number; ports: number; devices: number } | null {
  for (const f of formulas) {
    const m = f.replace(/\s/g, '').match(/^IFERROR\(([\d.]+)\*\(\w+\*\w+\)\+([\d.]+)\*\(\w+\*\w+\)\+([\d.]+)\*\(\w+\*\w+\),""\)$/i);
    if (m) return { meters: Number(m[1]), ports: Number(m[2]), devices: Number(m[3]) };
  }
  return null;
}

/** Tolerâncias das validações (`D16>0.1` … "CPP for this bid is >10%"). */
export function parseThresholds(formulas: string[]): Partial<BidTargets['thresholds']> {
  const out: Partial<BidTargets['thresholds']> = {};
  const keys: Array<[RegExp, keyof BidTargets['thresholds']]> = [
    [/Efficiency for this bid/i, 'efficiency'],
    [/"CPP for this bid/i, 'costPerPort'],
    [/LCPP for this bid/i, 'laborCostPerPort'],
    [/HPP for this bid/i, 'hoursPerPort'],
    [/HPM for this bid/i, 'hoursPerMeter'],
  ];
  for (const f of formulas) {
    const key = keys.find(([re]) => re.test(f))?.[1];
    const m = f.match(/D\d+([<>])(-?[\d.]+)/);
    if (key && m) out[key] = Number(m[2]);
  }
  return out;
}

export async function readBidTargets(content: Buffer): Promise<BidTargets> {
  const wb = await Workbook.load(content);
  const warnings: string[] = [];
  const cluster = (await wb.named('rngSummaryCluster'))?.trim() || null;
  const currency = (await wb.named('rngSummaryCurrency'))?.trim() || null;
  const templateVersion = await wb.named('rngSummaryVersion');
  if (!cluster) warnings.push('Cluster do projeto não encontrado no Bid Template.');
  if (!currency) warnings.push('Moeda da proposta não encontrada no Bid Template.');

  const targetsTable = await wb.table('Table8');
  const row = targetsTable?.rows.find((r) => (r.Cluster_List ?? '').trim() === cluster) ?? null;
  if (!targetsTable) warnings.push('Tabela de metas por cluster não encontrada no Bid Template.');
  else if (cluster && !row) warnings.push(`O Bid Template não tem metas para o cluster ${cluster}.`);
  const targets = {
    costPerPortUsd: num(row?.CPP_Target),
    hoursPerPort: num(row?.HPP_Target),
    hoursPerMeter: num(row?.HPM_Target),
    laborCostPerPortUsd: num(row?.LCPP_Target),
    hoursPerDevice: num(row?.HPD_Target),
  };

  const fxTable = await wb.table('Table12');
  const fx = num(fxTable?.rows.find((r) => (r.Currency ?? '').trim() === currency)?.FX);
  if (currency && fx === null) warnings.push(`Câmbio de ${currency} não encontrado no Bid Template; metas de custo ficam sem conversão.`);

  const formulas = targetsTable ? [...(await wb.sheet(targetsTable.sheetPath)).values()].map((c) => c.f).filter((f): f is string => !!f) : [];
  const weights = parseWeights(formulas);
  if (!weights) warnings.push('Pesos das horas-meta não encontrados; usado o padrão do modelo 3.26 (0,4 metros, 0,6 portas, 1 dispositivo).');
  const thresholds = { ...DEFAULT_THRESHOLDS, ...parseThresholds(formulas) };
  if (Object.keys(parseThresholds(formulas)).length < 5) warnings.push('Nem todas as tolerâncias dos indicadores foram encontradas; usado o padrão do modelo 3.26.');

  const conv = (usd: number | null) => (usd !== null && fx !== null ? Math.round(usd * fx * 10000) / 10000 : null);
  return {
    templateVersion: templateVersion ? String(templateVersion) : null,
    cluster,
    currency,
    fx,
    targets,
    converted: { costPerPort: conv(targets.costPerPortUsd), laborCostPerPort: conv(targets.laborCostPerPortUsd) },
    weights: weights ?? DEFAULT_WEIGHTS,
    thresholds,
    warnings,
  };
}

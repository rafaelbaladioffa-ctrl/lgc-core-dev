/**
 * Leitura do texto da SOW do cliente AWS (projetos-especificacao §7.1). Função pura: recebe o texto já
 * extraído do PDF (ou colado) e devolve cabeçalho, racks e cabos. Conferida em 2026-11-08 com duas SOWs
 * reais (fora do Git); os testes usam textos fictícios nos mesmos formatos.
 *
 * Formatos de cabos aceitos:
 *  1. Tabela de resumo `Cable Types:` / `Type Length Quantity` → fonte das quantidades quando existe.
 *  2. Linhas de conexão `--- 3x 36F LC-LC (34m) from A to B` ou `8x 8F MPO-4LC A <> B - 35m`.
 */

export type PlatformMention = 'pedida' | 'nao_precisa' | 'nao_mencionada';
export type CableKind = 'fibra' | 'cobre' | 'outro';

export interface SowHeader {
  sowType: string | null;
  projectType: string | null;
  fbn: string | null;
  sites: string | null;
  projectName: string | null;
  spsProjectId: string | null;
  sowUid: string | null;
  /** Como está na SOW (`AAAA-MM-DD HH:MM:SS`, horário informado pelo cliente). */
  walkthroughAt: string | null;
  bidDueAt: string | null;
  /** `AAAA-MM-DD` */
  poDate: string | null;
  startDate: string | null;
  endDate: string | null;
  contacts: { primary: string | null; secondary: string | null; team: string | null };
  platform: PlatformMention;
}

export interface SowDevices {
  /** Racks/dispositivos listados, com faixas `r[1-16]` expandidas. */
  total: number;
  live: number;
  notLive: number;
}

/** Uma linha por tipo de cabo e comprimento. */
export interface SowCableLine {
  /** Tipo normalizado (pontas em ordem alfabética: `8F 4LC-MPO` = `8F MPO-4LC`). */
  type: string;
  kind: CableKind;
  /** Fibras por cabo (0 no cobre). */
  fibers: number;
  lengthM: number;
  quantity: number;
}

export interface SowCableType {
  type: string;
  kind: CableKind;
  fibers: number;
  quantity: number;
  meters: number;
  /** `round(metros / quantidade)`, como a planilha da LGC (§7.2). */
  averageLengthM: number;
  /** `quantidade × fibras / 2` (cobre: 0). */
  ports: number;
}

export interface SowParseResult {
  header: SowHeader;
  devices: SowDevices;
  cableSource: 'resumo' | 'conexoes' | 'nenhum';
  cables: SowCableLine[];
  types: SowCableType[];
  totals: { cables: number; meters: number; ports: number };
  warnings: string[];
}

const FOOTER = [/^Note: This SOW is .*Confidential/i, /^disclosed, in whole or in part/i, /^=== p[aá]gina \d+ ===$/i];

/** Linhas úteis: sem rodapé repetido, sem marcadores de página, sem o histórico de revisões do cliente. */
export function cleanLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || FOOTER.some((re) => re.test(line))) continue;
    if (/^REVISION HISTORY\b/i.test(line)) break; // valores antigos de datas e contatos ficam depois daqui
    lines.push(line);
  }
  return lines;
}

const DATE = /(\d{4}-\d{2}-\d{2})/;
const DATETIME = /(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?)/;

function field(lines: string[], label: RegExp): string | null {
  for (const l of lines) {
    const m = l.match(label);
    if (m) {
      const v = l.slice(m.index! + m[0].length).trim();
      return v || null;
    }
  }
  return null;
}

function dated(lines: string[], label: RegExp, re: RegExp): string | null {
  const v = field(lines, label);
  return v?.match(re)?.[1] ?? null;
}

function platformMention(text: string): PlatformMention {
  const m = text.match(/(?:MEWP|Mobile Elevating Work(?:ing)? Platform|scissor lift|elevating platform)[^.\n]*(?:\n[^.\n]*)?/i);
  if (!m) return 'nao_mencionada';
  if (/\b(is not|not be|no)\s+(required|needed)|\bnot required\b/i.test(m[0])) return 'nao_precisa';
  if (/\b(required|needed|must)\b/i.test(m[0])) return 'pedida';
  return 'nao_mencionada';
}

export function parseHeader(lines: string[]): SowHeader {
  return {
    sowType: field(lines, /^SOW Type:/i),
    projectType: field(lines, /^Project Type:/i),
    fbn: field(lines, /^FBN:/i),
    sites: field(lines, /^Project Site\(s\):/i),
    projectName: field(lines, /^Project Name:/i),
    spsProjectId: field(lines, /^SPS Project ID:/i),
    sowUid: field(lines, /^SOW UID:/i),
    walkthroughAt: dated(lines, /^(?:\d+\.\s*)?Vendor Walkthrough Date:/i, DATETIME),
    bidDueAt: dated(lines, /^(?:\d+\.\s*)?Bid Submission Due Date:/i, DATETIME),
    poDate: dated(lines, /^(?:\d+\.\s*)?Estimated AWS PO Generation Date:/i, DATE),
    startDate: dated(lines, /^(?:\d+\.\s*)?Expected Cabling Start Date:/i, DATE),
    endDate: dated(lines, /^(?:\d+\.\s*)?Expected Cabling Completion Date:/i, DATE),
    contacts: {
      primary: field(lines, /^AWS Primary POC Email:/i),
      secondary: field(lines, /^AWS Secondary POC Email:/i),
      team: field(lines, /^AWS Team Email:/i),
    },
    platform: platformMention(lines.join('\n')),
  };
}

/** `host-r[1-16]` conta 16; nome sem faixa conta 1. */
export function expandCount(host: string): number {
  let count = 1;
  for (const m of host.matchAll(/\[(\d+)-(\d+)\]/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (b >= a) count *= b - a + 1;
  }
  return count;
}

export function parseDevices(lines: string[]): SowDevices {
  const out = { total: 0, live: 0, notLive: 0 };
  for (const l of lines) {
    // Formato 1: `host -- local -- Live, In scope` / `Not live, In scope`
    let m = l.match(/^(\S+)\s+--\s+\S+\s+--\s+(Live|Not live)\b/i);
    // Formato 2: tabela `Devices host local Live|Not Live`
    if (!m) m = l.match(/^(?:Devices|Racks?|Loose Gear)\s+(\S+)\s+\S+\s+(Live|Not Live)$/i);
    if (!m) continue;
    const n = expandCount(m[1]);
    out.total += n;
    if (/^not/i.test(m[2])) out.notLive += n;
    else out.live += n;
  }
  return out;
}

/** Tipo normalizado: fibra `<n>F A-B` com as pontas em ordem; cobre `Cat6 <cor>`. */
export function normalizeType(raw: string): { type: string; kind: CableKind; fibers: number } {
  const t = raw.replace(/\s+/g, ' ').trim();
  const fiber = t.match(/^(\d+)\s*F\s+([A-Z0-9]+)\s*-\s*([A-Z0-9]+)$/i);
  if (fiber) {
    const ends = [fiber[2].toUpperCase(), fiber[3].toUpperCase()].sort();
    return { type: `${Number(fiber[1])}F ${ends[0]}-${ends[1]}`, kind: 'fibra', fibers: Number(fiber[1]) };
  }
  const copper = t.match(/^Cat\s?(5e|6a|6|7)\b\s*(.*)$/i);
  if (copper) {
    const color = copper[2].trim().toLowerCase();
    return { type: `Cat${copper[1].toLowerCase()}${color ? ` ${color}` : ''}`, kind: 'cobre', fibers: 0 };
  }
  return { type: t, kind: 'outro', fibers: 0 };
}

const num = (v: string) => Number(v.replace(',', '.'));

/** Trecho `Connections & Cable Types:` até as diretrizes gerais da AWS. */
function cableSection(lines: string[]): string[] {
  const start = lines.findIndex((l) => /^Connections & Cable Types:?/i.test(l));
  if (start < 0) return lines;
  const end = lines.findIndex((l, i) => i > start && /^AWS STANDARD GUIDELINES/i.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

function summaryTable(section: string[]): SowCableLine[] | null {
  const start = section.findIndex((l) => /^Cable Types:?$/i.test(l));
  if (start < 0) return null;
  const rows: SowCableLine[] = [];
  for (const l of section.slice(start + 1)) {
    if (/^Connections:?$/i.test(l)) break;
    if (/^Type\s+Length\s+Quantity$/i.test(l)) continue;
    const m = l.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*m\s+(\d+)$/i);
    if (!m) continue;
    rows.push({ ...normalizeType(m[1]), lengthM: num(m[2]), quantity: Number(m[3]) });
  }
  return rows.length ? rows : null;
}

const CONNECTION_FROM = /^-*\s*(\d+)\s*x\s+(.+?)\s+\((\d+(?:[.,]\d+)?)\s*m\)\s+from\b/i;
const CONNECTION_ARROW = /^-*\s*(\d+)\s*x\s+(.+?)\s+\S+\s+<>\s+\S+\s+-\s+(\d+(?:[.,]\d+)?)\s*m\b/i;

function connections(section: string[], warnings: string[]): SowCableLine[] {
  const rows: SowCableLine[] = [];
  for (const l of section) {
    const m = l.match(CONNECTION_FROM) ?? l.match(CONNECTION_ARROW);
    if (m) {
      rows.push({ ...normalizeType(m[2]), lengthM: num(m[3]), quantity: Number(m[1]) });
    } else if (/^-*\s*\d+\s*x\s+\S/i.test(l)) {
      warnings.push(`Linha de cabo não reconhecida: "${l.slice(0, 120)}"`);
    }
  }
  return rows;
}

/** Soma linhas iguais (mesmo tipo e comprimento). */
function aggregate(rows: SowCableLine[]): SowCableLine[] {
  const map = new Map<string, SowCableLine>();
  for (const r of rows) {
    const key = `${r.type}|${r.lengthM}`;
    const cur = map.get(key);
    if (cur) cur.quantity += r.quantity;
    else map.set(key, { ...r });
  }
  return [...map.values()].sort((a, b) => a.type.localeCompare(b.type) || a.lengthM - b.lengthM);
}

/** Por tipo: quantidade, metros, comprimento médio e portas (§7.2). */
export function summarizeTypes(lines: SowCableLine[]): SowCableType[] {
  const map = new Map<string, SowCableType>();
  for (const l of lines) {
    const cur = map.get(l.type) ?? { type: l.type, kind: l.kind, fibers: l.fibers, quantity: 0, meters: 0, averageLengthM: 0, ports: 0 };
    cur.quantity += l.quantity;
    cur.meters += l.quantity * l.lengthM;
    map.set(l.type, cur);
  }
  return [...map.values()].map((t) => ({
    ...t,
    meters: Math.round(t.meters * 100) / 100,
    averageLengthM: t.quantity ? Math.round(t.meters / t.quantity) : 0,
    ports: t.kind === 'fibra' ? (t.quantity * t.fibers) / 2 : 0,
  }));
}

export function totalsOf(types: SowCableType[]) {
  return {
    cables: types.reduce((s, t) => s + t.quantity, 0),
    meters: Math.round(types.reduce((s, t) => s + t.meters, 0) * 100) / 100,
    ports: types.reduce((s, t) => s + t.ports, 0),
  };
}

export function parseSow(text: string): SowParseResult {
  const lines = cleanLines(text);
  const warnings: string[] = [];
  const header = parseHeader(lines);
  const devices = parseDevices(lines);
  const section = cableSection(lines);
  const summary = summaryTable(section);
  const conn = aggregate(connections(section, warnings));

  let cables: SowCableLine[];
  let cableSource: SowParseResult['cableSource'];
  if (summary) {
    cables = aggregate(summary);
    cableSource = 'resumo';
    const fromConn = conn.reduce((s, c) => s + c.quantity, 0);
    const fromSummary = cables.reduce((s, c) => s + c.quantity, 0);
    if (conn.length && fromConn !== fromSummary) {
      warnings.push(`A tabela de resumo soma ${fromSummary} cabos e as conexões listadas somam ${fromConn}. Valeu a tabela de resumo; confira com o cliente.`);
    }
  } else {
    cables = conn;
    cableSource = conn.length ? 'conexoes' : 'nenhum';
  }

  if (!header.fbn) warnings.push('FBN não encontrado.');
  if (!header.sowUid) warnings.push('SOW UID não encontrado.');
  if (!header.startDate || !header.endDate) warnings.push('Início ou conclusão do cabeamento não encontrados.');
  if (cableSource === 'nenhum') warnings.push('Nenhum cabo encontrado na SOW. Inclua as linhas à mão.');
  if (cables.some((c) => c.kind === 'outro')) warnings.push('Há tipos de cabo não reconhecidos; confira as linhas marcadas como "outro".');

  const types = summarizeTypes(cables);
  return { header, devices, cableSource, cables, types, totals: totalsOf(types), warnings };
}

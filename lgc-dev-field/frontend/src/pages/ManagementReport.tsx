import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type {
  ManagementBucket,
  ManagementGroup,
  ManagementReport,
  ManagementSummary,
  ReportsActivityProductivity,
} from "../api/types";
import DateRangeCalendar, { type DateRange } from "../components/ui/DateRangeCalendar";
import Icon from "../components/ui/Icon";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import PageHeader from "../components/ui/PageHeader";
import { useI18n, usePageText } from "../i18n";
import { brazilDaysAgoIso, brazilTodayIso, daysInclusive, formatIsoDate } from "../utils/date";

// ---------------------------------------------------------------------------
// Relatório gerencial — slides 16:9 (1280×720 px = 13,333×7,5 in, o tamanho
// exato da página de impressão), exportados em PDF pelo diálogo de impressão.
// Dados: GET /api/operations/reports/management/ (api/management_report.py).
// ---------------------------------------------------------------------------

const SLIDE_W = 1280;
const SLIDE_H = 720;
const MAX_PERIOD_DAYS = 180;
const PERIOD_PRESETS = [7, 30, 90] as const;
const TECHS_PER_RANKING_SLIDE = 8;
const TECHS_PER_HEATMAP_SLIDE = 12;
const PRINT_BODY_CLASS = "mgr-printing";

// Paleta fixa (clara) — o slide é sempre impresso em fundo branco, mesmo no tema escuro.
const C = {
  text: "#111820",
  muted: "#6b7a90",
  faint: "#9aa3b2",
  border: "#e8edf2",
  grid: "#e8edf2",
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
  purple: "#7c3aed",
  blue: "#2563eb",
  orange: "#f16023",
  navy: "#1a2030",
  gray: "#cbd2dc",
} as const;

const SITE_COLORS = [C.blue, C.orange, C.green, C.purple, C.amber, "#0f766e", "#db2777", "#475569"];

type Band = "low" | "attention" | "normal" | "suspect";

function bandOf(pct: number | null): Band | null {
  if (pct === null) return null;
  if (pct > 100) return "suspect";
  if (pct >= 70) return "normal";
  if (pct >= 50) return "attention";
  return "low";
}

const BAND_COLOR: Record<Band, string> = { low: C.red, attention: C.amber, normal: C.green, suspect: C.purple };

function bandColor(pct: number | null): string {
  const b = bandOf(pct);
  return b ? BAND_COLOR[b] : C.gray;
}

const TEXT = {
  "pt-BR": {
    eyebrow: "Central de Operações",
    title: "Relatório Gerencial",
    subtitle: "Comparativo de desempenho entre técnicos, sites e períodos",
    voltar: "Relatórios e Indicadores",
    todosSites: "Todos os sites",
    filtroSite: "Filtrar por site",
    agrupar: "Agrupar por",
    auto: "Automático",
    day: "Dia",
    week: "Semana",
    month: "Mês",
    preset: (d: number) => `${d} dias`,
    exportarPdf: "Exportar PDF",
    dicaPdf: "No diálogo de impressão escolha “Salvar como PDF” e desative “Cabeçalhos e rodapés”.",
    carregando: "Montando o relatório…",
    erro: "Não foi possível carregar o relatório.",
    tentarNovamente: "Tentar novamente",
    semDados: "Sem dados no período selecionado.",
    geradoEm: "Gerado em",
    pagina: (n: number, total: number) => `${n} / ${total}`,
    periodoAtual: "Período atual",
    periodoAnterior: "Período anterior",
    vsAnterior: "vs. período anterior",
    // slide 1
    slideResumo: "Resumo executivo",
    kUtilizacao: "Utilização",
    kProdutivas: "Horas produtivas",
    kHH: "Homem-hora (HH)",
    kBloqueio: "Bloqueio externo",
    kOcioso: "Ocioso interno",
    kConcluidas: "Tarefas concluídas",
    kTecnicos: "Técnicos ativos",
    kRastreamento: "Rastreamento",
    jornadaDe: (h: string) => `de ${h} de jornada`,
    destaques: "Destaques do período",
    melhorTecnico: (n: string, p: number) => `Maior utilização: ${n} (${p}%)`,
    piorTecnico: (n: string, p: number) => `Menor utilização: ${n} (${p}%)`,
    melhorSite: (n: string, p: number) => `Site com maior utilização: ${n} (${p}%)`,
    piorSite: (n: string, p: number) => `Site com menor utilização: ${n} (${p}%)`,
    maiorAlta: (n: string, d: number) => `Maior evolução: ${n} (+${d} p.p.)`,
    maiorQueda: (n: string, d: number) => `Maior queda: ${n} (${d} p.p.)`,
    melhorDia: (d: string, p: number) => `Melhor dia da semana: ${d} (${p}%)`,
    semDestaques: "Sem dados suficientes para destaques.",
    // slide 2
    slideTendencia: "Tendência de utilização",
    utilPorBucket: (g: string) => `Utilização por ${g}`,
    horasPorBucket: (g: string) => `Horas por ${g}`,
    gDay: "dia",
    gWeek: "semana",
    gMonth: "mês",
    legExecucao: "Em execução",
    legBloqueio: "Bloqueio externo",
    legOcioso: "Ocioso interno",
    metaUtil: "Faixa verde (70%)",
    // slide técnicos
    slideTecnicos: "Ranking de técnicos",
    colTecnico: "Técnico",
    colSite: "Site",
    colUtil: "Utilização",
    colDelta: "Δ vs. anterior",
    colHH: "HH",
    colConcl: "Concl.",
    colTendencia: "Tendência",
    // heatmap
    slideHeatmap: "Mapa de calor — utilização por técnico",
    heatLegenda: "Cada célula é a utilização do técnico no período; vazio = sem jornada registrada.",
    // sites
    slideSites: "Comparativo entre sites",
    siteTecnicos: (n: number) => `${n} técnico${n === 1 ? "" : "s"}`,
    tendenciaSites: "Tendência de utilização por site",
    siteNote: "Cada técnico é contado no seu primeiro site cadastrado.",
    // dia da semana + improdutivo
    slideDiaSemana: "Dias da semana e perdas de tempo",
    utilPorDiaSemana: "Utilização por dia da semana",
    improdutivoMotivo: "Tempo improdutivo por motivo",
    externo: "Bloqueio externo",
    interno: "Ocioso interno",
    statusLabel: {
      available: "Disponível",
      site_blocked: "Bloqueado no site",
      awaiting_release: "Aguardando liberação",
    } as Record<string, string>,
    // atividades
    slideAtividades: "Base de estimativa por atividade",
    colAtividade: "Atividade",
    colFamilia: "Família",
    colExec: "Execuções",
    colHHUnid: "HH / unidade (mediana)",
    colDuracao: "Duração mediana",
    colEquipe: "Equipe média",
    atividadesNota: "Somente atividades com amostra suficiente (mínimo de 5 execuções válidas).",
    atividadesVazio: "Nenhuma atividade com amostra suficiente no período.",
    pp: "p.p.",
    horasSuf: "h",
  },
  "en-US": {
    eyebrow: "Operations Center",
    title: "Management Report",
    subtitle: "Performance comparison across technicians, sites and periods",
    voltar: "Reports & Indicators",
    todosSites: "All sites",
    filtroSite: "Filter by site",
    agrupar: "Group by",
    auto: "Automatic",
    day: "Day",
    week: "Week",
    month: "Month",
    preset: (d: number) => `${d} days`,
    exportarPdf: "Export PDF",
    dicaPdf: "In the print dialog choose “Save as PDF” and turn off “Headers and footers”.",
    carregando: "Building the report…",
    erro: "Could not load the report.",
    tentarNovamente: "Try again",
    semDados: "No data in the selected period.",
    geradoEm: "Generated on",
    pagina: (n: number, total: number) => `${n} / ${total}`,
    periodoAtual: "Current period",
    periodoAnterior: "Previous period",
    vsAnterior: "vs. previous period",
    slideResumo: "Executive summary",
    kUtilizacao: "Utilization",
    kProdutivas: "Productive hours",
    kHH: "Man-hours (MH)",
    kBloqueio: "External blocking",
    kOcioso: "Internal idle",
    kConcluidas: "Completed tasks",
    kTecnicos: "Active technicians",
    kRastreamento: "Tracking",
    jornadaDe: (h: string) => `of ${h} shift`,
    destaques: "Period highlights",
    melhorTecnico: (n: string, p: number) => `Highest utilization: ${n} (${p}%)`,
    piorTecnico: (n: string, p: number) => `Lowest utilization: ${n} (${p}%)`,
    melhorSite: (n: string, p: number) => `Highest-utilization site: ${n} (${p}%)`,
    piorSite: (n: string, p: number) => `Lowest-utilization site: ${n} (${p}%)`,
    maiorAlta: (n: string, d: number) => `Biggest improvement: ${n} (+${d} p.p.)`,
    maiorQueda: (n: string, d: number) => `Biggest drop: ${n} (${d} p.p.)`,
    melhorDia: (d: string, p: number) => `Best weekday: ${d} (${p}%)`,
    semDestaques: "Not enough data for highlights.",
    slideTendencia: "Utilization trend",
    utilPorBucket: (g: string) => `Utilization per ${g}`,
    horasPorBucket: (g: string) => `Hours per ${g}`,
    gDay: "day",
    gWeek: "week",
    gMonth: "month",
    legExecucao: "In progress",
    legBloqueio: "External blocking",
    legOcioso: "Internal idle",
    metaUtil: "Green band (70%)",
    slideTecnicos: "Technician ranking",
    colTecnico: "Technician",
    colSite: "Site",
    colUtil: "Utilization",
    colDelta: "Δ vs. previous",
    colHH: "MH",
    colConcl: "Done",
    colTendencia: "Trend",
    slideHeatmap: "Heat map — utilization by technician",
    heatLegenda: "Each cell is the technician's utilization in the bucket; empty = no recorded shift.",
    slideSites: "Site comparison",
    siteTecnicos: (n: number) => `${n} technician${n === 1 ? "" : "s"}`,
    tendenciaSites: "Utilization trend by site",
    siteNote: "Each technician is counted under their first registered site.",
    slideDiaSemana: "Weekdays and lost time",
    utilPorDiaSemana: "Utilization by weekday",
    improdutivoMotivo: "Unproductive time by reason",
    externo: "External blocking",
    interno: "Internal idle",
    statusLabel: {
      available: "Available",
      site_blocked: "Blocked on site",
      awaiting_release: "Awaiting release",
    } as Record<string, string>,
    slideAtividades: "Estimating baseline by activity",
    colAtividade: "Activity",
    colFamilia: "Family",
    colExec: "Executions",
    colHHUnid: "MH / unit (median)",
    colDuracao: "Median duration",
    colEquipe: "Avg. crew",
    atividadesNota: "Only activities with a sufficient sample (at least 5 valid executions).",
    atividadesVazio: "No activity with a sufficient sample in the period.",
    pp: "p.p.",
    horasSuf: "h",
  },
  "es-ES": {
    eyebrow: "Centro de Operaciones",
    title: "Informe Gerencial",
    subtitle: "Comparativo de desempeño entre técnicos, sitios y períodos",
    voltar: "Reportes e Indicadores",
    todosSites: "Todos los sitios",
    filtroSite: "Filtrar por sitio",
    agrupar: "Agrupar por",
    auto: "Automático",
    day: "Día",
    week: "Semana",
    month: "Mes",
    preset: (d: number) => `${d} días`,
    exportarPdf: "Exportar PDF",
    dicaPdf: "En el diálogo de impresión elija “Guardar como PDF” y desactive “Encabezados y pies de página”.",
    carregando: "Armando el informe…",
    erro: "No se pudo cargar el informe.",
    tentarNovamente: "Reintentar",
    semDados: "Sin datos en el período seleccionado.",
    geradoEm: "Generado el",
    pagina: (n: number, total: number) => `${n} / ${total}`,
    periodoAtual: "Período actual",
    periodoAnterior: "Período anterior",
    vsAnterior: "vs. período anterior",
    slideResumo: "Resumen ejecutivo",
    kUtilizacao: "Utilización",
    kProdutivas: "Horas productivas",
    kHH: "Hombre-hora (HH)",
    kBloqueio: "Bloqueo externo",
    kOcioso: "Ocioso interno",
    kConcluidas: "Tareas concluidas",
    kTecnicos: "Técnicos activos",
    kRastreamento: "Seguimiento",
    jornadaDe: (h: string) => `de ${h} de jornada`,
    destaques: "Destacados del período",
    melhorTecnico: (n: string, p: number) => `Mayor utilización: ${n} (${p}%)`,
    piorTecnico: (n: string, p: number) => `Menor utilización: ${n} (${p}%)`,
    melhorSite: (n: string, p: number) => `Sitio con mayor utilización: ${n} (${p}%)`,
    piorSite: (n: string, p: number) => `Sitio con menor utilización: ${n} (${p}%)`,
    maiorAlta: (n: string, d: number) => `Mayor evolución: ${n} (+${d} p.p.)`,
    maiorQueda: (n: string, d: number) => `Mayor caída: ${n} (${d} p.p.)`,
    melhorDia: (d: string, p: number) => `Mejor día de la semana: ${d} (${p}%)`,
    semDestaques: "Sin datos suficientes para destacados.",
    slideTendencia: "Tendencia de utilización",
    utilPorBucket: (g: string) => `Utilización por ${g}`,
    horasPorBucket: (g: string) => `Horas por ${g}`,
    gDay: "día",
    gWeek: "semana",
    gMonth: "mes",
    legExecucao: "En ejecución",
    legBloqueio: "Bloqueo externo",
    legOcioso: "Ocioso interno",
    metaUtil: "Franja verde (70%)",
    slideTecnicos: "Ranking de técnicos",
    colTecnico: "Técnico",
    colSite: "Sitio",
    colUtil: "Utilización",
    colDelta: "Δ vs. anterior",
    colHH: "HH",
    colConcl: "Concl.",
    colTendencia: "Tendencia",
    slideHeatmap: "Mapa de calor — utilización por técnico",
    heatLegenda: "Cada celda es la utilización del técnico en el período; vacío = sin jornada registrada.",
    slideSites: "Comparativo entre sitios",
    siteTecnicos: (n: number) => `${n} técnico${n === 1 ? "" : "s"}`,
    tendenciaSites: "Tendencia de utilización por sitio",
    siteNote: "Cada técnico se cuenta en su primer sitio registrado.",
    slideDiaSemana: "Días de la semana y pérdidas de tiempo",
    utilPorDiaSemana: "Utilización por día de la semana",
    improdutivoMotivo: "Tiempo improductivo por motivo",
    externo: "Bloqueo externo",
    interno: "Ocioso interno",
    statusLabel: {
      available: "Disponible",
      site_blocked: "Bloqueado en el sitio",
      awaiting_release: "Esperando liberación",
    } as Record<string, string>,
    slideAtividades: "Base de estimación por actividad",
    colAtividade: "Actividad",
    colFamilia: "Familia",
    colExec: "Ejecuciones",
    colHHUnid: "HH / unidad (mediana)",
    colDuracao: "Duración mediana",
    colEquipe: "Equipo medio",
    atividadesNota: "Solo actividades con muestra suficiente (mínimo de 5 ejecuciones válidas).",
    atividadesVazio: "Ninguna actividad con muestra suficiente en el período.",
    pp: "p.p.",
    horasSuf: "h",
  },
};

type Text = (typeof TEXT)["pt-BR"];

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function pickTicks(count: number, max: number): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

interface Fmt {
  num: (v: number, digits?: number) => string;
  hours: (v: number) => string;
  pct: (v: number | null) => string;
  bucket: (start: string, group: ManagementGroup) => string;
  range: (from: string, to: string) => string;
}

// ---------------------------------------------------------------------------
// Gráficos SVG
// ---------------------------------------------------------------------------

interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  width?: number;
}

function LineChart({
  labels,
  series,
  width,
  height,
  yMax: yMaxProp,
  guide,
}: {
  labels: string[];
  series: LineSeries[];
  width: number;
  height: number;
  yMax?: number;
  guide?: number;
}) {
  const dataMax = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const yMax = yMaxProp ?? (dataMax > 100 ? Math.ceil(dataMax / 20) * 20 : 100);
  const padL = 40;
  const padR = 14;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = labels.length;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (Math.min(v, yMax) / yMax) * innerH;
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * yMax));
  const showDots = n <= 31;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" style={{ display: "block" }}>
      {gridValues.map((g) => (
        <g key={g}>
          <line x1={padL} x2={width - padR} y1={y(g)} y2={y(g)} stroke={C.grid} strokeWidth={1} />
          <text x={padL - 8} y={y(g) + 4} textAnchor="end" fontSize={11} fill={C.muted}>
            {g}%
          </text>
        </g>
      ))}
      {guide !== undefined && (
        <line x1={padL} x2={width - padR} y1={y(guide)} y2={y(guide)} stroke={C.green} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.7} />
      )}
      {pickTicks(n, 12).map((i) => (
        <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={C.muted}>
          {labels[i]}
        </text>
      ))}
      {series.map((s) => {
        // Segmentos contínuos (null quebra a linha).
        const segments: string[] = [];
        let current = "";
        s.values.forEach((v, i) => {
          if (v === null || v === undefined) {
            if (current) segments.push(current);
            current = "";
            return;
          }
          current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        });
        if (current) segments.push(current);
        return (
          <g key={s.name}>
            {segments.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width ?? 2.5}
                strokeDasharray={s.dashed ? "6 5" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={s.dashed ? 0.7 : 1}
              />
            ))}
            {showDots &&
              !s.dashed &&
              s.values.map((v, i) =>
                v === null || v === undefined ? null : <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color} />
              )}
          </g>
        );
      })}
    </svg>
  );
}

function StackedColumns({
  buckets,
  labels,
  width,
  height,
  fmt,
}: {
  buckets: ManagementBucket[];
  labels: string[];
  width: number;
  height: number;
  fmt: Fmt;
}) {
  const padL = 44;
  const padR = 14;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = buckets.length;
  const slot = innerW / Math.max(n, 1);
  const barW = Math.min(slot * 0.7, 48);
  const rawMax = Math.max(1, ...buckets.map((b) => b.productive_hours + b.external_block_hours + b.internal_idle_hours));
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const yMax = Math.ceil(rawMax / magnitude) * magnitude;
  const y = (v: number) => padT + innerH - (v / yMax) * innerH;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" style={{ display: "block" }}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={width - padR} y1={y(f * yMax)} y2={y(f * yMax)} stroke={C.grid} strokeWidth={1} />
          <text x={padL - 8} y={y(f * yMax) + 4} textAnchor="end" fontSize={11} fill={C.muted}>
            {fmt.num(f * yMax, 0)}
          </text>
        </g>
      ))}
      {buckets.map((b, i) => {
        const cx = padL + slot * i + slot / 2;
        const parts = [
          { v: b.productive_hours, color: C.green },
          { v: b.external_block_hours, color: C.purple },
          { v: b.internal_idle_hours, color: C.red },
        ];
        let acc = 0;
        return (
          <g key={b.start}>
            {parts.map((part, k) => {
              if (part.v <= 0) return null;
              const top = y(acc + part.v);
              const h = y(acc) - top;
              acc += part.v;
              return <rect key={k} x={cx - barW / 2} y={top} width={barW} height={Math.max(h, 0.5)} fill={part.color} rx={k === 2 ? 2 : 0} />;
            })}
          </g>
        );
      })}
      {pickTicks(n, 12).map((i) => (
        <text key={i} x={padL + slot * i + slot / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={C.muted}>
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

function Sparkline({ values, width = 110, height = 28 }: { values: (number | null)[]; width?: number; height?: number }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return <span style={{ color: C.faint, fontSize: 12 }}>—</span>;
  const n = values.length;
  const x = (i: number) => 2 + (i / (n - 1)) * (width - 4);
  const y = (v: number) => 2 + (height - 4) - (Math.min(v, 100) / 100) * (height - 4);
  let d = "";
  let prev = false;
  values.forEach((v, i) => {
    if (v === null) {
      prev = false;
      return;
    }
    d += `${prev ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    prev = true;
  });
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <path d={d} fill="none" stroke={C.blue} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.6} fill={bandColor(last.v)} />
    </svg>
  );
}

function MiniTrend({ values, color = C.blue, width = 250, height = 56 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => 4 + (height - 8) - ((v - min) / span) * (height - 8);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(values.length - 1).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Delta({ value, unit, inverse = false }: { value: number | null; unit: string; inverse?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="mgr-delta mgr-delta--none">—</span>;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return <span className="mgr-delta mgr-delta--none">= 0 {unit}</span>;
  const good = inverse ? rounded < 0 : rounded > 0;
  return (
    <span className={`mgr-delta ${good ? "mgr-delta--good" : "mgr-delta--bad"}`}>
      {rounded > 0 ? "▲" : "▼"} {rounded > 0 ? "+" : ""}
      {rounded.toString().replace(".", ",")} {unit}
    </span>
  );
}

function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

interface SlideSpec {
  key: string;
  title: string;
  subtitle?: string;
  body: ReactNode;
}

function SlideFrame({
  spec,
  index,
  total,
  meta,
  generatedAt,
  p,
}: {
  spec: SlideSpec;
  index: number;
  total: number;
  meta: string;
  generatedAt: string;
  p: Text;
}) {
  return (
    <section className="mgr-slide" aria-label={spec.title}>
      <header className="mgr-slide-head">
        <div>
          <h2>{spec.title}</h2>
          {spec.subtitle && <p>{spec.subtitle}</p>}
        </div>
        <span className="mgr-slide-meta">{meta}</span>
      </header>
      <div className="mgr-slide-body">{spec.body}</div>
      <footer className="mgr-slide-foot">
        <span>
          Axis Field — {p.geradoEm} {generatedAt}
        </span>
        <span>{p.pagina(index + 1, total)}</span>
      </footer>
    </section>
  );
}

function KpiCard({
  label,
  value,
  hint,
  delta,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  delta: ReactNode;
  trend?: ReactNode;
}) {
  return (
    <div className="mgr-kpi">
      <span className="mgr-kpi-label">{label}</span>
      <strong className="mgr-kpi-value">{value}</strong>
      {hint && <span className="mgr-kpi-hint">{hint}</span>}
      {trend && <div className="mgr-kpi-trend">{trend}</div>}
      <div className="mgr-kpi-delta">{delta}</div>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="mgr-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.dashed ? "transparent" : i.color, borderTop: i.dashed ? `2px dashed ${i.color}` : undefined }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function groupLabel(group: ManagementGroup, p: Text): string {
  return group === "day" ? p.gDay : group === "week" ? p.gWeek : p.gMonth;
}

function buildSlides(report: ManagementReport, p: Text, fmt: Fmt, siteLabel: string): SlideSpec[] {
  const slides: SlideSpec[] = [];
  const group = report.period.group;
  const labels = report.series.map((b) => fmt.bucket(b.start, group));
  const cur = report.kpis.current;
  const prev = report.kpis.previous;
  const rankedTechs = report.technicians.filter((t) => t.utilization_pct !== null);

  // --- 1. Resumo executivo ---------------------------------------------
  const highlights: string[] = [];
  if (rankedTechs.length) {
    const best = rankedTechs[0];
    const worst = rankedTechs[rankedTechs.length - 1];
    highlights.push(p.melhorTecnico(best.name, best.utilization_pct as number));
    if (rankedTechs.length > 1) highlights.push(p.piorTecnico(worst.name, worst.utilization_pct as number));
  }
  const rankedSites = report.sites.filter((s) => s.utilization_pct !== null);
  if (rankedSites.length > 1) {
    const best = rankedSites[0];
    const worst = rankedSites[rankedSites.length - 1];
    highlights.push(p.melhorSite(best.name, best.utilization_pct as number));
    highlights.push(p.piorSite(worst.name, worst.utilization_pct as number));
  }
  const withDelta = report.technicians.filter((t) => t.utilization_delta !== null);
  if (withDelta.length > 1) {
    const up = withDelta.reduce((a, b) => ((b.utilization_delta as number) > (a.utilization_delta as number) ? b : a));
    const down = withDelta.reduce((a, b) => ((b.utilization_delta as number) < (a.utilization_delta as number) ? b : a));
    if ((up.utilization_delta as number) > 0) highlights.push(p.maiorAlta(up.name, up.utilization_delta as number));
    if ((down.utilization_delta as number) < 0) highlights.push(p.maiorQueda(down.name, down.utilization_delta as number));
  }
  const weekdaysWithData = report.weekdays.filter((w) => w.utilization_pct !== null);
  if (weekdaysWithData.length) {
    const bestDay = weekdaysWithData.reduce((a, b) => ((b.utilization_pct as number) > (a.utilization_pct as number) ? b : a));
    highlights.push(p.melhorDia(bestDay.label, bestDay.utilization_pct as number));
  }

  slides.push({
    key: "summary",
    title: p.slideResumo,
    subtitle: `${p.periodoAtual}: ${fmt.range(report.period.date_from, report.period.date_to)} · ${p.periodoAnterior}: ${fmt.range(
      report.previous_period.date_from,
      report.previous_period.date_to
    )}`,
    body: (
      <div className="mgr-summary">
        <div className="mgr-kpi-grid">
          <KpiCard
            label={p.kUtilizacao}
            value={fmt.pct(cur.utilization_pct)}
            hint={p.jornadaDe(fmt.hours(cur.journey_hours))}
            trend={<MiniTrend values={report.series.map((b) => b.utilization_pct ?? 0)} color={C.blue} />}
            delta={
              <Delta
                value={cur.utilization_pct !== null && prev.utilization_pct !== null ? cur.utilization_pct - prev.utilization_pct : null}
                unit={p.pp}
              />
            }
          />
          <KpiCard
            label={p.kProdutivas}
            value={fmt.hours(cur.productive_hours)}
            trend={<MiniTrend values={report.series.map((b) => b.productive_hours)} color={C.green} />}
            delta={<Delta value={pctChange(cur.productive_hours, prev.productive_hours)} unit="%" />}
          />
          <KpiCard
            label={p.kHH}
            value={fmt.hours(cur.man_hours)}
            trend={<MiniTrend values={report.series.map((b) => b.man_hours)} color={C.blue} />}
            delta={<Delta value={pctChange(cur.man_hours, prev.man_hours)} unit="%" />}
          />
          <KpiCard
            label={p.kBloqueio}
            value={fmt.hours(cur.external_block_hours)}
            trend={<MiniTrend values={report.series.map((b) => b.external_block_hours)} color={C.purple} />}
            delta={<Delta value={pctChange(cur.external_block_hours, prev.external_block_hours)} unit="%" inverse />}
          />
          <KpiCard
            label={p.kOcioso}
            value={fmt.hours(cur.internal_idle_hours)}
            trend={<MiniTrend values={report.series.map((b) => b.internal_idle_hours)} color={C.red} />}
            delta={<Delta value={pctChange(cur.internal_idle_hours, prev.internal_idle_hours)} unit="%" inverse />}
          />
          <KpiCard
            label={p.kConcluidas}
            value={fmt.num(cur.completed_count, 0)}
            hint={`${p.kTecnicos}: ${fmt.num(cur.technicians, 0)} · ${p.kRastreamento}: ${fmt.pct(report.tracking_rate_pct)}`}
            trend={<MiniTrend values={report.series.map((b) => b.completed_count)} color={C.orange} />}
            delta={<Delta value={pctChange(cur.completed_count, prev.completed_count)} unit="%" />}
          />
        </div>
        <div className="mgr-highlights">
          <h3>{p.destaques}</h3>
          {highlights.length ? (
            <ul>
              {highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : (
            <p className="mgr-empty">{p.semDestaques}</p>
          )}
          <p className="mgr-site-chip">{siteLabel}</p>
        </div>
      </div>
    ),
  });

  // --- 2. Tendência -------------------------------------------------------
  const gName = groupLabel(group, p);
  const utilSeries: LineSeries[] = [
    { name: p.periodoAtual, color: C.blue, values: report.series.map((b) => b.utilization_pct) },
    {
      name: p.periodoAnterior,
      color: C.faint,
      dashed: true,
      width: 2,
      values: report.series.map((_, i) => report.previous_series[i]?.utilization_pct ?? null),
    },
  ];
  slides.push({
    key: "trend",
    title: p.slideTendencia,
    subtitle: `${p.agrupar.toLowerCase()}: ${gName}`,
    body: (
      <div className="mgr-two-rows">
        <div className="mgr-panel">
          <div className="mgr-panel-head">
            <h3>{p.utilPorBucket(gName)}</h3>
            <Legend
              items={[
                { color: C.blue, label: p.periodoAtual },
                { color: C.faint, label: p.periodoAnterior, dashed: true },
                { color: C.green, label: p.metaUtil, dashed: true },
              ]}
            />
          </div>
          <LineChart labels={labels} series={utilSeries} width={1200} height={250} guide={70} />
        </div>
        <div className="mgr-panel">
          <div className="mgr-panel-head">
            <h3>{p.horasPorBucket(gName)}</h3>
            <Legend
              items={[
                { color: C.green, label: p.legExecucao },
                { color: C.purple, label: p.legBloqueio },
                { color: C.red, label: p.legOcioso },
              ]}
            />
          </div>
          <StackedColumns buckets={report.series} labels={labels} width={1200} height={230} fmt={fmt} />
        </div>
      </div>
    ),
  });

  // --- 3. Ranking de técnicos (paginado) -----------------------------------
  const techPages = chunk(report.technicians, TECHS_PER_RANKING_SLIDE);
  techPages.forEach((page, pageIndex) => {
    slides.push({
      key: `techs-${pageIndex}`,
      title: p.slideTecnicos,
      subtitle: techPages.length > 1 ? `${pageIndex + 1}/${techPages.length}` : undefined,
      body: (
        <table className="mgr-table">
          <thead>
            <tr>
              <th>{p.colTecnico}</th>
              <th>{p.colSite}</th>
              <th style={{ width: 300 }}>{p.colUtil}</th>
              <th>{p.colDelta}</th>
              <th className="num">{p.colHH}</th>
              <th className="num">{p.colConcl}</th>
              <th>{p.colTendencia}</th>
            </tr>
          </thead>
          <tbody>
            {page.map((t) => (
              <tr key={t.id}>
                <td className="strong">{t.name}</td>
                <td>{t.site_name}</td>
                <td>
                  <div className="mgr-bar">
                    <div className="mgr-bar-track">
                      <div
                        className="mgr-bar-fill"
                        style={{ width: `${Math.min(t.utilization_pct ?? 0, 100)}%`, background: bandColor(t.utilization_pct) }}
                      />
                    </div>
                    <span>{fmt.pct(t.utilization_pct)}</span>
                  </div>
                </td>
                <td>
                  <Delta value={t.utilization_delta} unit={p.pp} />
                </td>
                <td className="num">{fmt.num(t.man_hours, 1)}</td>
                <td className="num">{fmt.num(t.completed_count, 0)}</td>
                <td>
                  <Sparkline values={t.series} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    });
  });

  // --- 4. Mapa de calor ----------------------------------------------------
  const heatPages = chunk(report.technicians, TECHS_PER_HEATMAP_SLIDE);
  const heatCols = Math.min(labels.length, 31);
  const heatTicks = new Set(pickTicks(labels.length, Math.min(labels.length, 16)));
  heatPages.forEach((page, pageIndex) => {
    slides.push({
      key: `heat-${pageIndex}`,
      title: p.slideHeatmap,
      subtitle: heatPages.length > 1 ? `${pageIndex + 1}/${heatPages.length}` : p.heatLegenda,
      body: (
        <div className="mgr-heat" style={{ ["--cols" as string]: heatCols }}>
          <div className="mgr-heat-row mgr-heat-row--head">
            <span className="mgr-heat-name" />
            {labels.slice(0, heatCols).map((l, i) => (
              <span key={i} className="mgr-heat-label">
                {heatTicks.has(i) ? l : ""}
              </span>
            ))}
          </div>
          {page.map((t) => (
            <div key={t.id} className="mgr-heat-row">
              <span className="mgr-heat-name">{t.name}</span>
              {t.series.slice(0, heatCols).map((v, i) => (
                <span
                  key={i}
                  className="mgr-heat-cell"
                  title={fmt.pct(v)}
                  style={{ background: v === null ? "#f1f4f8" : bandColor(v) }}
                >
                  {heatCols <= 16 && v !== null ? Math.round(v) : ""}
                </span>
              ))}
            </div>
          ))}
          <Legend
            items={[
              { color: C.red, label: "< 50%" },
              { color: C.amber, label: "50–69%" },
              { color: C.green, label: "70–100%" },
              { color: C.purple, label: "> 100%" },
            ]}
          />
        </div>
      ),
    });
  });

  // --- 5. Sites -------------------------------------------------------------
  if (report.sites.length) {
    const siteSeries: LineSeries[] = report.sites.slice(0, SITE_COLORS.length).map((s, i) => ({
      name: s.name,
      color: SITE_COLORS[i],
      values: s.series,
    }));
    slides.push({
      key: "sites",
      title: p.slideSites,
      subtitle: p.siteNote,
      body: (
        <div className="mgr-two-cols">
          <div className="mgr-panel">
            <div className="mgr-panel-head">
              <h3>{p.colUtil}</h3>
            </div>
            <div className="mgr-rank">
              {report.sites.map((s, i) => (
                <div key={s.name} className="mgr-rank-row">
                  <div className="mgr-rank-top">
                    <span className="strong">
                      <i className="mgr-dot" style={{ background: SITE_COLORS[i % SITE_COLORS.length] }} />
                      {s.name} <small>{p.siteTecnicos(s.technicians)}</small>
                    </span>
                    <span>
                      {fmt.pct(s.utilization_pct)} <Delta value={s.utilization_delta} unit={p.pp} />
                    </span>
                  </div>
                  <div className="mgr-bar-track">
                    <div className="mgr-bar-fill" style={{ width: `${Math.min(s.utilization_pct ?? 0, 100)}%`, background: bandColor(s.utilization_pct) }} />
                  </div>
                  <div className="mgr-rank-sub">
                    {p.kProdutivas}: {fmt.hours(s.productive_hours)} · {p.kHH}: {fmt.hours(s.man_hours)} · {p.kBloqueio}: {fmt.hours(s.external_block_hours)} ·{" "}
                    {p.kOcioso}: {fmt.hours(s.internal_idle_hours)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mgr-panel">
            <div className="mgr-panel-head">
              <h3>{p.tendenciaSites}</h3>
            </div>
            <LineChart labels={labels} series={siteSeries} width={560} height={400} guide={70} />
            <Legend items={siteSeries.map((s) => ({ color: s.color, label: s.name }))} />
          </div>
        </div>
      ),
    });
  }

  // --- 6. Dias da semana + improdutivo -----------------------------------------
  const maxWeekday = Math.max(100, ...report.weekdays.map((w) => w.utilization_pct ?? 0));
  const reasons = report.unproductive_by_reason;
  const maxReason = Math.max(1, ...reasons.map((r) => r.hours));
  slides.push({
    key: "weekday",
    title: p.slideDiaSemana,
    body: (
      <div className="mgr-two-cols">
        <div className="mgr-panel">
          <div className="mgr-panel-head">
            <h3>{p.utilPorDiaSemana}</h3>
          </div>
          <div className="mgr-columns">
            {report.weekdays.map((w) => (
              <div key={w.label} className="mgr-column">
                <span className="mgr-column-value">{fmt.pct(w.utilization_pct)}</span>
                <div className="mgr-column-track">
                  <div
                    className="mgr-column-fill"
                    style={{ height: `${((w.utilization_pct ?? 0) / maxWeekday) * 100}%`, background: bandColor(w.utilization_pct) }}
                  />
                </div>
                <span className="mgr-column-label">{w.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mgr-panel">
          <div className="mgr-panel-head">
            <h3>{p.improdutivoMotivo}</h3>
          </div>
          {reasons.length ? (
            <div className="mgr-rank">
              {reasons.map((r) => (
                <div key={r.status} className="mgr-rank-row">
                  <div className="mgr-rank-top">
                    <span className="strong">
                      {p.statusLabel[r.status] ?? r.status_display}{" "}
                      <small>{r.category === "external" ? p.externo : p.interno}</small>
                    </span>
                    <span>{fmt.hours(r.hours)}</span>
                  </div>
                  <div className="mgr-bar-track">
                    <div
                      className="mgr-bar-fill"
                      style={{ width: `${(r.hours / maxReason) * 100}%`, background: r.category === "external" ? C.purple : C.red }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mgr-empty">{p.semDados}</p>
          )}
        </div>
      </div>
    ),
  });

  // --- 7. Atividades -------------------------------------------------------------
  const activityRows: ReportsActivityProductivity[] = report.activities;
  slides.push({
    key: "activities",
    title: p.slideAtividades,
    subtitle: p.atividadesNota,
    body: activityRows.length ? (
      <table className="mgr-table">
        <thead>
          <tr>
            <th>{p.colAtividade}</th>
            <th>{p.colFamilia}</th>
            <th className="num">{p.colExec}</th>
            <th className="num">{p.colHHUnid}</th>
            <th className="num">{p.colDuracao}</th>
            <th className="num">{p.colEquipe}</th>
          </tr>
        </thead>
        <tbody>
          {activityRows.map((a) => (
            <tr key={`${a.activity_code}-${a.cable_family_code ?? ""}`}>
              <td className="strong">{a.activity_name}</td>
              <td>{a.cable_family_name ?? "—"}</td>
              <td className="num">{fmt.num(a.executions_used, 0)}</td>
              <td className="num">{a.hh_per_unit ? `${fmt.num(a.hh_per_unit.median, 2)} / ${a.unit || "un"}` : "—"}</td>
              <td className="num">{a.median_duration_hours !== null ? fmt.hours(a.median_duration_hours) : "—"}</td>
              <td className="num">{a.avg_crew_size !== null ? fmt.num(a.avg_crew_size, 1) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p className="mgr-empty">{p.atividadesVazio}</p>
    ),
  });

  return slides;
}

function Slides({ slides, meta, generatedAt, p }: { slides: SlideSpec[]; meta: string; generatedAt: string; p: Text }) {
  return (
    <>
      {slides.map((spec, i) => (
        <SlideFrame key={spec.key} spec={spec} index={i} total={slides.length} meta={meta} generatedAt={generatedAt} p={p} />
      ))}
    </>
  );
}

/** Mostra cada slide 1280×720 reduzido ao tamanho disponível na tela. */
function ScaledSlides({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / SLIDE_W));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="mgr-screen" style={{ ["--mgr-scale" as string]: scale }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function ManagementReportPage() {
  const p = usePageText(TEXT);
  const { locale } = useI18n();

  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>("all");
  const [range, setRange] = useState<DateRange>(() => ({ start: brazilDaysAgoIso(29), end: brazilTodayIso() }));
  const [group, setGroup] = useState<ManagementGroup | "auto">("auto");
  const [report, setReport] = useState<ManagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    sitesApi
      .list()
      .then((res) => setSites(res.results))
      .catch(() => setSites([]));
  }, []);

  // A impressão só esconde o app enquanto esta página está aberta.
  useEffect(() => {
    document.body.classList.add(PRINT_BODY_CLASS);
    return () => document.body.classList.remove(PRINT_BODY_CLASS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    operationsApi
      .managementReport(siteId, range.start, range.end, group === "auto" ? undefined : group)
      .then((res) => {
        if (cancelled) return;
        setReport(res);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const detail = err?.response?.data?.detail;
        setError(typeof detail === "string" ? detail : "");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, range.start, range.end, group, reloadKey]);

  const fmt = useMemo<Fmt>(() => {
    const cache = new Map<number, Intl.NumberFormat>();
    const num = (v: number, digits = 1) => {
      let f = cache.get(digits);
      if (!f) {
        f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        cache.set(digits, f);
      }
      return f.format(v);
    };
    return {
      num,
      hours: (v) => `${num(v, 1)} ${p.horasSuf}`,
      pct: (v) => (v === null ? "—" : `${num(v, 0)}%`),
      bucket: (start, g) =>
        g === "month"
          ? formatIsoDate(start, locale, { month: "short", year: "2-digit" })
          : formatIsoDate(start, locale, { day: "2-digit", month: "2-digit" }),
      range: (from, to) =>
        `${formatIsoDate(from, locale, { day: "2-digit", month: "2-digit", year: "numeric" })} – ${formatIsoDate(to, locale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })}`,
    };
  }, [locale, p.horasSuf]);

  const siteLabel =
    siteId === "all"
      ? p.todosSites
      : sites
          .filter((s) => siteId.split(",").includes(String(s.id)))
          .map((s) => s.name)
          .join(", ") || p.todosSites;
  const slides = useMemo(() => (report ? buildSlides(report, p, fmt, siteLabel) : []), [report, p, fmt, siteLabel]);
  const generatedAt = report
    ? new Date(report.generated_at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })
    : "";
  const meta = report ? `${siteLabel} · ${fmt.range(report.period.date_from, report.period.date_to)}` : "";
  const hasData = !!report && (report.kpis.current.journey_hours > 0 || report.kpis.current.completed_count > 0);

  const activePreset = PERIOD_PRESETS.find(
    (d) => range.end === brazilTodayIso() && range.start === brazilDaysAgoIso(d - 1)
  );

  function changeRange(next: DateRange | null) {
    setRange(next ?? { start: brazilDaysAgoIso(29), end: brazilTodayIso() });
  }

  return (
    <div className="mgr-page">
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={p.subtitle}
        actions={
          <div className="ops-toolbar rpt-header-tools mgr-no-print">
            <Link to="/relatorios-indicadores" className="btn btn-outline btn-sm">
              <Icon name="arrow_back" style={{ fontSize: 16 }} />
              {p.voltar}
            </Link>
            <MultiSelectFilter
              label={locale === "es-ES" ? "Sitio" : "Site"}
              options={sites.map((s) => ({ value: String(s.id), label: s.name }))}
              selected={siteId === "all" ? [] : siteId.split(",")}
              onChange={(next) => setSiteId(next.length ? next.join(",") : "all")}
              allLabel={p.todosSites}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!hasData || loading}
              title={p.dicaPdf}
              onClick={() => window.print()}
            >
              <Icon name="picture_as_pdf" style={{ fontSize: 16 }} />
              {p.exportarPdf}
            </button>
          </div>
        }
      />

      <div className="rpt-period-bar mgr-no-print">
        <DateRangeCalendar value={range} onChange={changeRange} maxDays={MAX_PERIOD_DAYS} emitPartial={false} />
        <div className="rpt-presets" role="group" aria-label={p.agrupar}>
          {PERIOD_PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              className={`rpt-preset${activePreset === d ? " active" : ""}`}
              aria-pressed={activePreset === d}
              onClick={() => changeRange({ start: brazilDaysAgoIso(d - 1), end: brazilTodayIso() })}
            >
              {p.preset(d)}
            </button>
          ))}
        </div>
        <div className="rpt-presets" role="group" aria-label={p.agrupar}>
          {(["auto", "day", "week", "month"] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`rpt-preset${group === g ? " active" : ""}`}
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
            >
              {g === "auto" ? p.auto : p[g]}
            </button>
          ))}
        </div>
        <span className="mgr-hint">{daysInclusive(range.start, range.end)} {p.day.toLowerCase()}s</span>
      </div>

      {loading && <p className="mgr-status mgr-no-print" role="status">{p.carregando}</p>}

      {error !== null && !loading && (
        <div className="rpt-notice rpt-notice--error rpt-notice--block mgr-no-print" role="alert">
          <Icon name="error" style={{ fontSize: 18 }} />
          <div className="rpt-notice-body">
            <strong>{p.erro}</strong>
            {error && <span>{error}</span>}
          </div>
          <div className="rpt-notice-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setReloadKey((k) => k + 1)}>
              <Icon name="refresh" style={{ fontSize: 16 }} />
              {p.tentarNovamente}
            </button>
          </div>
        </div>
      )}

      {report && !error && !hasData && !loading && <p className="mgr-status mgr-no-print">{p.semDados}</p>}

      {report && !error && hasData && (
        <>
          <ScaledSlides>
            <Slides slides={slides} meta={meta} generatedAt={generatedAt} p={p} />
          </ScaledSlides>
          {/* Cópia 1280×720 sem escala, usada só na impressão (ver index.css, .mgr-print-root). */}
          {createPortal(
            <div id="mgr-print-root" className="mgr-print-root">
              <Slides slides={slides} meta={meta} generatedAt={generatedAt} p={p} />
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
}

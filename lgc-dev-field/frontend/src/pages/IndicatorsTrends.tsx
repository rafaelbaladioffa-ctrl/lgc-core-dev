import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  clientsApi,
  indicatorsApi,
  indicatorsExtraApi,
  regionsApi,
  sitesApi,
  type Client,
  type Site,
  type TrendQuery,
} from "../api/resources";
import type {
  IndicatorsTrends,
  ManagementGroup,
  Region,
  TrendBreakdown,
  TrendDimension,
  TrendPoint,
  TrendProduction,
} from "../api/types";
import DateRangeCalendar, { type DateRange } from "../components/ui/DateRangeCalendar";
import Icon from "../components/ui/Icon";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import PageHeader from "../components/ui/PageHeader";
import SearchSelect from "../components/ui/SearchSelect";
import { useI18n, usePageText } from "../i18n";
import { addDaysIso, brazilDaysAgoIso, brazilTodayIso, daysInclusive, formatIsoDate } from "../utils/date";
import { TEXT, type Text } from "./indicatorsTrendsText";

// Indicadores > Tendências — GET /api/indicators/trends/{,production/,breakdown/} (api/indicators.py).
// Os gráficos são agrupados por segmento: Operação, Produção, Comparativos e Qualidade.

const MAX_PERIOD_DAYS = 366;
const PERIOD_PRESETS = [7, 30, 90, 365] as const;

type Segment = "operation" | "production" | "compare" | "quality";
export type ViewId =
  | "overview"
  | "utilization"
  | "unproductive"
  | "manhours"
  | "heatmap"
  | "flow"
  | "backlog"
  | "planning"
  | "estimate"
  | "productivity"
  | "by"
  | "previous"
  | "quality"
  | "incomplete";

const VIEWS: { id: ViewId; segment: Segment }[] = [
  { id: "overview", segment: "operation" },
  { id: "utilization", segment: "operation" },
  { id: "unproductive", segment: "operation" },
  { id: "manhours", segment: "operation" },
  { id: "heatmap", segment: "operation" },
  { id: "flow", segment: "production" },
  { id: "backlog", segment: "production" },
  { id: "planning", segment: "production" },
  { id: "estimate", segment: "production" },
  { id: "productivity", segment: "production" },
  { id: "by", segment: "compare" },
  { id: "previous", segment: "compare" },
  { id: "quality", segment: "quality" },
  { id: "incomplete", segment: "quality" },
];
const SEGMENTS: Segment[] = ["operation", "production", "compare", "quality"];

type Measure = "hours_execution" | "utilization_pct" | "tasks_executed" | "hours_unproductive" | "man_hours";
const MEASURES: Measure[] = ["hours_execution", "utilization_pct", "tasks_executed", "hours_unproductive", "man_hours"];
const MEASURE_UNIT: Record<Measure, string> = {
  hours_execution: "h",
  utilization_pct: "%",
  tasks_executed: "",
  hours_unproductive: "h",
  man_hours: "h",
};
const DIMENSIONS: Exclude<TrendDimension, "technician">[] = ["site", "client", "region"];

const W_MIN = 320;
const H_MIN = 160;
const M = { l: 52, r: 56, t: 16, b: 34 };

interface ChartSeries {
  id: string;
  label: string;
  unit: string;
  color: string;
  values: (number | null)[];
  total: number | null;
  dashed?: boolean;
}

interface ChartModel {
  title: string;
  starts: string[];
  series: ChartSeries[];
  kind: "line" | "stack";
  ref?: number;
  minMax?: number;
  group: ManagementGroup;
}

const COLOR = (n: number) => `var(--tnd-${n})`;

/** Escala com no máximo 5 divisões de passo 1, 2 ou 5 (×10^k): rótulos redondos no eixo. */
function niceScale(v: number): { max: number; ticks: number[] } {
  if (v <= 0) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = v / 5;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
  const count = Math.max(1, Math.ceil(v / step - 1e-9));
  return { max: step * count, ticks: Array.from({ length: count + 1 }, (_, i) => step * i) };
}

function fmt(n: number, locale: string): string {
  return n.toLocaleString(locale, { maximumFractionDigits: 1 });
}

function TrendChart({ model, hidden, locale }: { model: ChartModel; hidden: Set<string>; locale: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(960);
  const [H, setH] = useState(300);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      setW(Math.max(W_MIN, Math.round(el.clientWidth)));
      setH(Math.max(H_MIN, Math.round(el.clientHeight)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { starts, kind } = model;
  const n = starts.length;
  const stacked = kind === "stack";
  const visible = model.series.filter((s) => !hidden.has(s.id));
  const v = (s: ChartSeries, i: number) => s.values[i] ?? 0;
  const top = stacked
    ? Math.max(0, ...starts.map((_, i) => visible.reduce((acc, s) => acc + v(s, i), 0)))
    : Math.max(0, ...visible.flatMap((s) => s.values.map((x) => x ?? 0)));
  const { max, ticks } = niceScale(Math.max(top, model.minMax ?? 0, model.ref ?? 0));
  const innerW = W - M.l - M.r;
  const innerH = H - M.t - M.b;
  const slot = innerW / Math.max(n, 1);
  const x = (i: number) => (stacked || n <= 1 ? M.l + slot * i + slot / 2 : M.l + (i / (n - 1)) * innerW);
  const y = (val: number) => M.t + innerH - (val / max) * innerH;
  const label = (iso: string) =>
    model.group === "month"
      ? formatIsoDate(iso, locale, { month: "short", year: "2-digit" })
      : formatIsoDate(iso, locale, { day: "2-digit", month: "2-digit" });
  const step = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(innerW / 70))));
  const unit = model.series[0]?.unit ?? "";

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * innerW;
    const idx = stacked ? Math.floor(px / slot) : n <= 1 ? 0 : Math.round((px / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  }

  function segments(s: ChartSeries) {
    const out: string[] = [];
    let cur: string[] = [];
    s.values.forEach((val, i) => {
      if (val === null || val === undefined) {
        if (cur.length) out.push(cur.join(" "));
        cur = [];
      } else cur.push(`${x(i)},${y(val)}`);
    });
    if (cur.length) out.push(cur.join(" "));
    return out;
  }

  // Rótulos do fim das linhas: afastados entre si para não se sobreporem.
  const endLabels = (() => {
    if (stacked || visible.length > 4) return new Map<string, number>();
    const items = visible
      .map((s) => ({ id: s.id, y: s.values.length && s.values[s.values.length - 1] !== null ? y(s.values[s.values.length - 1] as number) + 4 : null }))
      .filter((it): it is { id: string; y: number } => it.y !== null)
      .sort((p1, p2) => p1.y - p2.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
    return new Map(items.map((it) => [it.id, it.y]));
  })();
  const tipLeft = hover !== null ? (x(hover) / W) * 100 : 0;
  const barW = Math.max(2, Math.min(40, slot * 0.7));

  return (
    <div className="tnd-chart-wrap" ref={wrapRef}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="tnd-svg" role="img" aria-label={model.title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="tnd-grid" />
            <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className="tnd-axis">
              {fmt(t, locale)}
              {t === max ? unit : ""}
            </text>
          </g>
        ))}
        {model.ref !== undefined && (
          <g>
            <line x1={M.l} x2={W - M.r} y1={y(model.ref)} y2={y(model.ref)} className="tnd-ref" />
            <text x={W - M.r - 4} y={y(model.ref) - 5} textAnchor="end" className="tnd-ref-label">
              {model.ref}%
            </text>
          </g>
        )}
        {starts.map((s, i) =>
          i % step === 0 ? (
            <text key={s} x={x(i)} y={H - 10} textAnchor="middle" className="tnd-axis">
              {label(s)}
            </text>
          ) : null,
        )}
        {hover !== null && !stacked && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + innerH} className="tnd-cross" />}
        {hover !== null && stacked && <rect x={M.l + slot * hover} y={M.t} width={slot} height={innerH} className="tnd-hover-band" />}
        {stacked &&
          starts.map((s, i) => {
            let acc = 0;
            return (
              <g key={s}>
                {visible.map((ser) => {
                  const y0 = y(acc);
                  acc += v(ser, i);
                  const h = y0 - y(acc);
                  return h > 0 ? <rect key={ser.id} x={x(i) - barW / 2} y={y(acc)} width={barW} height={h} fill={ser.color} className="tnd-bar" /> : null;
                })}
              </g>
            );
          })}
        {!stacked &&
          visible.map((s) => {
            const lastIdx = s.values.length - 1;
            const lastVal = lastIdx >= 0 ? s.values[lastIdx] : null;
            return (
              <g key={s.id}>
                {segments(s).map((pts, i) => (
                  <polyline
                    key={i}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={s.dashed ? "6 4" : undefined}
                    points={pts}
                  />
                ))}
                {n <= 45 &&
                  s.values.map((val, i) =>
                    val === null ? null : <circle key={i} cx={x(i)} cy={y(val)} r={hover === i ? 4.5 : 2.5} fill={s.color} className="tnd-dot" />,
                  )}
                {endLabels.has(s.id) && lastVal !== null && (
                  <text x={W - M.r + 8} y={endLabels.get(s.id)} textAnchor="start" className="tnd-endlabel">
                    {fmt(lastVal, locale)}
                    {s.unit}
                  </text>
                )}
              </g>
            );
          })}
        <rect x={M.l} y={M.t} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div className="tnd-tip" style={{ left: `${Math.min(Math.max(tipLeft, 14), 86)}%` }} role="status">
          <strong>{label(starts[hover])}</strong>
          {visible.map((s) => (
            <div key={s.id} className="tnd-tip-row">
              <span className="tnd-swatch" style={{ background: s.color }} />
              <span>{s.label}</span>
              <b>{s.values[hover] === null ? "—" : `${fmt(s.values[hover] as number, locale)}${s.unit}`}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function bandClass(pct: number | null): string {
  if (pct === null) return "none";
  if (pct > 100) return "suspect";
  if (pct >= 70) return "ok";
  if (pct >= 50) return "warn";
  return "low";
}

function Heatmap({ data, locale, p }: { data: TrendBreakdown; locale: string; p: Text }) {
  const showValues = data.starts.length <= 31;
  const label = (iso: string) =>
    data.period.group === "month"
      ? formatIsoDate(iso, locale, { month: "short" })
      : formatIsoDate(iso, locale, { day: "2-digit" });
  return (
    <div>
      <div className="tnd-heat-legend">
        {(["low", "warn", "ok", "suspect"] as const).map((b) => (
          <span key={b}>
            <i className={`tnd-heat-swatch ${b}`} />
            {p.bands[b]}
          </span>
        ))}
      </div>
      <div className="tnd-heat-scroll">
        <table className="tnd-heat">
          <thead>
            <tr>
              <th className="tnd-heat-name">{p.technician}</th>
              {data.starts.map((s) => (
                <th key={s} title={formatIsoDate(s, locale, { day: "2-digit", month: "2-digit", year: "numeric" })}>
                  {label(s)}
                </th>
              ))}
              <th>{p.total}</th>
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <tr key={g.label}>
                <th className="tnd-heat-name">{g.label}</th>
                {g.points.map((pt) => (
                  <td
                    key={pt.start}
                    className={`tnd-heat-cell ${bandClass(pt.utilization_pct)}`}
                    title={`${g.label} · ${formatIsoDate(pt.start, locale, { day: "2-digit", month: "2-digit" })}: ${pt.utilization_pct === null ? "—" : `${pt.utilization_pct}%`}`}
                  >
                    {showValues && pt.utilization_pct !== null ? pt.utilization_pct : ""}
                  </td>
                ))}
                <td className={`tnd-heat-cell ${bandClass(g.totals.utilization_pct)} tnd-heat-total`}>
                  {g.totals.utilization_pct === null ? "—" : `${g.totals.utilization_pct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function useRemote<T>(enabled: boolean, key: string, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: "", data: null, error: null });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null });
      })
      .catch((e) => {
        if (!cancelled) setState({ key, data: null, error: e?.response?.data?.detail ?? "" });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key]);
  const fresh = state.key === key;
  return { data: fresh ? state.data : null, error: fresh ? state.error : null, loading: enabled && !fresh };
}

interface SectionProps {
  segment: Segment;
  query: TrendQuery;
  baseKey: string;
  range: DateRange;
  p: Text;
  locale: string;
  expanded: boolean;
  hidden: boolean;
  onToggleExpand: () => void;
}

/** Bloco de gráficos de um segmento (Operação, Produção, Comparativos ou Qualidade), com seus próprios subgráficos. */
function TrendSection({ segment, query, baseKey: sharedKey, range, p, locale, expanded, hidden: collapsedAway, onToggleExpand }: SectionProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [table, setTable] = useState(false);
  const [viewId, setViewId] = useState<ViewId>(() => VIEWS.find((x) => x.segment === segment)!.id);
  const [dimension, setDimension] = useState<Exclude<TrendDimension, "technician">>("site");
  const [measure, setMeasure] = useState<Measure>("hours_execution");
  const [activityCode, setActivityCode] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const baseKey = `${sharedKey}|${reloadKey}`;
  const needsTrends = ["overview", "utilization", "unproductive", "manhours", "previous"].includes(viewId);
  const needsProduction = ["flow", "backlog", "planning", "estimate", "productivity", "quality", "incomplete"].includes(viewId);
  const needsBreakdown = viewId === "by" || viewId === "heatmap";
  const breakdownDim: TrendDimension = viewId === "heatmap" ? "technician" : dimension;

  const trends = useRemote<IndicatorsTrends>(needsTrends, baseKey, () =>
    indicatorsApi.trends({ dateFrom: query.dateFrom, dateTo: query.dateTo, group: query.group, site: query.site, client: query.client, region: query.region }),
  );
  // Período anterior: mesmo tamanho, imediatamente antes, no mesmo agrupamento do atual.
  const days = daysInclusive(range.start, range.end);
  const prevTo = addDaysIso(range.start, -1);
  const prevFrom = addDaysIso(prevTo, -(days - 1));
  const resolvedGroup = trends.data?.period.group;
  const previous = useRemote<IndicatorsTrends>(viewId === "previous" && !!resolvedGroup, `${baseKey}|prev|${resolvedGroup}`, () =>
    indicatorsApi.trends({ dateFrom: prevFrom, dateTo: prevTo, group: resolvedGroup, site: query.site, client: query.client, region: query.region }),
  );
  const production = useRemote<TrendProduction>(needsProduction, baseKey, () => indicatorsExtraApi.production(query));
  const breakdown = useRemote<TrendBreakdown>(needsBreakdown, `${baseKey}|${breakdownDim}`, () => indicatorsExtraApi.breakdown(query, breakdownDim));

  const remotes = needsTrends ? (viewId === "previous" ? [trends, previous] : [trends]) : needsProduction ? [production] : [breakdown];
  const loading = remotes.some((r) => r.loading);
  const error = remotes.find((r) => r.error !== null)?.error ?? null;

  const activities = production.data?.activities ?? [];
  const activity = activities.find((a) => a.code === activityCode) ?? activities[0];

  const model = useMemo<ChartModel | null>(() => {
    const trendsData = trends.data;
    const prod = production.data;
    const bd = breakdown.data;
    const s = (id: string, label: string, color: number, unitStr: string, values: (number | null)[], total: number | null, dashed = false): ChartSeries => ({
      id,
      label,
      unit: unitStr,
      color: COLOR(color),
      values,
      total,
      dashed,
    });
    const fromTrends = (pts: TrendPoint[], key: keyof Omit<TrendPoint, "start">) => pts.map((pt) => pt[key] as number | null);
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

    if (needsTrends && trendsData && viewId !== "previous") {
      const pts = trendsData.points;
      const t = trendsData.totals;
      const base = { starts: pts.map((pt) => pt.start), group: trendsData.period.group, title: p.views[viewId] };
      if (viewId === "overview")
        return {
          ...base,
          kind: "line",
          series: [
            s("hours_execution", p.series.hours_execution, 1, "h", fromTrends(pts, "hours_execution"), t.hours_execution),
            s("hours_unproductive", p.series.hours_unproductive, 2, "h", fromTrends(pts, "hours_unproductive"), t.hours_unproductive),
            s("tasks_executed", p.series.tasks_executed, 3, "", fromTrends(pts, "tasks_executed"), t.tasks_executed),
          ],
        };
      if (viewId === "utilization")
        return { ...base, kind: "line", ref: 70, minMax: 100, series: [s("utilization_pct", p.series.utilization_pct, 1, "%", fromTrends(pts, "utilization_pct"), t.utilization_pct)] };
      if (viewId === "unproductive")
        return {
          ...base,
          kind: "stack",
          series: [
            s("hours_external_block", p.series.hours_external_block, 2, "h", fromTrends(pts, "hours_external_block"), t.hours_external_block),
            s("hours_internal_idle", p.series.hours_internal_idle, 1, "h", fromTrends(pts, "hours_internal_idle"), t.hours_internal_idle),
          ],
        };
      if (viewId === "manhours")
        return {
          ...base,
          kind: "line",
          series: [
            s("man_hours", p.series.man_hours, 4, "h", fromTrends(pts, "man_hours"), t.man_hours),
            s("hours_execution", p.series.hours_execution, 1, "h", fromTrends(pts, "hours_execution"), t.hours_execution),
          ],
        };
    }
    if (viewId === "previous" && trendsData && previous.data) {
      const cur = trendsData.points;
      const prev = previous.data.points;
      const starts = cur.map((pt) => pt.start);
      const prevVals = starts.map((_, i) => (prev[i] ? (prev[i][measure] as number | null) : null));
      const fmtDay = (iso: string) => formatIsoDate(iso, locale, { day: "2-digit", month: "2-digit" });
      return {
        starts,
        group: trendsData.period.group,
        title: p.views.previous,
        kind: "line",
        minMax: measure === "utilization_pct" ? 100 : undefined,
        ref: measure === "utilization_pct" ? 70 : undefined,
        series: [
          s("current", `${p.currentPeriod} (${fmtDay(range.start)}–${fmtDay(range.end)})`, 1, MEASURE_UNIT[measure], fromTrends(cur, measure), trendsData.totals[measure]),
          s("previous", `${p.previousPeriod} (${fmtDay(prevFrom)}–${fmtDay(prevTo)})`, 8, MEASURE_UNIT[measure], prevVals, previous.data.totals[measure], true),
        ],
      };
    }
    if (prod && needsProduction) {
      const f = prod.flow;
      const q = prod.quality;
      const base = { starts: f.map((pt) => pt.start), group: prod.period.group, title: p.views[viewId] };
      if (viewId === "flow")
        return {
          ...base,
          kind: "line",
          series: [
            s("tasks_created", p.series.tasks_created, 2, "", f.map((x) => x.tasks_created), sum(f.map((x) => x.tasks_created))),
            s("tasks_completed", p.series.tasks_completed, 3, "", f.map((x) => x.tasks_completed), sum(f.map((x) => x.tasks_completed))),
          ],
        };
      if (viewId === "backlog")
        return { ...base, kind: "line", series: [s("backlog", p.series.backlog, 4, "", f.map((x) => x.backlog), f.length ? f[f.length - 1].backlog : null)] };
      if (viewId === "planning")
        return {
          ...base,
          kind: "line",
          series: [
            s("tasks_planned", p.series.tasks_planned, 1, "", f.map((x) => x.tasks_planned), sum(f.map((x) => x.tasks_planned))),
            s("tasks_completed", p.series.tasks_completed, 3, "", f.map((x) => x.tasks_completed), sum(f.map((x) => x.tasks_completed))),
          ],
        };
      if (viewId === "estimate")
        return {
          ...base,
          kind: "line",
          series: [
            s("hours_estimated", p.series.hours_estimated, 1, "h", f.map((x) => x.hours_estimated), sum(f.map((x) => x.hours_estimated))),
            s("hours_real", p.series.hours_real, 2, "h", f.map((x) => x.hours_real), sum(f.map((x) => x.hours_real))),
          ],
        };
      if (viewId === "productivity" && activity)
        return { ...base, kind: "line", series: [s("rate", activity.name, 1, `${activity.unit ? ` ${activity.unit}` : ""}/h`, activity.points, activity.rate)] };
      if (viewId === "quality")
        return {
          ...base,
          kind: "stack",
          series: [
            s("no_hours", p.series.no_hours, 2, "", q.map((x) => x.no_hours), sum(q.map((x) => x.no_hours))),
            s("batch", p.series.batch, 4, "", q.map((x) => x.batch), sum(q.map((x) => x.batch))),
          ],
        };
      if (viewId === "incomplete")
        return { ...base, kind: "line", series: [s("incomplete_days", p.series.incomplete_days, 2, "", q.map((x) => x.incomplete_days), sum(q.map((x) => x.incomplete_days)))] };
    }
    if (viewId === "by" && bd) {
      return {
        starts: bd.starts,
        group: bd.period.group,
        title: p.views.by,
        kind: "line",
        minMax: measure === "utilization_pct" ? 100 : undefined,
        ref: measure === "utilization_pct" ? 70 : undefined,
        series: bd.groups.map((g, i) =>
          s(g.label, g.other ? p.others : g.label, g.other ? 8 : i + 1, MEASURE_UNIT[measure], g.points.map((pt) => pt[measure] as number | null), g.totals[measure]),
        ),
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trends.data, previous.data, production.data, breakdown.data, viewId, measure, activity, p, locale]);

  const hasData = !!model && model.series.some((x) => x.values.some((val) => val));
  const heatmapHasData = !!breakdown.data && breakdown.data.groups.length > 0;
  const isHeatmap = viewId === "heatmap";

  function toggleSeries(id: string) {
    if (!model) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (model.series.filter((x) => !next.has(x.id)).length > 1) next.add(id);
      return next;
    });
  }

  function selectView(id: ViewId) {
    setViewId(id);
    setHidden(new Set());
    setTable(false);
  }

  const viewsOfSegment = VIEWS.filter((x) => x.segment === segment);

  return (
      <section className={`tnd-card${expanded ? " expanded" : ""}${collapsedAway ? " away" : ""}`} aria-busy={loading}>
        <div className="tnd-head">
          <h2 className="tnd-section-title">{p.segments[segment]}</h2>
          <button
            type="button"
            className="tnd-expand"
            onClick={onToggleExpand}
            title={expanded ? p.recolher : p.expandir}
            aria-label={expanded ? p.recolher : p.expandir}
            aria-pressed={expanded}
          >
            <Icon name={expanded ? "close_fullscreen" : "open_in_full"} style={{ fontSize: 18 }} />
          </button>
          <span className="tnd-info" title={p.notes[viewId]} aria-label={p.notes[viewId]} tabIndex={0}>
            <Icon name="info" style={{ fontSize: 16 }} />
          </span>
          <div className="tnd-views" role="group" aria-label={p.segments[segment]}>
            {viewsOfSegment.map((vw) => (
              <button
                key={vw.id}
                type="button"
                className={`tnd-view${viewId === vw.id ? " active" : ""}`}
                aria-pressed={viewId === vw.id}
                onClick={() => selectView(vw.id)}
              >
                {p.views[vw.id]}
              </button>
            ))}
          </div>
        </div>
        {error !== null && !loading && (
          <div className="rpt-notice rpt-notice--error rpt-notice--block" role="alert">
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

        {(viewId === "by" || viewId === "previous") && (
          <div className="tnd-controls">
            {viewId === "by" && (
              <div className="rpt-presets" role="group" aria-label={p.compararPor}>
                <span className="tnd-controls-label">{p.compararPor}</span>
                {DIMENSIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`rpt-preset${dimension === d ? " active" : ""}`}
                    aria-pressed={dimension === d}
                    onClick={() => {
                      setDimension(d);
                      setHidden(new Set());
                    }}
                  >
                    {p.dimensions[d]}
                  </button>
                ))}
              </div>
            )}
            <div className="rpt-presets" role="group" aria-label={p.medida}>
              <span className="tnd-controls-label">{p.medida}</span>
              {MEASURES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`rpt-preset${measure === m ? " active" : ""}`}
                  aria-pressed={measure === m}
                  onClick={() => {
                    setMeasure(m);
                    setHidden(new Set());
                  }}
                >
                  {p.series[m]}
                </button>
              ))}
            </div>
          </div>
        )}

        {viewId === "productivity" && activities.length > 0 && (
          <div className="tnd-controls">
            <span className="tnd-controls-label">{p.atividade}</span>
            <SearchSelect
              className="tnd-activity-select"
              options={activities.map((a) => ({ value: a.code, label: a.name, sublabel: `${a.code} · ${a.executions} ${p.execucoes}` }))}
              value={activity?.code ?? ""}
              onChange={(val) => setActivityCode(String(val))}
              clearable={false}
            />
          </div>
        )}

        {!isHeatmap && model && (
          <div className="tnd-legend" role="group" aria-label={p.views[viewId]}>
            {model.series.map((sr) => (
              <button
                key={sr.id}
                type="button"
                className={`tnd-legend-item${hidden.has(sr.id) ? " off" : ""}`}
                aria-pressed={!hidden.has(sr.id)}
                title={p.ocultar}
                onClick={() => toggleSeries(sr.id)}
              >
                <span className="tnd-swatch" style={{ background: sr.color }} />
                <span className="tnd-legend-name">{sr.label}</span>
                <b className="tnd-legend-total">{sr.total === null ? "—" : `${fmt(sr.total, locale)}${sr.unit}`}</b>
              </button>
            ))}
            <button type="button" className="btn btn-outline btn-sm tnd-toggle" onClick={() => setTable((t) => !t)}>
              <Icon name={table ? "show_chart" : "table_chart"} style={{ fontSize: 16 }} />
              {table ? p.verGrafico : p.verTabela}
            </button>
          </div>
        )}

        {loading && !model && !heatmapHasData && <p className="mgr-status" role="status">{p.carregando}</p>}
        {!loading && viewId === "productivity" && production.data && activities.length === 0 && <p className="mgr-status">{p.semProdutividade}</p>}
        {!loading && !isHeatmap && model && !hasData && viewId !== "productivity" && <p className="mgr-status">{p.vazio}</p>}
        {!loading && isHeatmap && breakdown.data && !heatmapHasData && <p className="mgr-status">{p.vazio}</p>}

        {isHeatmap && heatmapHasData && breakdown.data && <Heatmap data={breakdown.data} locale={locale} p={p} />}

        {!isHeatmap && model && hasData && !table && <TrendChart model={model} hidden={hidden} locale={locale} />}

        {!isHeatmap && model && hasData && table && (
          <div className="tnd-table-wrap">
            <table className="table tnd-table">
              <thead>
                <tr>
                  <th>{p.periodo}</th>
                  {model.series.map((sr) => (
                    <th key={sr.id} className="num">{sr.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.starts.map((st, i) => (
                  <tr key={st}>
                    <td>{formatIsoDate(st, locale, { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                    {model.series.map((sr) => (
                      <td key={sr.id} className="num">
                        {sr.values[i] === null || sr.values[i] === undefined ? "—" : fmt(sr.values[i] as number, locale)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{p.total}</th>
                  {model.series.map((sr) => (
                    <th key={sr.id} className="num">{sr.total === null ? "—" : fmt(sr.total, locale)}</th>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
  );
}

export default function IndicatorsTrendsPage() {
  const { locale } = useI18n();
  const p = usePageText(TEXT);
  const [range, setRange] = useState<DateRange>(() => ({ start: brazilDaysAgoIso(29), end: brazilTodayIso() }));
  const [group, setGroup] = useState<"auto" | ManagementGroup>("auto");
  const [sites, setSites] = useState<Site[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [siteSel, setSiteSel] = useState<string[]>([]);
  const [clientSel, setClientSel] = useState<string[]>([]);
  const [regionSel, setRegionSel] = useState<string[]>([]);

  useEffect(() => {
    sitesApi.list().then((r) => setSites(r.results)).catch(() => undefined);
    clientsApi.list().then((r) => setClients(r.results)).catch(() => undefined);
    regionsApi.list().then((r) => setRegions(r.results)).catch(() => undefined);
  }, []);

  const query: TrendQuery = {
    dateFrom: range.start,
    dateTo: range.end,
    group: group === "auto" ? undefined : group,
    site: siteSel.join(","),
    client: clientSel.join(","),
    region: regionSel.join(","),
  };
  const baseKey = `${range.start}|${range.end}|${group}|${siteSel.join(",")}|${clientSel.join(",")}|${regionSel.join(",")}`;
  const activePreset = PERIOD_PRESETS.find((d) => range.end === brazilTodayIso() && range.start === brazilDaysAgoIso(d - 1));

  function changeRange(next: DateRange | null) {
    setRange(next ?? { start: brazilDaysAgoIso(29), end: brazilTodayIso() });
  }

  // A página ocupa exatamente a altura da tela (2 blocos em cima e 2 embaixo, sem rolagem).
  const [expandedSeg, setExpandedSeg] = useState<Segment | null>(null);
  useEffect(() => {
    if (!expandedSeg) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpandedSeg(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedSeg]);
  const pageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = pageRef.current;
      if (!el) return;
      if (window.innerWidth < 1100) {
        el.style.height = "";
        return;
      }
      const top = el.getBoundingClientRect().top;
      el.style.height = `${Math.max(620, window.innerHeight - top - 12)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div className="tnd-page" ref={pageRef}>
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={p.subtitle}
        actions={
          <div className="ops-toolbar rpt-header-tools">
            <MultiSelectFilter
              label={p.site}
              options={sites.map((x) => ({ value: String(x.id), label: x.name || x.code }))}
              selected={siteSel}
              onChange={setSiteSel}
              allLabel={p.todosSites}
            />
            <MultiSelectFilter
              label={p.cliente}
              options={clients.map((c) => ({ value: String(c.id), label: c.name }))}
              selected={clientSel}
              onChange={setClientSel}
              allLabel={p.todosClientes}
            />
            <MultiSelectFilter
              label={p.regional}
              options={regions.map((r) => ({ value: String(r.id), label: r.name, hint: r.country_display }))}
              selected={regionSel}
              onChange={setRegionSel}
              allLabel={p.todasRegionais}
            />
          </div>
        }
      />

      <div className="rpt-period-bar">
        <DateRangeCalendar value={range} onChange={changeRange} maxDays={MAX_PERIOD_DAYS} emitPartial={false} />
        <div className="rpt-presets" role="group" aria-label={p.periodo}>
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
        <span className="mgr-hint">
          {daysInclusive(range.start, range.end)} {p.dias}
        </span>
      </div>

      <div className="tnd-grid2">
        {SEGMENTS.map((sg) => (
          <TrendSection
            key={sg}
            segment={sg}
            query={query}
            baseKey={baseKey}
            range={range}
            p={p}
            locale={locale}
            expanded={expandedSeg === sg}
            hidden={expandedSeg !== null && expandedSeg !== sg}
            onToggleExpand={() => setExpandedSeg((cur) => (cur === sg ? null : sg))}
          />
        ))}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { operationsApi } from "../../api/resources";
import type { BlockTimes, BlockTimesRow } from "../../api/types";
import { useI18n, usePageText } from "../../i18n";
import { downloadCsv, type CsvCell } from "../../utils/csv";
import Icon from "../ui/Icon";

const TEXT = {
  "pt-BR": {
    title: "Tempo por unidade e workflow do cabo",
    hint: "Medido = pacote de uma atividade (materiais podem variar) feito de uma vez: tempo do pacote ÷ quantidade produzida. O pacote vem do despacho: tarefas do mesmo técnico iniciadas e concluídas juntas. Pacote que mistura atividades, ou com mais de 6 h, não mede. “Todos os materiais” reúne todos os pacotes da atividade; no workflow de um grupo sem medição própria, usa esse tempo ajustado ao material. Estimado = apontamento tarefa a tarefa limitado a 7 h de trabalho por técnico por dia: só ordem de grandeza. O workflow de um cabo soma os minutos por cabo das etapas do grupo.",
    blocksInfo: (n: number, partial: number, packages?: { clean: number; mixed: number; too_long: number }) =>
      `${n} ${n === 1 ? "pacote medido" : "pacotes medidos"} no período${partial > 0 ? ` · ${partial} ${partial === 1 ? "bloco parcial ignorado" : "blocos parciais ignorados"}` : ""}${
        packages && packages.mixed + packages.too_long > 0
          ? ` · não medem: ${packages.mixed} misturado${packages.mixed === 1 ? "" : "s"}, ${packages.too_long} longo${packages.too_long === 1 ? "" : "s"} demais`
          : ""
      }`,
    allGroups: "Todos os grupos",
    exportCsv: "Exportar CSV",
    workflowTitle: "Workflow de um cabo (minutos de trabalho por cabo)",
    total: "Total",
    missing: (names: string) => `Faltam dados: ${names}`,
    measured: "Medido",
    measuredFew: (n: number, min: number) => `Medido · amostra pequena (${n} de ${min})`,
    estimated: "Estimado",
    noData: "Sem dado",
    tableTitle: "Tempo por unidade por atividade e grupo",
    colActivity: "Atividade",
    colGroup: "Grupo",
    colUnit: "Unidade",
    colSource: "Origem",
    colSample: "Amostra",
    colTime: "Tempo por unidade",
    colRange: "Faixa típica (P25–P75)",
    colPerCable: "Min por cabo",
    blocks: (n: number) => `${n} ${n === 1 ? "pacote" : "pacotes"}`,
    records: (n: number) => `${n} ${n === 1 ? "apontamento" : "apontamentos"}`,
    empty: "Ainda sem blocos nem apontamentos com quantidade no período.",
    loading: "Carregando…",
    error: "Não foi possível carregar o tempo por unidade.",
    minSuffix: "min",
    csvName: "tempo-por-unidade",
    sumTitle: "Tempo por atividade",
    sumHint: "O número principal de cada atividade, com todos os materiais juntos: tempo de trabalho por unidade produzida (metro, label, conector...). Medido nos pacotes despachados; sem pacotes limpos, aparece como estimado. A variação compara com o período anterior de mesmo tamanho (menos tempo é melhor).",
    sumEstimated: "Estimado",
    sumSmall: (n: number, min: number) => `Amostra pequena (${n} de ${min})`,
    sumMeasured: (n: number) => `Medido · ${n} ${n === 1 ? "pacote" : "pacotes"}`,
    sumNoData: "Sem dado no período",
    sumRange: "Faixa típica",
    sumPerHour: "por hora de trabalho",
    sumFaster: "mais rápido",
    sumSlower: "mais lento",
    sumPrevious: "vs. período anterior",
  },
  "en-US": {
    title: "Time per unit and cable workflow",
    hint: "Measured = package of one activity (materials may vary) done in one go: package time ÷ quantity produced. The package comes from dispatch: tasks of the same technician started and completed together. A package mixing activities, or over 6 h, is not measured. “All materials” pools every package of the activity; in a group's workflow without its own measurement, that time is used, adjusted to the material. Estimated = task-by-task logging capped at 7 working hours per technician per day: order of magnitude only. A cable's workflow adds up the minutes per cable of the group's steps.",
    blocksInfo: (n: number, partial: number, packages?: { clean: number; mixed: number; too_long: number }) =>
      `${n} measured ${n === 1 ? "package" : "packages"} in the period${partial > 0 ? ` · ${partial} partial ${partial === 1 ? "block" : "blocks"} ignored` : ""}${
        packages && packages.mixed + packages.too_long > 0 ? ` · not measured: ${packages.mixed} mixed, ${packages.too_long} too long` : ""
      }`,
    allGroups: "All groups",
    exportCsv: "Export CSV",
    workflowTitle: "Cable workflow (working minutes per cable)",
    total: "Total",
    missing: (names: string) => `Missing data: ${names}`,
    measured: "Measured",
    measuredFew: (n: number, min: number) => `Measured · small sample (${n} of ${min})`,
    estimated: "Estimated",
    noData: "No data",
    tableTitle: "Time per unit by activity and group",
    colActivity: "Activity",
    colGroup: "Group",
    colUnit: "Unit",
    colSource: "Source",
    colSample: "Sample",
    colTime: "Time per unit",
    colRange: "Typical range (P25–P75)",
    colPerCable: "Min per cable",
    blocks: (n: number) => `${n} ${n === 1 ? "package" : "packages"}`,
    records: (n: number) => `${n} ${n === 1 ? "record" : "records"}`,
    empty: "No blocks or task records with quantity in the period yet.",
    loading: "Loading…",
    error: "Could not load time per unit.",
    minSuffix: "min",
    csvName: "time-per-unit",
    sumTitle: "Time per activity",
    sumHint: "The main number for each activity, all materials together: working time per unit produced (meter, label, connector...). Measured on dispatched packages; without clean packages it shows as estimated. The change compares with the previous period of the same length (less time is better).",
    sumEstimated: "Estimated",
    sumSmall: (n: number, min: number) => `Small sample (${n} of ${min})`,
    sumMeasured: (n: number) => `Measured · ${n} ${n === 1 ? "package" : "packages"}`,
    sumNoData: "No data in the period",
    sumRange: "Typical range",
    sumPerHour: "per working hour",
    sumFaster: "faster",
    sumSlower: "slower",
    sumPrevious: "vs. previous period",
  },
  "es-ES": {
    title: "Tiempo por unidad y workflow del cable",
    hint: "Medido = paquete de una actividad (los materiales pueden variar) hecho de una vez: tiempo del paquete ÷ cantidad producida. El paquete viene del despacho: tareas del mismo técnico iniciadas y concluidas juntas. Un paquete que mezcla actividades, o de más de 6 h, no mide. “Todos los materiales” reúne todos los paquetes de la actividad; en el workflow de un grupo sin medición propia se usa ese tiempo ajustado al material. Estimado = registro tarea a tarea limitado a 7 h de trabajo por técnico por día: solo orden de magnitud. El workflow de un cable suma los minutos por cable de las etapas del grupo.",
    blocksInfo: (n: number, partial: number, packages?: { clean: number; mixed: number; too_long: number }) =>
      `${n} ${n === 1 ? "paquete medido" : "paquetes medidos"} en el período${partial > 0 ? ` · ${partial} ${partial === 1 ? "bloque parcial ignorado" : "bloques parciales ignorados"}` : ""}${
        packages && packages.mixed + packages.too_long > 0 ? ` · no miden: ${packages.mixed} mezclados, ${packages.too_long} demasiado largos` : ""
      }`,
    allGroups: "Todos los grupos",
    exportCsv: "Exportar CSV",
    workflowTitle: "Workflow de un cable (minutos de trabajo por cable)",
    total: "Total",
    missing: (names: string) => `Faltan datos: ${names}`,
    measured: "Medido",
    measuredFew: (n: number, min: number) => `Medido · muestra pequeña (${n} de ${min})`,
    estimated: "Estimado",
    noData: "Sin dato",
    tableTitle: "Tiempo por unidad por actividad y grupo",
    colActivity: "Actividad",
    colGroup: "Grupo",
    colUnit: "Unidad",
    colSource: "Origen",
    colSample: "Muestra",
    colTime: "Tiempo por unidad",
    colRange: "Rango típico (P25–P75)",
    colPerCable: "Min por cable",
    blocks: (n: number) => `${n} ${n === 1 ? "paquete" : "paquetes"}`,
    records: (n: number) => `${n} ${n === 1 ? "registro" : "registros"}`,
    empty: "Aún sin bloques ni registros con cantidad en el período.",
    loading: "Cargando…",
    error: "No se pudo cargar el tiempo por unidad.",
    minSuffix: "min",
    csvName: "tiempo-por-unidad",
    sumTitle: "Tiempo por actividad",
    sumHint: "El número principal de cada actividad, con todos los materiales juntos: tiempo de trabajo por unidad producida (metro, label, conector...). Medido en los paquetes despachados; sin paquetes limpios aparece como estimado. La variación compara con el período anterior del mismo tamaño (menos tiempo es mejor).",
    sumEstimated: "Estimado",
    sumSmall: (n: number, min: number) => `Muestra pequeña (${n} de ${min})`,
    sumMeasured: (n: number) => `Medido · ${n} ${n === 1 ? "paquete" : "paquetes"}`,
    sumNoData: "Sin dato en el período",
    sumRange: "Rango típico",
    sumPerHour: "por hora de trabajo",
    sumFaster: "más rápido",
    sumSlower: "más lento",
    sumPrevious: "vs. período anterior",
  },
};

export default function BlockTimesCard({ siteId, start, end }: { siteId: string; start: string; end: string }) {
  const p = usePageText(TEXT);
  const { locale } = useI18n();
  const [data, setData] = useState<BlockTimes | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [group, setGroup] = useState("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    operationsApi
      .blockTimes(siteId, start, end)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, start, end]);

  const nf = useMemo(() => {
    const cache = new Map<number, Intl.NumberFormat>();
    return (v: number, digits: number) => {
      let f = cache.get(digits);
      if (!f) {
        f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        cache.set(digits, f);
      }
      return f.format(v);
    };
  }, [locale]);
  const fmtSeconds = (v: number) => (v < 90 ? `${nf(v, 0)} s` : `${nf(v / 60, 1)} ${p.minSuffix}`);
  const fmtMinutes = (v: number | null) => (v === null ? "—" : `${nf(v, 1)} ${p.minSuffix}`);

  const groups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of data?.rows ?? []) seen.set(r.work_group, r.work_group_label);
    return Array.from(seen.entries());
  }, [data]);
  const rows = (data?.rows ?? []).filter((r) => group === "all" || r.work_group === group);
  const workflows = (data?.workflows ?? []).filter((w) => group === "all" || w.work_group === group);

  function sourceBadge(row: BlockTimesRow) {
    if (row.measured) {
      return row.measured.confident ? (
        <span className="badge" style={{ background: "var(--green-soft)", color: "var(--green)" }}>{p.measured}</span>
      ) : (
        <span className="badge" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
          {p.measuredFew(row.measured.blocks, data?.min_blocks ?? 5)}
        </span>
      );
    }
    return <span className="badge" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>{p.estimated}</span>;
  }

  function exportCsv() {
    const header: CsvCell[] = [p.colActivity, p.colGroup, p.colUnit, p.colSource, p.colSample, `${p.colTime} (s)`, `${p.colPerCable}`];
    const body: CsvCell[][] = rows.map((r) => {
      const m = r.measured;
      const e = r.estimated;
      return [
        r.activity_name,
        r.work_group_label,
        r.unit,
        m ? p.measured : p.estimated,
        m ? m.blocks : (e?.records ?? 0),
        m ? m.sec_per_unit : (e?.sec_per_unit ?? null),
        m ? m.min_per_cable : (e?.min_per_cable ?? null),
      ];
    });
    downloadCsv(`${p.csvName}_${start}_${end}.csv`, [header, ...body], locale);
  }

  const summary = data?.activity_summary ?? [];

  function renderSummary() {
    if (loading || failed || summary.length === 0) return null;
    return (
      <div className="ops-pool-card rpt-card">
        <div className="ops-card-head rpt-card-head-wrap">
          <div>
            <div className="ops-card-title">{p.sumTitle}</div>
            <div className="ops-card-hint">{p.sumHint}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12, padding: "4px 16px 16px" }}>
          {summary.map((item) => {
            const m = item.measured;
            const sec = m ? m.sec_per_unit : item.estimated_sec_per_unit;
            const unit = item.unit || "un";
            const delta =
              m && item.previous_sec_per_unit ? ((m.sec_per_unit - item.previous_sec_per_unit) / item.previous_sec_per_unit) * 100 : null;
            const perHour = sec && sec > 0 ? 3600 / sec : null;
            return (
              <div key={item.activity_code} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", opacity: m ? 1 : 0.8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{item.activity_name}</div>
                <div style={{ fontSize: 26, fontWeight: 700, margin: "4px 0 2px" }}>
                  {sec === null || sec === undefined ? "—" : `${fmtSeconds(sec)}`}
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}> /{unit}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {perHour !== null ? `${nf(perHour, perHour < 10 ? 1 : 0)} ${unit} ${p.sumPerHour}` : p.sumNoData}
                </div>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {m ? (
                    <span className="badge" style={m.confident ? { background: "var(--green-soft)", color: "var(--green)" } : { background: "var(--amber-soft)", color: "var(--amber)" }}>
                      {m.confident ? p.sumMeasured(m.blocks) : p.sumSmall(m.blocks, data?.min_blocks ?? 5)}
                    </span>
                  ) : (
                    <span className="badge" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>{p.sumEstimated}</span>
                  )}
                  {delta !== null && Math.abs(delta) >= 1 && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: delta < 0 ? "var(--green)" : "var(--red)" }}>
                      {delta < 0 ? "▼" : "▲"} {nf(Math.abs(delta), 0)}% {delta < 0 ? p.sumFaster : p.sumSlower}
                    </span>
                  )}
                </div>
                {m && m.blocks > 1 && (
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                    {p.sumRange}: {fmtSeconds(m.p25_sec_per_unit)} – {fmtSeconds(m.p75_sec_per_unit)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      {renderSummary()}
      {renderDetail()}
    </>
  );

  function renderDetail() {
  return (
    <div className="ops-pool-card rpt-card">
      <div className="ops-card-head rpt-card-head-wrap">
        <div>
          <div className="ops-card-title">{p.title}</div>
          <div className="ops-card-hint">{p.hint}</div>
          {data && <div className="ops-card-hint">{p.blocksInfo(data.blocks_total, data.partial_blocks, data.packages)}</div>}
        </div>
        <select className="select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label={p.colGroup}>
          <option value="all">{p.allGroups}</option>
          {groups.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv} disabled={rows.length === 0}>
          <Icon name="download" style={{ fontSize: 16 }} />
          {p.exportCsv}
        </button>
      </div>

      {loading && <div className="table-empty rpt-empty-block">{p.loading}</div>}
      {failed && !loading && <div className="table-empty rpt-empty-block">{p.error}</div>}
      {!loading && !failed && data && rows.length === 0 && <div className="table-empty rpt-empty-block">{p.empty}</div>}

      {!loading && !failed && workflows.length > 0 && (
        <div style={{ padding: "4px 16px 12px" }}>
          <div className="rpt-strong" style={{ margin: "8px 0" }}>{p.workflowTitle}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {workflows.map((w) => (
              <div key={w.work_group} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <strong>{w.work_group_label}</strong>
                  <strong style={{ color: w.complete ? "var(--text)" : "var(--amber)" }}>
                    {fmtMinutes(w.total_min_per_cable)}
                    {!w.complete && " *"}
                  </strong>
                </div>
                {w.steps.map((s) => (
                  <div key={s.activity_code} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
                    <span>{s.activity_name}</span>
                    <span style={{ color: s.source === "measured" ? "var(--green)" : s.source === "pooled" ? "var(--blue)" : s.source === "estimated" ? "var(--text-muted)" : "var(--faint, var(--text-faint))" }}>
                      {s.min_per_cable === null ? p.noData : fmtMinutes(s.min_per_cable)}
                      {s.source === "pooled" && " ≈"}
                      {s.source === "estimated" && " ~"}
                    </span>
                  </div>
                ))}
                {w.missing.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 6 }}>{p.missing(w.missing.join(", "))}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !failed && rows.length > 0 && (
        <div className="table-wrap rpt-scroll">
          <div className="rpt-strong" style={{ padding: "8px 16px 0" }}>{p.tableTitle}</div>
          <table className="table rpt-table-dense">
            <thead>
              <tr>
                <th>{p.colActivity}</th>
                <th>{p.colGroup}</th>
                <th>{p.colUnit}</th>
                <th>{p.colSource}</th>
                <th className="rpt-num">{p.colSample}</th>
                <th className="rpt-num">{p.colTime}</th>
                <th className="rpt-num">{p.colRange}</th>
                <th className="rpt-num">{p.colPerCable}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = r.measured;
                const e = r.estimated;
                const sec = m ? m.sec_per_unit : e?.sec_per_unit;
                const perCable = m ? m.min_per_cable : (e?.min_per_cable ?? null);
                return (
                  <tr key={`${r.activity_code}|${r.work_group}`} style={m ? undefined : { color: "var(--text-muted)" }}>
                    <td className="rpt-strong">{r.activity_name}</td>
                    <td>{r.work_group_label}</td>
                    <td>{r.unit || "—"}</td>
                    <td>{sourceBadge(r)}</td>
                    <td className="rpt-num">{m ? p.blocks(m.blocks) : p.records(e?.records ?? 0)}</td>
                    <td className="rpt-num rpt-strong">{sec !== undefined ? `${fmtSeconds(sec)}/${r.unit || "un"}` : "—"}</td>
                    <td className="rpt-num">
                      {m && m.blocks > 1 ? `${fmtSeconds(m.p25_sec_per_unit)} – ${fmtSeconds(m.p75_sec_per_unit)}` : "—"}
                    </td>
                    <td className="rpt-num">{fmtMinutes(perCable)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
  }
}

import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import TimelineAdjustModal from "../components/projects/TimelineAdjustModal";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type { OperationsTimeline } from "../api/types";
import DateInput from "../components/ui/DateInput";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import { useI18n, usePageText } from "../i18n";
import {
  BUSY_COLOR,
  DONE_COLOR,
  HOURS,
  PRESENCE_COLOR,
  WINDOW_END_HOUR,
  WINDOW_START_HOUR,
  assignLanes,
  buildTechSegments,
  collapseLanes,
  formatTime,
  initials,
  pairRowClass,
  pct,
  reorderRowsByPair,
} from "../utils/timeline";

const TEXT = {
  "pt-BR": {
    eyebrow: "Central de Operações",
    title: "Timeline Operacional",
    subtitle: "Visão em Gantt — histórico por técnico",
    prevDay: "Dia anterior",
    nextDay: "Próximo dia",
    today: "Hoje",
    viewDay: "Dia",
    viewWeek: "Semana",
    viewMonth: "Mês",
    comingSoon: "Em breve",
    filters: "Filtros",
    siteLabel: "Site",
    allSites: "Todos os sites",
    techniciansLabel: (n: number) => `Técnicos${n > 0 ? ` (${n} selecionado(s))` : ""}`,
    clearSelection: "Limpar seleção",
    allTechnicians: "Todos",
    loading: "Carregando...",
    legendDone: "Concluída",
    legendInProgress: "Em execução",
    legendAvailable: "Disponível",
    legendPause: "Pausa",
    legendLunch: "Horário de Almoço",
    legendPersonal: "Particular",
    legendMeal: "Café",
    legendMeeting: "Reunião",
    legendTraveling: "Em Deslocamento",
    legendSupport: "Apoio a outro técnico",
    expandLanes: (n: number) => `▾ +${n} simultâneas`,
    collapseLanes: "▴ Recolher",
    legendSiteBlocked: "Sem Acesso ao Site",
    legendAwaitingRelease: "Aguardando Liberações",
    legendIdle: "Não iniciado / Fim de Expediente",
    doneCount: (n: number) => `${n} finalizada${n === 1 ? "" : "s"}`,
    nowPrefix: "agora ",
    noActivity: "Sem atividade neste dia",
    inProgress: " – em andamento",
    closePopup: "Fechar",
    noTechForDate: (d: string) => `Nenhum técnico encontrado para ${d}.`,
    noFilteredTech: "Nenhum dos técnicos selecionados está disponível neste filtro.",
  },
  "en-US": {
    eyebrow: "Operations Center",
    title: "Operational Timeline",
    subtitle: "Gantt view — history by technician",
    prevDay: "Previous day",
    nextDay: "Next day",
    today: "Today",
    viewDay: "Day",
    viewWeek: "Week",
    viewMonth: "Month",
    comingSoon: "Coming soon",
    filters: "Filters",
    siteLabel: "Site",
    allSites: "All sites",
    techniciansLabel: (n: number) => `Technicians${n > 0 ? ` (${n} selected)` : ""}`,
    clearSelection: "Clear selection",
    allTechnicians: "All",
    loading: "Loading...",
    legendDone: "Completed",
    legendInProgress: "In progress",
    legendAvailable: "Available",
    legendPause: "Break",
    legendLunch: "Lunch break",
    legendPersonal: "Personal",
    legendMeal: "Coffee Break",
    legendMeeting: "Meeting",
    legendTraveling: "Traveling",
    legendSupport: "Supporting another technician",
    expandLanes: (n: number) => `▾ +${n} concurrent`,
    collapseLanes: "▴ Collapse",
    legendSiteBlocked: "No Site Access",
    legendAwaitingRelease: "Awaiting Releases",
    legendIdle: "Not started / End of shift",
    doneCount: (n: number) => `${n} completed`,
    nowPrefix: "now ",
    noActivity: "No activity on this day",
    inProgress: " – in progress",
    closePopup: "Close",
    noTechForDate: (d: string) => `No technician found for ${d}.`,
    noFilteredTech: "None of the selected technicians are available in this filter.",
  },
  "es-ES": {
    eyebrow: "Centro de Operaciones",
    title: "Línea de Tiempo Operacional",
    subtitle: "Vista Gantt — historial por técnico",
    prevDay: "Día anterior",
    nextDay: "Día siguiente",
    today: "Hoy",
    viewDay: "Día",
    viewWeek: "Semana",
    viewMonth: "Mes",
    comingSoon: "Próximamente",
    filters: "Filtros",
    siteLabel: "Sitio",
    allSites: "Todos los sitios",
    techniciansLabel: (n: number) => `Técnicos${n > 0 ? ` (${n} seleccionado(s))` : ""}`,
    clearSelection: "Limpiar selección",
    allTechnicians: "Todos",
    loading: "Cargando...",
    legendDone: "Completada",
    legendInProgress: "En ejecución",
    legendAvailable: "Disponible",
    legendPause: "Pausa",
    legendLunch: "Hora de almuerzo",
    legendPersonal: "Personal",
    legendMeal: "Café",
    legendMeeting: "Reunión",
    legendTraveling: "En desplazamiento",
    legendSupport: "Apoyo a otro técnico",
    expandLanes: (n: number) => `▾ +${n} simultáneas`,
    collapseLanes: "▴ Contraer",
    legendSiteBlocked: "Sin acceso al sitio",
    legendAwaitingRelease: "Esperando liberaciones",
    legendIdle: "No iniciado / Fin de jornada",
    doneCount: (n: number) => `${n} finalizada${n === 1 ? "" : "s"}`,
    nowPrefix: "ahora ",
    noActivity: "Sin actividad en este día",
    inProgress: " – en curso",
    closePopup: "Cerrar",
    noTechForDate: (d: string) => `No se encontró técnico para ${d}.`,
    noFilteredTech: "Ninguno de los técnicos seleccionados está disponible en este filtro.",
  },
};

type BarPopup = {
  key: string;
  label: string;
  start: Date;
  end: Date | null;
  color: string;
  top: number;
  left: number;
};

function formatDateBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type ViewMode = "day" | "week" | "month";

export default function TimelineOperacional() {
  const p = usePageText(TEXT);
  const { locale } = useI18n();
  const [sites, setSites] = useState<Site[]>([]);
  // "all" ou um ou mais ids separados por vírgula ("12,15")
  const [siteId, setSiteId] = useState<string>("all");
  const showSiteLabels = !/^\d+$/.test(siteId);
  const [selectedTechIds, setSelectedTechIds] = useState<number[]>([]);
  const [date, setDate] = useState(() => todayISO());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<OperationsTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [popup, setPopup] = useState<BarPopup | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sitesApi.list().then((res) => setSites(res.results));
  }, []);

  useEffect(() => {
    setLoading(true);
    operationsApi
      .timeline(siteId, date)
      .then(setData)
      .finally(() => setLoading(false));
  }, [siteId, date]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPopup(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const { user } = useAuth();
  const [adjustTech, setAdjustTech] = useState<{ id: number; name: string } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  function toggleRow(techId: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(techId)) next.delete(techId); else next.add(techId);
      return next;
    });
  }

  const technicians = data?.technicians || [];
  const isToday = data?.is_today ?? date === todayISO();
  const base = data?.date ? new Date(`${data.date}T00:00:00`) : new Date();
  const nowPct = isToday ? pct(now, base) : null;

  const techRows = reorderRowsByPair(
    technicians
      .filter((tech) => selectedTechIds.length === 0 || selectedTechIds.includes(tech.id))
      .map((tech) => {
        const segments = buildTechSegments(tech.blocks, tech.status_events, now, isToday, locale);
        const lanes = collapseLanes(assignLanes(segments), expandedRows.has(tech.id));
        return {
          tech,
          lanedSegments: lanes.visible,
          laneCount: lanes.laneCount,
          hiddenCount: lanes.hiddenCount,
          collapsible: lanes.collapsible,
          expanded: lanes.expanded,
          doneCount: tech.blocks.filter((b) => b.status === "completed").length,
        };
      })
  );
  const trackHeight = (count: number) => (count <= 1 ? 44 : 10 + count * 30);
  // A coluna de nomes e a de barras têm a mesma altura por técnico; os botões abaixo do nome
  // (expandir simultâneas / ajustar) precisam de linhas extras, senão vazam sobre o técnico de baixo.
  const isAdmin = !!user?.is_superuser;
  const rowHeight = (count: number, collapsible: boolean) => {
    const buttons = (collapsible ? 1 : 0) + (isAdmin ? 1 : 0);
    return Math.max(trackHeight(count), 44 + buttons * 24);
  };
  const barTop = (index: number, _count: number) => 6 + index * 30;
  const barHeight = (_count: number) => 22;

  return (
    <div>
      <PageHeader eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} />

      <div className="tl-toolbar">
        <div className="tl-date-nav">
          <button className="tl-nav-btn" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label={p.prevDay}>
            <Icon name="chevron_left" style={{ fontSize: 18 }} />
          </button>
          <DateInput value={date} onChange={setDate} style={{ width: 150 }} />
          <button className="tl-nav-btn" onClick={() => setDate((d) => shiftDate(d, 1))} aria-label={p.nextDay}>
            <Icon name="chevron_right" style={{ fontSize: 18 }} />
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setDate(todayISO())}>
            {p.today}
          </button>
        </div>

        <div className="tl-view-toggle">
          <button className={`tl-view-btn${viewMode === "day" ? " active" : ""}`} onClick={() => setViewMode("day")}>
            {p.viewDay}
          </button>
          <button className="tl-view-btn" disabled title={p.comingSoon}>
            {p.viewWeek}
          </button>
          <button className="tl-view-btn" disabled title={p.comingSoon}>
            {p.viewMonth}
          </button>
        </div>

        <button className="btn btn-outline btn-sm" onClick={() => setFiltersOpen((v) => !v)}>
          <Icon name="filter_list" style={{ fontSize: 16 }} />
          {p.filters}
        </button>
      </div>

      {filtersOpen && (
        <div className="tl-filters-panel">
          <MultiSelectFilter
            label={p.siteLabel}
            options={sites.map((s) => ({ value: String(s.id), label: s.name }))}
            selected={siteId === "all" ? [] : String(siteId).split(",")}
            onChange={(next) => setSiteId(next.length ? next.join(",") : "all")}
            allLabel={p.allSites}
          />
          <MultiSelectFilter
            label={p.techniciansLabel(0)}
            options={technicians.map((t) => ({ value: String(t.id), label: t.name }))}
            selected={selectedTechIds.map(String)}
            onChange={(next) => setSelectedTechIds(next.map(Number))}
            allLabel={p.allTechnicians}
            clearLabel={p.clearSelection}
          />
        </div>
      )}

      {loading && !data ? (
        <p style={{ color: "var(--text-muted)" }}>{p.loading}</p>
      ) : (
        <div className="tl-card">
          <div className="tl-legend-row">
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: DONE_COLOR }} />
              {p.legendDone}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: BUSY_COLOR.in_progress }} />
              {p.legendInProgress}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: PRESENCE_COLOR.available }} />
              {p.legendAvailable}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: BUSY_COLOR.paused }} />
              {p.legendPause}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: PRESENCE_COLOR.lunch }} />
              {p.legendLunch}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: PRESENCE_COLOR.personal }} />
              {p.legendPersonal}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: PRESENCE_COLOR.meal }} />
              {p.legendMeal}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: PRESENCE_COLOR.meeting }} />
              {p.legendMeeting}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: PRESENCE_COLOR.traveling }} />
              {p.legendTraveling}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: PRESENCE_COLOR.support }} />
              {p.legendSupport}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: PRESENCE_COLOR.site_blocked }} />
              {p.legendSiteBlocked}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: PRESENCE_COLOR.awaiting_release }} />
              {p.legendAwaitingRelease}
            </div>
            <div className="legend-item">
              <span className="legend-swatch" style={{ background: "var(--text-faint)" }} />
              {p.legendIdle}
            </div>
          </div>

          <div className="tl-grid-wrap">
            <div className="tl-labels">
              <div className="tl-ruler" />
              {techRows.map(({ tech, laneCount, doneCount, hiddenCount, collapsible, expanded }, rowIdx) => (
                <div key={tech.id} className={`tl-row ${pairRowClass(techRows, rowIdx)}`} style={{ height: rowHeight(laneCount, collapsible) }}>
                  <div className="tl-row-label">
                    <div className="tl-avatar">{initials(tech.name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="tl-row-name">
                        {tech.name}
                        {showSiteLabels && tech.site_name && <span className="tl-row-site"> · {tech.site_name}</span>}
                      </div>
                      <div className="tl-row-overview">
                        {p.doneCount(doneCount)}
                      </div>
                      {user?.is_superuser && (
                        <button type="button" className="tl-expand-btn" style={{ marginRight: 6 }} onClick={() => setAdjustTech({ id: tech.id, name: tech.name })}>
                          ✎ Ajustar
                        </button>
                      )}
                      {collapsible && (
                        <button type="button" className="tl-expand-btn" onClick={() => toggleRow(tech.id)}>
                          {expanded ? p.collapseLanes : p.expandLanes(hiddenCount)}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="tl-body">
              <div className="tl-ruler">
                {HOURS.map((h) => (
                  <span
                    key={h}
                    className="tl-ruler-tick"
                    style={{ left: `${((h - WINDOW_START_HOUR) / (WINDOW_END_HOUR - WINDOW_START_HOUR)) * 100}%` }}
                  >
                    {String(h).padStart(2, "0")}
                  </span>
                ))}
              </div>
              <div className="tl-gridlines">
                {HOURS.slice(1, -1).map((h) => (
                  <div
                    key={h}
                    className="tl-gridline"
                    style={{ left: `${((h - WINDOW_START_HOUR) / (WINDOW_END_HOUR - WINDOW_START_HOUR)) * 100}%` }}
                  />
                ))}
                {nowPct != null && (
                  <div className="tl-now-line" style={{ left: `${nowPct}%` }}>
                    <div className="tl-now-tag">{p.nowPrefix}{now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="tl-now-dot" />
                  </div>
                )}
              </div>

              {techRows.map(({ tech, lanedSegments, laneCount, collapsible }, rowIdx) => {
                if (lanedSegments.length === 0) {
                  return (
                    <div key={tech.id} className={`tl-row ${pairRowClass(techRows, rowIdx)}`} style={{ height: rowHeight(laneCount, collapsible) }}>
                      <div className="tl-row-track">
                        <div className="tl-idle-note">{p.noActivity}</div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={tech.id} className={`tl-row ${pairRowClass(techRows, rowIdx)}`} style={{ height: rowHeight(laneCount, collapsible) }}>
                    <div className="tl-row-track">
                      {lanedSegments.map(({ segment, lane }, idx) => {
                        const left = pct(segment.start, base);
                        const rightPct = segment.end ? pct(segment.end, base) : nowPct ?? 100;
                        const width = Math.max(0.4, rightPct - left);
                        const barKey = `${tech.id}-${idx}`;
                        const isActive = popup?.key === barKey;
                        return (
                          <div
                            key={idx}
                            className={`tl-bar${isActive ? " expanded" : ""}`}
                            title={segment.label}
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setPopup((prev) =>
                                prev?.key === barKey
                                  ? null
                                  : { key: barKey, label: segment.label, start: segment.start, end: segment.end ?? null, color: segment.color, top: rect.bottom + 6, left: rect.left }
                              );
                            }}
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              top: barTop(lane, laneCount),
                              height: barHeight(laneCount),
                              background: segment.color,
                            }}
                          >
                            {segment.live && <span className="tl-live-dot" />}
                            <span className="tl-bar-label">{segment.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {techRows.length === 0 && (
            <div className="empty-state">
              {technicians.length === 0
                ? p.noTechForDate(formatDateBR(date))
                : p.noFilteredTech}
            </div>
          )}
        </div>
      )}
      {adjustTech && (
        <TimelineAdjustModal
          collaboratorId={adjustTech.id}
          collaboratorName={adjustTech.name}
          date={date}
          onClose={() => setAdjustTech(null)}
          onSaved={() => operationsApi.timeline(siteId, date).then(setData)}
        />
      )}
      {popup && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setPopup(null)} />
          <div
            ref={popupRef}
            className="tl-popup"
            style={{ top: popup.top, left: Math.min(popup.left, window.innerWidth - 280) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tl-popup-color" style={{ background: popup.color }} />
            <div className="tl-popup-body">
              <div className="tl-popup-label">{popup.label}</div>
              <div className="tl-popup-time">
                {formatTime(popup.start.toISOString())}
                {popup.end ? ` – ${formatTime(popup.end.toISOString())}` : p.inProgress}
              </div>
            </div>
            <button className="tl-popup-close" onClick={() => setPopup(null)} aria-label={p.closePopup}>×</button>
          </div>
        </>
      )}
    </div>
  );
}

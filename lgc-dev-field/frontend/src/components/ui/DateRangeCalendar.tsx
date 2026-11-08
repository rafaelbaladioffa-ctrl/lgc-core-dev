import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { brazilTodayIso, fromIsoDate as fromIso, toLocalIsoDate as toIso } from "../../utils/date";
import Icon from "./Icon";

export interface DateRange {
  start: string;
  end: string;
}

function buildMonthGrid(viewDate: Date) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return days;
}

// Nomes de dias da semana via Intl — sempre começa domingo
function getWeekdayNames(locale: string): string[] {
  const names: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(2024, 0, 7 + i); // 7 jan 2024 = domingo
    names.push(d.toLocaleDateString(locale, { weekday: "short" }));
  }
  return names;
}

export default function DateRangeCalendar({
  value,
  onChange,
  maxDays = 7,
  emitPartial = true,
}: {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  maxDays?: number;
  /** Quando false, só chama onChange depois que o intervalo é concluído
   *  (evita uma consulta intermediária de um dia só ao escolher o 1º dia). */
  emitPartial?: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (value ? fromIso(value.start) : new Date()));
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [warning, setWarning] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPendingStart(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleDayClick(day: Date) {
    const iso = toIso(day);
    setWarning("");
    if (!pendingStart) {
      setPendingStart(iso);
      if (emitPartial) onChange({ start: iso, end: iso });
      return;
    }
    if (iso === pendingStart) {
      if (!emitPartial) onChange({ start: iso, end: iso });
      setPendingStart(null);
      setOpen(false);
      return;
    }
    let start = pendingStart < iso ? pendingStart : iso;
    let end = pendingStart < iso ? iso : pendingStart;
    const span = Math.round((fromIso(end).getTime() - fromIso(start).getTime()) / 86400000) + 1;
    if (span > maxDays) {
      const clampedEnd = new Date(fromIso(start));
      clampedEnd.setDate(clampedEnd.getDate() + (maxDays - 1));
      end = toIso(clampedEnd);
      setWarning(t.calendar.periodoLimitado(maxDays));
    }
    onChange({ start, end });
    setPendingStart(null);
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setPendingStart(null);
    setWarning("");
    setOpen(false);
  }

  function inRange(day: Date) {
    if (!value) return false;
    const iso = toIso(day);
    return iso >= value.start && iso <= value.end;
  }

  function isEdge(day: Date) {
    if (!value) return null;
    const iso = toIso(day);
    if (iso === value.start) return "start";
    if (iso === value.end) return "end";
    return null;
  }

  function formatShort(s: string) {
    return fromIso(s).toLocaleDateString(locale, { day: "2-digit", month: "short" });
  }

  const weekdays = getWeekdayNames(locale);
  const days = buildMonthGrid(viewDate);
  const today = brazilTodayIso();

  const label = value
    ? value.start === value.end
      ? formatShort(value.start)
      : `${formatShort(value.start)} – ${formatShort(value.end)}`
    : t.calendar.selecionarPeriodo;

  const monthYearLabel = viewDate.toLocaleDateString(locale, { month: "long", year: "numeric" });

  return (
    <div className="daterange" ref={ref}>
      <button className="daterange-trigger" onClick={() => setOpen((v) => !v)}>
        <Icon name="calendar_month" style={{ fontSize: 17 }} />
        {label}
        <Icon name="expand_more" style={{ fontSize: 16 }} />
      </button>
      {value && (
        <button className="daterange-clear" onClick={handleClear} aria-label={t.calendar.limparPeriodo}>
          <Icon name="close" style={{ fontSize: 14 }} />
        </button>
      )}

      {open && (
        <div className="daterange-popover">
          <div className="daterange-popover-head">
            <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}>
              <Icon name="chevron_left" style={{ fontSize: 18 }} />
            </button>
            <strong style={{ textTransform: "capitalize" }}>{monthYearLabel}</strong>
            <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}>
              <Icon name="chevron_right" style={{ fontSize: 18 }} />
            </button>
          </div>

          <div className="daterange-hint">
            {pendingStart ? t.calendar.escolhaDiaFinal(maxDays) : t.calendar.cliqueNumDia}
          </div>

          <div className="daterange-grid daterange-weekdays">
            {weekdays.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="daterange-grid">
            {days.map((day) => {
              const iso = toIso(day);
              const outside = day.getMonth() !== viewDate.getMonth();
              const edge = isEdge(day);
              const pending = pendingStart === iso;
              return (
                <button
                  key={iso}
                  className={[
                    "daterange-day",
                    outside ? "outside" : "",
                    inRange(day) ? "in-range" : "",
                    edge ? "edge" : "",
                    pending ? "pending" : "",
                    iso === today ? "today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => handleDayClick(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          {warning && <div className="daterange-warning">{warning}</div>}

          <div className="daterange-popover-foot">
            <button className="btn-outline btn-sm" onClick={handleClear}>
              {t.calendar.limpar}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

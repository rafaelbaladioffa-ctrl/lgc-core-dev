import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import Icon from "./Icon";

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fromIso(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
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

function getWeekdayNames(locale: string): string[] {
  const names: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(2024, 0, 7 + i); // 7 jan 2024 = domingo
    names.push(d.toLocaleDateString(locale, { weekday: "short" }));
  }
  return names;
}

interface DateInputProps {
  value: string; // YYYY-MM-DD ou ""
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  min?: string;
  disabled?: boolean;
}

export default function DateInput({ value, onChange, style, min, disabled }: DateInputProps) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (value ? fromIso(value) : new Date()));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (value) setViewDate(fromIso(value));
  }, [value]);

  function handleDayClick(day: Date) {
    const iso = toIso(day);
    if (min && iso < min) return;
    onChange(iso);
    setOpen(false);
  }

  function handleClear() {
    onChange("");
    setOpen(false);
  }

  const weekdays = getWeekdayNames(locale);
  const days = buildMonthGrid(viewDate);
  const today = toIso(new Date());

  const displayValue = value
    ? fromIso(value).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })
    : undefined;

  const monthYearLabel = viewDate.toLocaleDateString(locale, { month: "long", year: "numeric" });

  return (
    <div className="daterange" ref={ref} style={style}>
      <button className="daterange-trigger" onClick={() => !disabled && setOpen((v) => !v)} disabled={disabled} style={{ whiteSpace: "nowrap" }}>
        <Icon name="calendar_month" style={{ fontSize: 17 }} />
        {displayValue ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
        <Icon name="expand_more" style={{ fontSize: 16 }} />
      </button>
      {value && (
        <button className="daterange-clear" onClick={handleClear} aria-label={t.calendar.limpar}>
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

          <div className="daterange-grid daterange-weekdays">
            {weekdays.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>

          <div className="daterange-grid">
            {days.map((day) => {
              const iso = toIso(day);
              const outside = day.getMonth() !== viewDate.getMonth();
              const isSelected = iso === value;
              const isDisabled = !!(min && iso < min);
              return (
                <button
                  key={iso}
                  className={[
                    "daterange-day",
                    outside ? "outside" : "",
                    isSelected ? "edge" : "",
                    iso === today ? "today" : "",
                    isDisabled ? "outside" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => !isDisabled && handleDayClick(day)}
                  disabled={isDisabled}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

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

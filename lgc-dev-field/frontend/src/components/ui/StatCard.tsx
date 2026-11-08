export default function StatCard({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: string | number;
  hint?: string;
  /** Variação percentual vs. o período anterior — só aparece quando o
   * chamador tiver um valor de comparação real (nunca inventar número). */
  trend?: number;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {trend != null && (
        <div className={`stat-trend ${trend >= 0 ? "stat-trend-up" : "stat-trend-down"}`}>
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
        </div>
      )}
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  /** Optional leading icon glyph — used on the dashboard's brand-styled KPI cards. */
  icon?: string;
  /** Optional percentage change, e.g. +12.4 or -3.1 — rendered green/red automatically. */
  change?: number;
}

const TONE_COLORS: Record<string, string> = {
  default: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export function KpiCard({ label, value, tone = 'default', icon, change }: KpiCardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '10px 14px',
        minWidth: 140,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      {icon && (
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: 'var(--brand-gradient)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
      )}
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: TONE_COLORS[tone], marginTop: 3 }}>{value}</div>
          {change !== undefined && (
            <span style={{ fontSize: 11, fontWeight: 600, color: change >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>{children}</div>;
}

/** Minimal inline-SVG charts — no charting library dependency, just enough for dashboard summaries. */

export interface ChartDatum {
  label: string;
  value: number;
  color: string;
}

export function PieChart({ data, size = 160 }: { data: ChartDatum[]; size?: number }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = size / 2;
  const cx = radius;
  const cy = radius;

  if (total === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={cx} cy={cy} r={radius - 2} fill="none" stroke="var(--border)" strokeWidth={2} />
        </svg>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sem dados</span>
      </div>
    );
  }

  let angle = -90;
  const slices = data
    .filter((d) => d.value > 0)
    .map((d) => {
      const fraction = d.value / total;
      const startAngle = angle;
      const endAngle = angle + fraction * 360;
      angle = endAngle;
      const start = polar(cx, cy, radius - 2, startAngle);
      const end = polar(cx, cy, radius - 2, endAngle);
      const largeArc = endAngle - startAngle > 180 ? 1 : 0;
      const path =
        fraction >= 0.999
          ? `M ${cx} ${cy - radius + 2} A ${radius - 2} ${radius - 2} 0 1 1 ${cx - 0.01} ${cy - radius + 2} Z`
          : `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius - 2} ${radius - 2} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
      return { ...d, path };
    });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((s) => (
          <path key={s.label} d={s.path} fill={s.color} stroke="var(--bg-elevated)" strokeWidth={1} />
        ))}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)' }}>{d.label}</span>
            <span style={{ fontWeight: 600 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function BarChart({ data, height = 160 }: { data: ChartDatum[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height, padding: '0 4px' }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{d.value}</span>
          <div
            style={{
              width: '100%',
              maxWidth: 40,
              height: Math.max(2, (d.value / max) * (height - 40)),
              background: d.color,
              borderRadius: '4px 4px 0 0',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Simple line/area chart for a time series: [{ label, value }], evenly spaced on the x-axis. */
export function LineChart({ data, height = 140, color = 'var(--accent)' }: { data: Array<{ label: string; value: number }>; height?: number; color?: string }) {
  const width = Math.max(240, data.length * 36);
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data.map((d, i) => ({ x: i * stepX, y: height - 20 - (d.value / max) * (height - 40) }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? 0} ${height - 20} L 0 ${height - 20} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMid meet">
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
      ))}
      {data.map((d, i) => (
        <text key={d.label} x={points[i].x} y={height - 4} fontSize={10} fill="var(--text-muted)" textAnchor="middle">
          {d.label}
        </text>
      ))}
    </svg>
  );
}

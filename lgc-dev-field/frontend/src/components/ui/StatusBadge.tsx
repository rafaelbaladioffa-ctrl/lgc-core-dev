type Tone = "blue" | "amber" | "green" | "red" | "neutral";

const STATUS_TONE: Record<string, Tone> = {
  planning: "blue",
  not_started: "neutral",
  in_progress: "green",
  paused: "amber",
  completed: "green",
  canceled: "red",
  open: "amber",
  resolved: "green",
};

const TONE_STYLES: Record<Tone, { bg: string; color: string }> = {
  blue: { bg: "var(--blue-soft)", color: "var(--blue)" },
  amber: { bg: "var(--amber-soft)", color: "var(--amber)" },
  green: { bg: "var(--green-soft)", color: "var(--green)" },
  red: { bg: "var(--red-soft)", color: "var(--red)" },
  neutral: { bg: "var(--bg)", color: "var(--text-muted)" },
};

export default function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone = STATUS_TONE[status] || "neutral";
  const style = TONE_STYLES[tone];
  return (
    <span className="badge" style={{ background: style.bg, color: style.color }}>
      {label}
    </span>
  );
}

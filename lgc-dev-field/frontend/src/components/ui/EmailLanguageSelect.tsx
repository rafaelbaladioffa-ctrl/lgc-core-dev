export type EmailLanguage = "pt" | "en" | "es";

const OPTIONS: { value: EmailLanguage; label: string }[] = [
  { value: "pt", label: "Português" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

/** Idioma padrão do e-mail a partir do locale da interface (pt-BR, en-US, es-ES). */
export function defaultEmailLanguage(locale: string): EmailLanguage {
  const code = locale.slice(0, 2).toLowerCase();
  return code === "en" || code === "es" ? code : "pt";
}

export default function EmailLanguageSelect({
  value,
  onChange,
  label = "Idioma do e-mail",
}: {
  value: EmailLanguage;
  onChange: (value: EmailLanguage) => void;
  label?: string;
}) {
  return (
    <select
      className="select"
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value as EmailLanguage)}
      style={{ width: "auto", minWidth: 110 }}
    >
      {OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

import SearchSelect, { SearchMultiSelect } from "./SearchSelect";
import { useI18n } from "../../i18n";
import { formatBrazilPhone } from "../../utils/formatPhone";
import DateInput from "./DateInput";

export type FieldOption = { value: string | number; label: string };

export type FieldType = "text" | "textarea" | "number" | "checkbox" | "select" | "multiselect" | "email" | "date" | "datetime" | "phone";

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  span?: 1 | 2;
  placeholder?: string;
  /** Mostra o campo só quando o predicado retorna true — usado para
   * formulários "com Tipo" onde só um subconjunto de campos se aplica
   * (ex: Responsável CSTR usa Empresa, Responsável Cliente usa Cliente). */
  visibleIf?: (values: FormValues) => boolean;
  /** Mostra o valor em um campo desabilitado (gerado pelo sistema). */
  readOnly?: boolean;
}

export type FormValues = Record<string, unknown>;

export default function DynamicForm({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: FieldConfig[];
  values: FormValues;
  errors?: Record<string, string[]>;
  onChange: (name: string, value: unknown) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="dynamic-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
      {fields.filter((field) => !field.visibleIf || field.visibleIf(values)).map((field) => {
        const fieldErrors = errors?.[field.name];
        const value = values[field.name];
        return (
          <div
            key={field.name}
            className="field-group"
            style={{ gridColumn: field.span === 2 ? "1 / -1" : undefined, marginBottom: 14 }}
          >
            <span className="field-label">
              {field.label}
              {field.required && <span style={{ color: "var(--red)" }}> *</span>}
            </span>
            {renderInput(field, value, onChange, t)}
            {fieldErrors && (
              <span style={{ fontSize: 11.5, color: "var(--red)", marginTop: 2 }}>{fieldErrors.join(" ")}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderInput(field: FieldConfig, value: unknown, onChange: (name: string, value: unknown) => void, t: ReturnType<typeof useI18n>["t"]) {
  if (field.readOnly) {
    return <input className="input" disabled value={(value as string) || field.placeholder || ""} />;
  }
  switch (field.type) {
    case "textarea":
      return (
        <textarea
          className="input"
          style={{ height: 80 }}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );
    case "checkbox":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, height: 38 }}>
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(field.name, e.target.checked)} />
          {field.placeholder || t.form.ativo}
        </label>
      );
    case "select":
      return (
        <SearchSelect
          options={(field.options ?? []).map((opt) => ({ value: opt.value, label: opt.label }))}
          value={value === null || value === undefined ? "" : (value as string | number)}
          onChange={(v) => onChange(field.name, v === "" ? null : v)}
          placeholder={field.placeholder || t.form.selecione}
          clearable={!field.required}
        />
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? (value as (string | number)[]) : [];
      return (
        <SearchMultiSelect
          options={(field.options ?? []).map((opt) => ({ value: opt.value, label: opt.label }))}
          value={selected}
          onChange={(next) => onChange(field.name, next.map((v) => (typeof v === "number" ? v : Number(v))))}
        />
      );
    }
    case "number":
      return (
        <input
          type="number"
          className="input"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "date":
      return (
        <DateInput
          value={(value as string) ?? ""}
          onChange={(v) => onChange(field.name, v || null)}
        />
      );
    case "datetime":
      return (
        <input
          type="datetime-local"
          className="input"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.name, e.target.value || null)}
        />
      );
    case "email":
      return (
        <input
          type="email"
          className="input"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );
    case "phone":
      return (
        <input
          type="text"
          inputMode="tel"
          className="input"
          value={(value as string) ?? ""}
          placeholder={field.placeholder || "+55 (11) 99999-9999"}
          onChange={(e) => onChange(field.name, formatBrazilPhone(e.target.value))}
        />
      );
    default:
      return (
        <input
          type="text"
          className="input"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );
  }
}

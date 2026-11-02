import React from "react";

export type BpmField = {
  key: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "integer"
    | "decimal"
    | "date"
    | "select"
    | "boolean"
    | "attachment";
  required?: boolean;
  readOnly?: boolean;
  options?: Array<string | { id: string; label: string }>;
};
export type BpmFieldErrors = Record<string, string>;
export function coerceBpmValue(field: BpmField, raw: string | boolean | null) {
  if (field.type === "boolean") return raw === true;
  if (field.type === "integer")
    return raw === "" || raw === null ? null : Number(raw);
  return raw;
}
export function mergeDraftFields(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
  writableKeys: Set<string>,
) {
  for (const key of Object.keys(patch))
    if (!writableKeys.has(key)) throw new Error(`Campo não editável: ${key}`);
  return { ...existing, ...patch };
}

export function DynamicForm({
  fields,
  values,
  errors = {},
  onChange,
  onUpload,
}: {
  fields: BpmField[];
  values: Record<string, unknown>;
  errors?: BpmFieldErrors;
  onChange: (key: string, value: unknown) => void;
  onUpload?: (key: string, files: FileList) => void;
}) {
  return (
    <div>
      {fields.map((field) => {
        const value = values[field.key];
        const common = {
          id: `bpm-field-${field.key}`,
          disabled: field.readOnly,
          "aria-invalid": !!errors[field.key],
        };
        let input: React.ReactNode;
        if (field.type === "boolean")
          input = (
            <input
              {...common}
              type="checkbox"
              checked={value === true}
              onChange={(e) => onChange(field.key, e.target.checked)}
            />
          );
        else if (field.type === "textarea")
          input = (
            <textarea
              {...common}
              value={String(value ?? "")}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          );
        else if (field.type === "select")
          input = (
            <select
              {...common}
              value={String(value ?? "")}
              onChange={(e) => onChange(field.key, e.target.value)}
            >
              <option value="">Selecione</option>
              {(field.options ?? []).map((option) => {
                const id = typeof option === "string" ? option : option.id;
                const label =
                  typeof option === "string" ? option : option.label;
                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                );
              })}
            </select>
          );
        else if (field.type === "attachment")
          input = (
            <input
              {...common}
              type="file"
              multiple
              onChange={(e) =>
                e.target.files && onUpload?.(field.key, e.target.files)
              }
            />
          );
        else
          input = (
            <input
              {...common}
              type={
                field.type === "date"
                  ? "date"
                  : field.type === "integer"
                    ? "number"
                    : "text"
              }
              inputMode={field.type === "decimal" ? "decimal" : undefined}
              value={String(value ?? "")}
              onChange={(e) =>
                onChange(field.key, coerceBpmValue(field, e.target.value))
              }
            />
          );
        return (
          <label key={field.key} htmlFor={`bpm-field-${field.key}`}>
            {field.label}
            {field.required ? " *" : ""}
            {input}
            {errors[field.key] && <span role="alert">{errors[field.key]}</span>}
          </label>
        );
      })}
    </div>
  );
}

export { useDraftAutosave } from "./useDraftAutosave";

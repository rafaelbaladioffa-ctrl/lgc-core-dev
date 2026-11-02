import React from "react";
import { MoneyField } from "./forms/MoneyField";
import { RepeatableTableField } from "./forms/RepeatableTableField";
import { ReferenceField } from "./forms/ReferenceField";

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
    | "attachment"
    | "money"
    | "reference"
    | "repeatable_table";
  required?: boolean;
  readOnly?: boolean;
  options?: Array<string | { id: string; label: string }>;
  /** money field: ISO 4217 currency code, defaults to BRL */
  currency?: string;
  /** reference field: human name for the referenced entity */
  refLabel?: string;
  /** repeatable_table: column definitions */
  columns?: Array<{ key: string; label: string; type: string; required?: boolean }>;
};

export type BpmFieldErrors = Record<string, string>;
export type BpmFormSection = { title?: string; fields: BpmField[] };

/**
 * Normalize a P01 flat FieldDef[] or P02 {sections:[…]} schema and apply the
 * per-key access map (hidden | read | write).  Returns sections suitable for
 * SectionedDynamicForm.
 */
export function applyFormAccess(
  schema: unknown,
  formAccess?: Record<string, unknown>,
): BpmFormSection[] {
  const rawSections: { title?: string; fields: unknown[] }[] = Array.isArray(
    schema,
  )
    ? [{ fields: schema }]
    : Array.isArray((schema as any)?.sections)
      ? (schema as any).sections
      : [{ fields: [] }];

  return rawSections.map((s) => ({
    title: s.title,
    fields: (s.fields ?? [])
      .filter((f: any) => formAccess?.[f.key] !== "hidden")
      .map((f: any) => ({
        ...f,
        readOnly: ["read", "readonly"].includes(String(formAccess?.[f.key])),
      })) as BpmField[],
  }));
}

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

function BpmFieldRow({
  field,
  value,
  error,
  onChange,
  onUpload,
}: {
  field: BpmField;
  value: unknown;
  error?: string;
  onChange: (key: string, value: unknown) => void;
  onUpload?: (key: string, files: FileList) => void;
}) {
  const common = {
    id: `bpm-field-${field.key}`,
    disabled: field.readOnly,
    "aria-invalid": !!error,
  };

  let input: React.ReactNode;

  if (field.type === "money")
    input = (
      <MoneyField
        field={field}
        value={value}
        disabled={field.readOnly}
        error={error}
        onChange={onChange}
      />
    );
  else if (field.type === "repeatable_table")
    input = (
      <RepeatableTableField
        field={field}
        value={value}
        disabled={field.readOnly}
        error={error}
        onChange={onChange}
      />
    );
  else if (field.type === "reference")
    input = (
      <ReferenceField
        field={field}
        value={value}
        disabled={field.readOnly}
        error={error}
        onChange={onChange}
      />
    );
  else if (field.type === "boolean")
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
          const label = typeof option === "string" ? option : option.label;
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
    <label htmlFor={`bpm-field-${field.key}`}>
      {field.label}
      {field.required ? " *" : ""}
      {input}
      {error && <span role="alert">{error}</span>}
    </label>
  );
}

/** Flat field list (P01 compat). */
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
      {fields.map((field) => (
        <BpmFieldRow
          key={field.key}
          field={field}
          value={values[field.key]}
          error={errors[field.key]}
          onChange={onChange}
          onUpload={onUpload}
        />
      ))}
    </div>
  );
}

/** Sectioned form (P02). Falls back to flat when there is only one untitled section. */
export function SectionedDynamicForm({
  sections,
  values,
  errors = {},
  onChange,
  onUpload,
}: {
  sections: BpmFormSection[];
  values: Record<string, unknown>;
  errors?: BpmFieldErrors;
  onChange: (key: string, value: unknown) => void;
  onUpload?: (key: string, files: FileList) => void;
}) {
  if (sections.length === 1 && !sections[0].title)
    return (
      <DynamicForm
        fields={sections[0].fields}
        values={values}
        errors={errors}
        onChange={onChange}
        onUpload={onUpload}
      />
    );
  return (
    <div>
      {sections.map((section, idx) => (
        <fieldset key={idx}>
          {section.title && <legend>{section.title}</legend>}
          {section.fields.map((field) => (
            <BpmFieldRow
              key={field.key}
              field={field}
              value={values[field.key]}
              error={errors[field.key]}
              onChange={onChange}
              onUpload={onUpload}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

export { useDraftAutosave } from "./useDraftAutosave";

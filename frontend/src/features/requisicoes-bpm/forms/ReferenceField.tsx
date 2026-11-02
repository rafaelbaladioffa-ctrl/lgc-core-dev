import React from "react";
import type { BpmField } from "../DynamicForm";

interface Props {
  field: BpmField;
  value: unknown;
  disabled?: boolean;
  error?: string;
  onChange: (key: string, value: unknown) => void;
}

export function ReferenceField({ field, value, disabled, onChange }: Props) {
  return (
    <input
      type="text"
      placeholder={`ID do ${field.refLabel ?? "registro"}`}
      disabled={disabled}
      value={String(value ?? "")}
      onChange={(e) => onChange(field.key, e.target.value || null)}
    />
  );
}

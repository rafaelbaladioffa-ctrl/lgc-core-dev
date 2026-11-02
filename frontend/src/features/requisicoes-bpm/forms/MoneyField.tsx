import React from "react";
import type { BpmField } from "../DynamicForm";

interface Props {
  field: BpmField;
  value: unknown;
  disabled?: boolean;
  error?: string;
  onChange: (key: string, value: unknown) => void;
}

export function MoneyField({ field, value, disabled, onChange }: Props) {
  const money =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { amount?: string; currency?: string })
      : undefined;
  const amount = money?.amount ?? "";
  const currency = money?.currency ?? field.currency ?? "BRL";

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span>{currency}</span>
      <input
        type="text"
        inputMode="decimal"
        placeholder="0,00"
        disabled={disabled}
        value={amount}
        style={{ flex: 1 }}
        onChange={(e) => onChange(field.key, { amount: e.target.value, currency })}
      />
    </div>
  );
}

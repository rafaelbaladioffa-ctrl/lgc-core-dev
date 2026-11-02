import { useEffect, useState } from "react";
import type { BpmField } from "../DynamicForm";
import { bpmApi } from "../api";

export function LogisticsItemAutocomplete({
  field,
  value,
  disabled,
  onChange,
  onSelect,
}: {
  field: BpmField;
  value: unknown;
  disabled?: boolean;
  onChange: (key: string, value: unknown) => void;
  onSelect?: (item: { id: string; code: string; name: string; unit?: string; unitPrice?: number }) => void;
}) {
  const [query, setQuery] = useState(String(value ?? ""));
  const [items, setItems] = useState<Array<{ id: string; code: string; name: string; unit?: string; unitPrice?: number }>>([]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const text = query.trim();
    if (!text || disabled) {
      setItems([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void bpmApi
        .logisticsItems(text)
        .then((result) => {
          setItems(result);
          setUnavailable(false);
        })
        .catch(() => {
          setItems([]);
          setUnavailable(true);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [disabled, query]);

  return (
    <div className="lecom-autocomplete">
      <input
        type="text"
        disabled={disabled}
        placeholder="Busque no catálogo"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(field.key, event.target.value || null);
        }}
      />
      {unavailable && <small>Busca indisponível — informe manualmente</small>}
      {items.length > 0 && (
        <ul className="lecom-autocomplete-options">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  setQuery(`${item.code} — ${item.name}`);
                  setItems([]);
                  onChange(field.key, item.id);
                  onSelect?.(item);
                }}
              >
                <strong>{item.code}</strong> — {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

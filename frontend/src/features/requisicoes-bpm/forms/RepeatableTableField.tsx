import type { BpmField } from "../DynamicForm";
import { LogisticsItemAutocomplete } from "./LogisticsItemAutocomplete";

interface Props {
  field: BpmField;
  value: unknown;
  disabled?: boolean;
  error?: string;
  onChange: (key: string, value: unknown) => void;
}

export function RepeatableTableField({ field, value, disabled, onChange }: Props) {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const columns = field.columns ?? [];

  const setRows = (next: Record<string, unknown>[]) => onChange(field.key, next);

  const addRow = () => {
    const empty: Record<string, unknown> = {};
    columns.forEach((col) => {
      empty[col.key] = "";
    });
    setRows([...rows, empty]);
  };

  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));

  const updateCell = (rowIdx: number, colKey: string, cellValue: unknown) =>
    setRows(
      rows.map((row, i) => (i === rowIdx ? { ...row, [colKey]: cellValue } : row)),
    );

  if (columns.length === 0) return <p>Tabela sem colunas definidas.</p>;

  return (
    <div className="lecom-repeatable-table">
      <button className="lecom-table-add" type="button" disabled={disabled} onClick={addRow}>
        ADICIONAR DADOS NA TABELA <span aria-hidden>＋</span>
      </button>
      <table className="lecom-data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.source?.key === "logistics.catalog" ? (
                    <LogisticsItemAutocomplete
                      field={{ key: col.key, label: col.label, type: "reference", source: col.source }}
                      value={row[col.key]}
                      disabled={disabled}
                      onChange={(_, value) => {
                        const next = rows.map((current, index) =>
                          index === rowIdx ? { ...current, [col.key]: value } : current,
                        );
                        setRows(next);
                      }}
                      onSelect={(item) => {
                        setRows(rows.map((current, index) => index === rowIdx ? {
                          ...current,
                          [col.key]: item.id,
                          ...(columns.some((candidate) => candidate.key === "unidade") && item.unit ? { unidade: item.unit } : {}),
                          ...(columns.some((candidate) => candidate.key === "preco_unitario") && item.unitPrice !== undefined
                            ? { preco_unitario: { amount: item.unitPrice.toFixed(2), currency: "BRL" } }
                            : {}),
                        } : current));
                      }}
                    />
                  ) : (
                    <input
                      disabled={disabled}
                      value={String(row[col.key] ?? "")}
                      onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                    />
                  )}
                </td>
              ))}
              <td>
                <button
                  type="button"
                  aria-label="Remover linha"
                  disabled={disabled}
                  onClick={() => removeRow(rowIdx)}
                >
                  –
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

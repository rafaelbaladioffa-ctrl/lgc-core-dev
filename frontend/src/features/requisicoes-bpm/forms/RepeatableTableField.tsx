import type { BpmField } from "../DynamicForm";

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
    <div>
      <table>
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
                  <input
                    disabled={disabled}
                    value={String(row[col.key] ?? "")}
                    onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
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
      <button type="button" disabled={disabled} onClick={addRow}>
        Adicionar linha
      </button>
    </div>
  );
}

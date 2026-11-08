import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import Icon from "./Icon";

export interface FilterOption {
  value: string;
  label: string;
  /** Texto de apoio abaixo do rótulo da opção. */
  hint?: string;
}

const DEFAULT_TEXT: Record<string, { hint: string; clear: string }> = {
  "pt-BR": { hint: "Marque uma ou mais opções.", clear: "Limpar" },
  "en-US": { hint: "Check one or more options.", clear: "Clear" },
  "es-ES": { hint: "Marca una o más opciones.", clear: "Limpiar" },
};

interface Props {
  /** Nome do filtro, mostrado no botão ("Cliente: Todos"). */
  label: string;
  options: FilterOption[];
  /** Valores marcados. Vazio significa "todos" (a menos que `requireOne`). */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Texto do botão quando nada (ou tudo, com `allWhenFull`) está marcado. */
  allLabel: string;
  /** Dica no rodapé do menu (ex.: "Marque um ou mais países."). */
  hint?: string;
  /** Impede desmarcar a última opção (para filtros que não podem ficar vazios). */
  requireOne?: boolean;
  /** Mostra `allLabel` também quando todas as opções estão marcadas. */
  allWhenFull?: boolean;
  /** Separador dos rótulos no resumo do botão. */
  separator?: string;
  clearLabel?: string;
  disabled?: boolean;
}

/**
 * Filtro de múltipla escolha em dropdown — padrão de filtro do sistema (Gestão de Sites):
 * botão "Rótulo: resumo" que abre uma lista de caixas de seleção com dica no rodapé.
 */
export default function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  allLabel,
  hint: hintProp,
  requireOne,
  allWhenFull,
  separator = ", ",
  clearLabel: clearLabelProp,
  disabled,
}: Props) {
  const { locale } = useI18n();
  const text = DEFAULT_TEXT[locale] ?? DEFAULT_TEXT["pt-BR"];
  const hint = hintProp ?? text.hint;
  const clearLabel = clearLabelProp ?? text.clear;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chosen = options.filter((o) => selected.includes(o.value));
  const everything = allWhenFull && chosen.length === options.length;
  const summary =
    chosen.length === 0 || everything
      ? allLabel
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(separator)
        : `${chosen[0].label} +${chosen.length - 1}`;

  function toggle(value: string) {
    const isOn = selected.includes(value);
    if (isOn && requireOne && chosen.length <= 1) return;
    const next = new Set(selected);
    if (isOn) next.delete(value);
    else next.add(value);
    // mantém a ordem das opções, independentemente da ordem dos cliques
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  }

  return (
    <div className="sp-dropdown" ref={ref}>
      <button
        type="button"
        className="sp-select sp-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sp-muted">{label}:</span> {summary}
        <Icon name={open ? "expand_less" : "expand_more"} style={{ fontSize: 18 }} />
      </button>
      {open && (
        <div className="sp-dropdown-menu" role="listbox" aria-multiselectable="true">
          <div className="sp-dropdown-list">
            {options.map((o) => {
              const checked = selected.includes(o.value);
              const locked = !!requireOne && checked && chosen.length <= 1;
              return (
                <label key={o.value} className={`sp-dropdown-option${locked ? " locked" : ""}`}>
                  <input type="checkbox" checked={checked} disabled={locked} onChange={() => toggle(o.value)} />
                  <span>
                    {o.label}
                    {o.hint && <small>{o.hint}</small>}
                  </span>
                </label>
              );
            })}
          </div>
          {(hint || (!requireOne && chosen.length > 0)) && (
            <div className="sp-dropdown-hint">
              {hint && <span>{hint}</span>}
              {!requireOne && chosen.length > 0 && (
                <button type="button" className="sp-dropdown-clear" onClick={() => onChange([])}>
                  {clearLabel}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";

export interface SearchOption {
  value: string | number;
  label: string;
  /** Segunda linha, em cinza (ex.: código, cliente, site). Também entra na busca. */
  sublabel?: string;
  /** Texto extra considerado na busca. */
  search?: string;
  disabled?: boolean;
}

const TEXT: Record<string, { placeholder: string; empty: string; clear: string; multiPlaceholder: string; selected: (n: number) => string }> = {
  "pt-BR": { placeholder: "Selecione...", empty: "Nenhum resultado.", clear: "Limpar", multiPlaceholder: "Buscar...", selected: (n) => `${n} selecionado(s)` },
  "en-US": { placeholder: "Select...", empty: "No results.", clear: "Clear", multiPlaceholder: "Search...", selected: (n) => `${n} selected` },
  "es-ES": { placeholder: "Selecciona...", empty: "Sin resultados.", clear: "Limpiar", multiPlaceholder: "Buscar...", selected: (n) => `${n} seleccionado(s)` },
};

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function useOutsideClose(ref: React.RefObject<HTMLElement>, onClose: () => void) {
  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref, onClose]);
}

function filterOptions(options: SearchOption[], query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return options;
  return options.filter((o) => {
    const haystack = normalize(`${o.label} ${o.sublabel ?? ""} ${o.search ?? ""}`);
    return terms.every((t) => haystack.includes(t));
  });
}

function OptionRow({
  option,
  active,
  checked,
  onHover,
  onPick,
  showCheck,
}: {
  option: SearchOption;
  active: boolean;
  checked?: boolean;
  onHover: () => void;
  onPick: () => void;
  showCheck?: boolean;
}) {
  return (
    <div
      role="option"
      aria-selected={!!checked}
      aria-disabled={option.disabled}
      className={`ss-option${active ? " active" : ""}${option.disabled ? " disabled" : ""}`}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!option.disabled) onPick();
      }}
    >
      {showCheck && <input type="checkbox" checked={!!checked} readOnly tabIndex={-1} />}
      <div className="ss-option-text">
        <div className="ss-option-label">{option.label}</div>
        {option.sublabel && <div className="ss-option-sub">{option.sublabel}</div>}
      </div>
    </div>
  );
}

/**
 * Lista com busca (escolha única) — padrão de lista do sistema (igual ao campo "Projeto"
 * das Atualizações): campo de pesquisa e resultados com título e detalhe.
 */
export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  clearable = true,
  disabled,
  emptyLabel,
  className,
  style,
  id,
}: {
  options: SearchOption[];
  value: string | number | "" | null | undefined;
  onChange: (value: string | number | "") => void;
  placeholder?: string;
  /** Mostra o "×" para limpar a escolha (desligue em campos obrigatórios). */
  clearable?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}) {
  const { locale } = useI18n();
  const text = TEXT[locale] ?? TEXT["pt-BR"];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const hasValue = value !== "" && value != null;
  const selected = hasValue ? options.find((o) => String(o.value) === String(value)) ?? null : null;
  const shown = useMemo(() => filterOptions(options, query), [options, query]);

  useOutsideClose(rootRef, () => setOpen(false));
  useEffect(() => setHighlight(0), [query, open]);
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, open]);

  function choose(option: SearchOption) {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, shown.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter" && open && shown[highlight]) {
      event.preventDefault();
      choose(shown[highlight]);
    } else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`ss-root${className ? ` ${className}` : ""}`} style={style}>
      <div className="ss-field">
        <input
          id={id}
          className="input ss-input"
          disabled={disabled}
          autoComplete="off"
          value={open ? query : selected ? selected.label : ""}
          placeholder={selected && open ? selected.label : placeholder ?? text.placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
        />
        {clearable && selected && !disabled && (
          <button type="button" className="ss-clear" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange("")} aria-label={text.clear}>
            ×
          </button>
        )}
      </div>
      {open && !disabled && (
        <div role="listbox" className="ss-list" ref={listRef}>
          {shown.length === 0 && <div className="ss-empty">{emptyLabel ?? text.empty}</div>}
          {shown.map((option, index) => (
            <OptionRow
              key={String(option.value)}
              option={option}
              active={index === highlight}
              checked={selected ? String(option.value) === String(selected.value) : false}
              onHover={() => setHighlight(index)}
              onPick={() => choose(option)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Lista com busca de múltipla escolha: itens escolhidos viram etiquetas removíveis. */
export function SearchMultiSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  emptyLabel,
  className,
  style,
}: {
  options: SearchOption[];
  value: (string | number)[];
  onChange: (value: (string | number)[]) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { locale } = useI18n();
  const text = TEXT[locale] ?? TEXT["pt-BR"];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedKeys = useMemo(() => new Set(value.map(String)), [value]);
  const chosen = useMemo(() => options.filter((o) => selectedKeys.has(String(o.value))), [options, selectedKeys]);
  const shown = useMemo(() => filterOptions(options, query), [options, query]);

  useOutsideClose(rootRef, () => setOpen(false));
  useEffect(() => setHighlight(0), [query]);
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, open]);

  function toggle(option: SearchOption) {
    const key = String(option.value);
    if (selectedKeys.has(key)) onChange(value.filter((v) => String(v) !== key));
    else onChange([...value, option.value]);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, shown.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter" && open && shown[highlight]) {
      event.preventDefault();
      toggle(shown[highlight]);
    } else if (event.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
    } else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`ss-root${className ? ` ${className}` : ""}`} style={style}>
      <div className={`input ss-multi-field${open ? " open" : ""}`} onClick={() => !disabled && setOpen(true)}>
        {chosen.map((o) => (
          <span key={String(o.value)} className="ss-chip">
            {o.label}
            {!disabled && (
              <button
                type="button"
                aria-label={text.clear}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(o);
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          className="ss-multi-input"
          disabled={disabled}
          autoComplete="off"
          value={query}
          placeholder={chosen.length ? "" : placeholder ?? text.multiPlaceholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
        />
      </div>
      {open && !disabled && (
        <div role="listbox" aria-multiselectable="true" className="ss-list" ref={listRef}>
          {shown.length === 0 && <div className="ss-empty">{emptyLabel ?? text.empty}</div>}
          {shown.map((option, index) => (
            <OptionRow
              key={String(option.value)}
              option={option}
              active={index === highlight}
              checked={selectedKeys.has(String(option.value))}
              showCheck
              onHover={() => setHighlight(index)}
              onPick={() => toggle(option)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

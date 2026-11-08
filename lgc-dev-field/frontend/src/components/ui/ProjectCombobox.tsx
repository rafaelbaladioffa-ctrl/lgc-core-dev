import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../../api/types";

const FINISHED_STATUSES = ["completed", "canceled"];

function projectLabel(project: Project) {
  return [project.code, project.site_name, project.name].filter(Boolean).join(" · ");
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Seletor de projeto com busca (código, nome, PO, cliente, site ou responsável). Por
 * padrão esconde projetos concluídos/cancelados; "Mostrar todos" os inclui
 * (`showAllToggle={false}` remove essa opção quando a lista já vem filtrada). */
export default function ProjectCombobox({
  projects,
  value,
  onChange,
  placeholder = "Buscar por código, nome, PO, cliente ou site...",
  showAllLabel = "Mostrar todos (inclui concluídos e cancelados)",
  emptyLabel = "Nenhum projeto encontrado.",
  showAllToggle = true,
}: {
  projects: Project[];
  value: number | "";
  onChange: (id: number | "") => void;
  placeholder?: string;
  showAllLabel?: string;
  emptyLabel?: string;
  showAllToggle?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = projects.find((p) => p.id === value) ?? null;

  const options = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    return projects
      .filter((p) => showAll || !showAllToggle || !FINISHED_STATUSES.includes(p.status))
      .filter((p) => {
        const haystack = normalize(
          `${p.code} ${p.name} ${p.po ?? ""} ${p.client_name ?? ""} ${p.site_name ?? ""} ${p.responsible_cstr_name ?? ""}`,
        );
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, 100);
  }, [projects, query, showAll, showAllToggle]);

  useEffect(() => setHighlight(0), [query, showAll]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function choose(project: Project) {
    onChange(project.id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter" && open && options[highlight]) {
      event.preventDefault();
      choose(options[highlight]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={open ? query : selected ? projectLabel(selected) : query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {selected && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange("")} aria-label="Limpar">
            ×
          </button>
        )}
      </div>
      {showAllToggle && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 6, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {showAllLabel}
        </label>
      )}
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            left: 0,
            right: 0,
            top: 40,
            maxHeight: 320,
            overflowY: "auto",
            background: "var(--white)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
          }}
        >
          {options.length === 0 && <div style={{ padding: 12, fontSize: 13, color: "var(--text-muted)" }}>{emptyLabel}</div>}
          {options.map((project, index) => (
            <div
              key={project.id}
              role="option"
              aria-selected={project.id === value}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(project);
              }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                background: index === highlight ? "var(--orange-soft)" : "transparent",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 13.5, color: "var(--text)" }}>{project.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {[project.code, project.client_name, project.site_name, project.po && `PO ${project.po}`].filter(Boolean).join(" · ")}
                {FINISHED_STATUSES.includes(project.status) ? ` · ${project.status_display}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

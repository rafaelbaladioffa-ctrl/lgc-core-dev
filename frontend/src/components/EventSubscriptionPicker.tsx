import { useEffect, useRef } from 'react';
import type { EventTypeInfo } from '../api/integration';
import { groupEventTypes, type EventGroup } from '../utils/eventGroups';
import '../styles/satellite-form.css';

function FamilyToggle({ group, selected, onChange }: { group: EventGroup; selected: string[]; onChange: (next: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const types = group.events.map((e) => e.type);
  const count = types.filter((t) => selected.includes(t)).length;
  const all = count === types.length;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);

  const toggleAll = () => {
    const rest = selected.filter((t) => !types.includes(t));
    onChange(all ? rest : [...rest, ...types]);
  };

  return (
    <label className="event-picker-family-toggle">
      <input ref={ref} type="checkbox" checked={all} onChange={toggleAll} aria-label={`Todos os eventos de ${group.label}`} />
      {group.label}
    </label>
  );
}

/** Escolha dos eventos assinados por um satélite, agrupados por família (Clientes, Projetos, Usuários…). */
export function EventSubscriptionPicker({
  catalog,
  selected,
  onChange,
}: {
  catalog: EventTypeInfo[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const groups = groupEventTypes(catalog, selected);
  const toggle = (type: string) => onChange(selected.includes(type) ? selected.filter((t) => t !== type) : [...selected, type]);

  return (
    <>
      <div className="event-picker">
        {groups.map((group) => (
          <fieldset key={group.key} className="event-picker-family">
            <legend>
              <FamilyToggle group={group} selected={selected} onChange={onChange} />
            </legend>
            <ul className="event-picker-list">
              {group.events.map((e) => (
                <li key={e.type}>
                  <label className="event-picker-item">
                    <input type="checkbox" checked={selected.includes(e.type)} onChange={() => toggle(e.type)} />
                    <div>
                      <code>{e.type}</code>
                      <span>{e.description}</span>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
      <p className="event-picker-count">
        {selected.length === 1 ? '1 evento assinado' : `${selected.length} eventos assinados`}
      </p>
    </>
  );
}

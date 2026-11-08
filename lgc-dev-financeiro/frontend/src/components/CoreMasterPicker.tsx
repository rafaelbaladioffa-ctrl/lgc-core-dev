import { useEffect, useRef, useState } from 'react';
import { lookupMaster, MIN_MASTER_SEARCH, type MasterItem, type MasterKind } from '../lib/masterData';
import { Badge, messageOf } from './ui';

const DEBOUNCE_MS = 300;

/**
 * Escolha de um cadastro do Core (site, cliente, projeto, cargo…) a partir do cache do Financeiro. Mostra o
 * escolhido ("Mantido no Axis Core") e busca por código ou nome (2+ caracteres, ~300 ms depois da digitação).
 * Falha da consulta aparece aqui; o resto do formulário continua editável.
 */
export function CoreMasterPicker({
  kind,
  value,
  selected,
  editable,
  placeholder,
  emptyLabel,
  onPick,
}: {
  kind: MasterKind;
  /** Id do Core escolhido (nulo = nenhum). */
  value: string | null;
  /** O escolhido já resolvido (ex.: veio junto com o registro); sem ele, a tela busca pelo id. */
  selected?: MasterItem | null;
  editable: boolean;
  placeholder: string;
  emptyLabel: string;
  onPick: (item: MasterItem | null) => void;
}) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<MasterItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<MasterItem | null>(selected ?? null);
  const seq = useRef(0);
  /** O último escolhido nesta tela: evita buscar de novo o que acabou de ser clicado. */
  const picked = useRef<MasterItem | null>(null);

  // Mostra o escolhido: o que veio pronto, o que acabou de ser clicado ou, se só há o id, busca no cache.
  useEffect(() => {
    if (!value) return setCurrent(null);
    const known = selected?.axisId === value ? selected : picked.current?.axisId === value ? picked.current : null;
    if (known) return setCurrent(known);
    let alive = true;
    lookupMaster(kind, { ids: [value] })
      .then((r) => alive && setCurrent(r[0] ?? null))
      .catch(() => alive && setCurrent(null));
    return () => {
      alive = false;
    };
  }, [kind, value, selected]);

  useEffect(() => {
    const term = text.trim();
    const mine = ++seq.current;
    if (term.length < MIN_MASTER_SEARCH) {
      setResults(null);
      setMessage(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      lookupMaster(kind, { search: term })
        .then((r) => mine === seq.current && (setResults(r), setMessage(null)))
        .catch((e: unknown) => mine === seq.current && (setResults(null), setMessage(messageOf(e, 'Não foi possível consultar os cadastros do Axis Core.'))))
        .finally(() => mine === seq.current && setLoading(false));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [kind, text]);

  const pick = (item: MasterItem | null) => {
    picked.current = item;
    setCurrent(item);
    onPick(item);
    setText('');
    setResults(null);
    setMessage(null);
  };

  return (
    <div className="logistics-picker">
      {value ? (
        <span>
          {current ? current.label : <code>{value}</code>} {current && !current.active && <Badge tone="warning">Inativo no Core</Badge>}{' '}
          {editable && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => pick(null)}>
              Trocar
            </button>
          )}
        </span>
      ) : (
        <span className="muted">{emptyLabel}</span>
      )}
      {editable && !value && (
        <>
          <input aria-label={placeholder} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
          {loading && <small className="muted">Buscando…</small>}
          {message && <small className="field-error">{message}</small>}
          {results && results.length === 0 && !loading && !message && <small className="muted">Nada encontrado nos cadastros do Axis Core.</small>}
          {results && results.length > 0 && (
            <ul className="picker-results">
              {results.map((m) => (
                <li key={m.axisId}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => pick(m)}>
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

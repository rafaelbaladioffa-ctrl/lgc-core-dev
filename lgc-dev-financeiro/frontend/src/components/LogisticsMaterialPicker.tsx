import { useEffect, useRef, useState } from 'react';
import { searchLogisticsMaterials, type LogisticsMaterial } from '../lib/budgets';
import { messageOf } from './ui';

/**
 * Vínculo do material da cotação com o catálogo da Logística (P-06 / PA-08).
 * Mostra o código escolhido e, com a revisão editável, busca por código ou descrição.
 */
export function LogisticsMaterialPicker({ code, editable, onPick }: { code: string | null; editable: boolean; onPick: (m: LogisticsMaterial | null) => void }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<LogisticsMaterial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchLogisticsMaterials(q)
        .then((r) => mine === seq.current && (setResults(r), setError(null)))
        .catch((e: unknown) => mine === seq.current && (setResults(null), setError(messageOf(e, 'Não foi possível buscar na Logística.'))))
        .finally(() => mine === seq.current && setLoading(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [text]);

  const pick = (m: LogisticsMaterial | null) => {
    onPick(m);
    setText('');
    setResults(null);
  };

  return (
    <div className="logistics-picker">
      {code ? (
        <span>
          <code>{code}</code>{' '}
          {editable && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => pick(null)}>
              Trocar
            </button>
          )}
        </span>
      ) : (
        <span className="field-error">Sem código da Logística</span>
      )}
      {editable && !code && (
        <>
          <input aria-label="Buscar material na Logística" placeholder="Buscar na Logística (código ou nome)" value={text} onChange={(e) => setText(e.target.value)} />
          {loading && <small className="muted">Buscando…</small>}
          {error && <small className="field-error">{error}</small>}
          {results && results.length === 0 && !loading && <small className="muted">Nada encontrado. Cadastre o material na Logística antes.</small>}
          {results && results.length > 0 && (
            <ul className="picker-results">
              {results.map((m) => (
                <li key={m.id}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => pick(m)}>
                    {m.code} — {m.description}
                    {m.unit ? ` (${m.unit})` : ''}
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

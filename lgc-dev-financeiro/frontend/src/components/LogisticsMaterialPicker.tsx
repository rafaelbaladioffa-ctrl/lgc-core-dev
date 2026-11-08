import { useEffect, useRef, useState } from 'react';
import { findLogisticsMaterialByCode, searchLogisticsMaterials, type LogisticsMaterial } from '../lib/budgets';
import { messageOf } from './ui';

const MIN_SEARCH = 2;
const DEBOUNCE_MS = 300;

/**
 * Vínculo do material da cotação com o catálogo da Logística (P-06 / PA-08).
 * Mostra o código escolhido e, com a revisão editável, busca por nome ou código (2+ caracteres, ~300 ms depois da
 * digitação). Enter confere o texto como código exato. Se a Logística falhar, o erro aparece aqui e o resto do
 * orçamento continua editável.
 */
export function LogisticsMaterialPicker({ code, editable, onPick }: { code: string | null; editable: boolean; onPick: (m: LogisticsMaterial | null) => void }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<LogisticsMaterial[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = text.trim();
    const mine = ++seq.current;
    if (term.length < MIN_SEARCH) {
      setResults(null);
      setMessage(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchLogisticsMaterials(term)
        .then((r) => mine === seq.current && (setResults(r), setMessage(null)))
        .catch((e: unknown) => mine === seq.current && (setResults(null), setMessage(messageOf(e, 'A Logística está indisponível no momento. Tente de novo em instantes.'))))
        .finally(() => mine === seq.current && setLoading(false));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  const pick = (m: LogisticsMaterial | null) => {
    onPick(m);
    setText('');
    setResults(null);
    setMessage(null);
  };

  /** Enter: confere o texto como código exato (caminho direto, sem esperar a lista). */
  const byExactCode = async () => {
    const wanted = text.trim();
    if (wanted.length < MIN_SEARCH) return;
    seq.current++;
    setLoading(true);
    try {
      const found = (await findLogisticsMaterialByCode(wanted)).find((m) => m.code === wanted);
      if (found) pick(found);
      else setMessage('Código não encontrado ou inativo na Logística. Escolha um item da lista ou cadastre o material antes.');
    } catch (e) {
      setMessage(messageOf(e, 'A Logística está indisponível no momento. Tente de novo em instantes.'));
    } finally {
      setLoading(false);
    }
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
          <input
            aria-label="Buscar material na Logística"
            placeholder="Buscar na Logística (nome ou código)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void byExactCode();
              }
            }}
          />
          {loading && <small className="muted">Buscando…</small>}
          {message && <small className="field-error">{message}</small>}
          {results && results.length === 0 && !loading && !message && <small className="muted">Nada encontrado. Cadastre o material na Logística antes.</small>}
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

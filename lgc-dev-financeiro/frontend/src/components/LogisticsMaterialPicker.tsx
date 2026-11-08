import { useState } from 'react';
import { findLogisticsMaterialByCode, type LogisticsMaterial } from '../lib/budgets';
import { messageOf } from './ui';

/**
 * Vínculo do material da cotação com o catálogo da Logística (P-06 / PA-08).
 * Mostra o código escolhido e, com a revisão editável, confere o código digitado no catálogo da Logística
 * (a rota da Logística consulta só por código exato).
 */
export function LogisticsMaterialPicker({ code, editable, onPick }: { code: string | null; editable: boolean; onPick: (m: LogisticsMaterial | null) => void }) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    const wanted = text.trim();
    if (wanted.length < 2) {
      setMessage('Informe o código do material na Logística.');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const found = (await findLogisticsMaterialByCode(wanted)).find((m) => m.code === wanted);
      if (!found) {
        setMessage('Código não encontrado ou inativo na Logística. Confira o código ou cadastre o material antes.');
        return;
      }
      onPick(found);
      setText('');
    } catch (e) {
      setMessage(messageOf(e, 'Não foi possível consultar a Logística.'));
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
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => onPick(null)}>
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
            aria-label="Código do material na Logística"
            placeholder="Código na Logística (ex.: RED-CAB-0123)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void lookup();
              }
            }}
          />
          <button className="btn btn-ghost btn-sm" type="button" disabled={loading} onClick={() => void lookup()}>
            {loading ? 'Consultando…' : 'Vincular'}
          </button>
          {message && <small className="field-error">{message}</small>}
        </>
      )}
    </div>
  );
}

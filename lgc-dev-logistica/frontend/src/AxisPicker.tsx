import { useEffect, useId, useMemo, useState } from 'react';
import { axisItemLabel, resolveAxis, searchAxis, type AxisItem, type AxisKind } from './lib/lookups';
import { useDebounced, useLoad } from './ui';

/**
 * Troca ids do Core por nomes do cache (`GET /axis/lookup?ids=`). Enquanto carrega, ou se a consulta falhar, o mapa fica vazio e a
 * tela mostra o id encurtado (`axisName`): a leitura nunca quebra por causa do nome.
 */
export function useAxisNames(kinds: AxisKind[], ids: Array<string | null | undefined>): Map<string, AxisItem> {
  const key = [...new Set(ids.filter((id): id is string => !!id))].sort().join(',');
  const kindKey = kinds.join(',');
  const [res] = useLoad(() => (key ? resolveAxis(kindKey.split(',') as AxisKind[], key.split(',')) : Promise.resolve([])), [key, kindKey]);
  return useMemo(() => {
    const m = new Map<string, AxisItem>();
    // Mesmo id em mais de um tipo (pessoa): vale a ordem de `kinds`.
    const items = res.state === 'ready' ? [...res.data].sort((a, b) => kindKey.split(',').indexOf(b.kind) - kindKey.split(',').indexOf(a.kind)) : [];
    for (const x of items) m.set(x.id, x);
    return m;
  }, [res, kindKey]);
}

/**
 * Seletor de cadastro do Core (projeto, centro de custo, pessoa, site, cliente): busca no cache por nome ou código e devolve o id.
 * Só lista ativos. Nunca aceita texto livre nem UUID digitado (regra 4 do mapa de interoperabilidade).
 */
export function AxisPicker({ kinds, value, onChange, label, placeholder = 'Buscar por nome ou código', disabled }: {
  kinds: AxisKind[];
  value: string;
  onChange: (id: string, item: AxisItem | null) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const uid = useId();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const q = useDebounced(term, 250);
  const kindKey = kinds.join(',');
  const [res, reload] = useLoad(() => (open ? searchAxis(kindKey.split(',') as AxisKind[], q) : Promise.resolve([])), [open, q, kindKey]);
  const names = useAxisNames(kinds, [value]);
  const chosen = value ? names.get(value) : undefined;
  useEffect(() => { if (!value) setTerm(''); }, [value]);

  const pick = (x: AxisItem | null) => { onChange(x?.id ?? '', x); setOpen(false); setTerm(''); };
  const items = res.state === 'ready' ? res.data : [];
  return (
    <div>
      <label className="lbl" htmlFor={`${uid}-q`}>{label}</label>
      {value && !open ? (
        <div className="row">
          <span className="pill">{chosen ? axisItemLabel(chosen) : 'Carregando…'}</span>
          {!disabled && <button type="button" className="btn ghost" onClick={() => setOpen(true)}>Trocar</button>}
          {!disabled && <button type="button" className="btn ghost" onClick={() => pick(null)}>Remover</button>}
        </div>
      ) : (
        <>
          <input id={`${uid}-q`} className="inp" value={term} placeholder={placeholder} disabled={disabled} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${uid}-list`}
            onFocus={() => setOpen(true)} onChange={(e) => { setTerm(e.target.value); setOpen(true); }} />
          {open && (
            <div id={`${uid}-list`} role="listbox" aria-label={label} className="card axis-options">
              {res.state === 'loading' && <div className="skeleton" />}
              {res.state === 'error' && <p className="err" role="alert">{res.message} <button type="button" className="btn ghost" onClick={reload}>Tentar de novo</button></p>}
              {res.state === 'ready' && items.length === 0 && <p className="hint">Nenhum cadastro ativo encontrado no Axis. Se acabou de ser criado no Core, aguarde a sincronização.</p>}
              {items.map((x) => (
                <button key={`${x.kind}:${x.id}`} type="button" role="option" aria-selected={x.id === value} className="btn ghost axis-option" onClick={() => pick(x)}>{axisItemLabel(x)}</button>
              ))}
              <div className="row"><button type="button" className="btn ghost" onClick={() => { setOpen(false); setTerm(''); }}>Fechar</button></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

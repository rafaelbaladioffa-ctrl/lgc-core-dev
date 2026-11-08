import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';

export const messageOf = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Carrega dados com estado de erro e "Tentar de novo" (toda chamada de API trata erro na tela). */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[], fallback = 'Não foi possível carregar os dados.') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    load()
      .then(setData)
      .catch((e: unknown) => setError(messageOf(e, fallback)))
      .finally(() => setLoading(false));
  }, [load, fallback]);
  useEffect(reload, [reload]);
  return { data, setData, error, loading, reload };
}

export function ErrorAlert({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-danger" role="alert">
      {message}{' '}
      {onRetry && (
        <button className="btn btn-ghost btn-sm" type="button" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, back, actions, children }: { title: string; back?: { href: string; label: string }; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {back && (
          <a className="breadcrumb" href={`#${back.href}`}>
            ← {back.label}
          </a>
        )}
        <h1>{title}</h1>
        {children}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'success' | 'warning' | 'neutral' | 'danger'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <abbr title="obrigatório"> *</abbr>}
      </span>
      {children}
      {hint && !error && <small className="field-hint">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

/** Avisa antes de sair da página com alterações não salvas. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

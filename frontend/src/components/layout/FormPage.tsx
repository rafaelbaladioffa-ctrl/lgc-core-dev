import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppLayout } from './AppLayout';
import { Button } from '../Button';

/**
 * Shared shell for every create/edit form in the ERP: a dedicated page (not a modal/card), with
 * breadcrumb, sectioned fields, and a submit/cancel row. Collaborators was the first module
 * migrated to this pattern; every module now reuses this component instead of its own modal so
 * the convention doesn't need to be re-requested each time a new module is added.
 */

export const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 };
export const labelStyle = { fontSize: 11, color: 'var(--text-muted)' };
export const sectionTitleStyle = { margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase' as const };
export const sectionStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)' as const,
  padding: 16,
  marginBottom: 14,
};

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={sectionStyle}>
      <h4 style={sectionTitleStyle}>{title}</h4>
      {children}
    </div>
  );
}

interface FormPageProps {
  breadcrumb: string[];
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  error?: string | null;
  submitLabel?: string;
  loading?: boolean;
  children: ReactNode;
  maxWidth?: number;
}

export function FormPage({
  breadcrumb,
  onSubmit,
  onCancel,
  error,
  submitLabel = 'Salvar',
  loading,
  children,
  maxWidth = 880,
}: FormPageProps) {
  // Double-submit protection (PLANNING.md 1.1): disable the submit/cancel row while onSubmit's
  // promise is in flight, regardless of which module's form this is — every form goes through
  // this one shell, so the guard only needs to live here once.
  const [submitting, setSubmitting] = useState(false);
  // Unsaved-changes warning (PLANNING.md 1.1): any change inside the form marks it dirty (native
  // 'input'/'change' bubbling, so it works without each page tracking its own dirty state), and
  // we warn before a real tab close/refresh and before the Cancelar button discards it. Submitting
  // successfully navigates away via onCancel-style routing in each page, which doesn't trigger
  // beforeunload, so no explicit reset is needed there.
  const dirtyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (dirtyRef.current && !window.confirm('Existem alterações não salvas. Deseja realmente sair sem salvar?')) {
      return;
    }
    onCancel();
  };

  return (
    <AppLayout breadcrumb={breadcrumb}>
      {loading ? (
        <p>Carregando...</p>
      ) : (
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          onChange={() => {
            dirtyRef.current = true;
          }}
          style={{ maxWidth }}
        >
          {children}

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            {/* "Cadastrar"/"Salvar" is a create/persist action, not a query — positive green per
                the reference spec's button semantics (primary navy is reserved for Filtrar-style
                consult actions), so this isn't the same navy as the topbar/primary actions. */}
            <Button type="submit" variant="positive" disabled={submitting} style={{ padding: '0 18px' }}>
              {submitting ? 'Salvando...' : submitLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={submitting} style={{ padding: '0 18px' }}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </AppLayout>
  );
}

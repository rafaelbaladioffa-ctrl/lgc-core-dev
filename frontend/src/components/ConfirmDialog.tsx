import { useEffect } from 'react';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'positive';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Diálogo de confirmação simples e reaproveitável (no lugar de window.confirm). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'positive',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div className="axis-dialog-overlay" onClick={() => !busy && onCancel()}>
      <div className="axis-dialog" role="alertdialog" aria-modal="true" aria-labelledby="axis-dialog-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="axis-dialog-title">{title}</h3>
        <p>{message}</p>
        <div className="axis-dialog-actions">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={tone === 'danger' ? 'danger' : 'positive'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Aguarde...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

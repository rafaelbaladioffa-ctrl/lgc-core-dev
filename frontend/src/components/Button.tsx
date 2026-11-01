import type { ButtonHTMLAttributes } from 'react';

/**
 * The 5 semantic button variants from the reference spec (section 5.2): primary navy for
 * query/consult actions, positive green for create actions, secondary gray/outline for
 * everything else, info blue/cyan for configure-type actions, danger red for destructive ones —
 * always with confirmation + permission already enforced by the caller.
 */
export type ButtonVariant = 'primary' | 'positive' | 'secondary' | 'info' | 'danger';

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: 'var(--bg-topbar)', color: '#fff', border: 'none' },
  positive: { background: 'var(--success)', color: '#fff', border: 'none' },
  secondary: { background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)' },
  info: { background: 'var(--accent)', color: '#fff', border: 'none' },
  danger: { background: 'var(--danger)', color: '#fff', border: 'none' },
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'secondary', style, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      style={{
        height: 'var(--control-height)',
        padding: '0 14px',
        borderRadius: 'var(--radius)',
        fontSize: 12,
        fontWeight: variant === 'secondary' ? 400 : 600,
        whiteSpace: 'nowrap',
        ...VARIANT_STYLES[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

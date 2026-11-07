import type { ButtonHTMLAttributes } from 'react';

/**
 * The 5 semantic button variants from the reference spec (section 5.2): primary navy for
 * query/consult actions, positive green for create actions, secondary gray/outline for
 * everything else, info blue/cyan for configure-type actions, danger red for destructive ones —
 * always with confirmation + permission already enforced by the caller.
 */
export type ButtonVariant = 'primary' | 'positive' | 'secondary' | 'tertiary' | 'ghost' | 'outline' | 'info' | 'danger';

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: 'var(--primary)', color: 'var(--primary-foreground)', border: '1px solid var(--primary)' },
  positive: { background: 'var(--primary)', color: 'var(--primary-foreground)', border: '1px solid var(--primary)' },
  secondary: { background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)' },
  tertiary: { background: 'var(--surface-secondary)', color: 'var(--foreground)', border: '1px solid var(--border-subtle)' },
  ghost: { background: 'transparent', color: 'var(--primary)', border: '1px solid transparent' },
  outline: { background: 'transparent', color: 'var(--primary)', border: '1px solid var(--primary)' },
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
        fontSize: 'var(--text-sm)',
        fontWeight: variant === 'secondary' || variant === 'tertiary' ? 500 : 600,
        whiteSpace: 'nowrap',
        ...VARIANT_STYLES[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

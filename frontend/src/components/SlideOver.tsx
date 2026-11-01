import type { ReactNode } from 'react';

/**
 * Right-edge slide-over panel with a dimming overlay — used for quick detail views that don't
 * warrant navigating away from the current list (ticket quick view, outbox delivery timeline).
 */
export function SlideOver({ title, onClose, children, width = 440 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '92vw',
          height: '100%',
          background: 'var(--bg-elevated)',
          boxShadow: 'var(--shadow)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'axis-slide-in 0.15s ease-out',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1 }}>
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>{children}</div>
      </div>
      <style>{`
        @keyframes axis-slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

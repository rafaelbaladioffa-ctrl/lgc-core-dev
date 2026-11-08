import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { requestsApi } from '../../api/requests';
import { certificationsApi } from '../../api/certifications';
import { outboxApi } from '../../api/outbox';
import { projectsApi } from '../../api/projects';

interface NotificationItem {
  id: string;
  message: string;
  tone: 'danger' | 'warning';
  onClick: () => void;
}

export function NotificationsDropdown() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  // Total count of matching notifications, independent of how many are actually listed in the
  // dropdown (each category is capped at 5 for display) — the badge previously summed the
  // truncated per-category slices, so it under-reported whenever any category had more than 5.
  const [totalCount, setTotalCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    const next: NotificationItem[] = [];
    let total = 0;
    const DISPLAY_LIMIT = 5;

    if (hasPermission('request:read')) {
      const requests = await requestsApi.queue();
      const now = Date.now();
      const overdue = requests.filter((r) => r.slaDueResolutionAt !== null && new Date(r.slaDueResolutionAt).getTime() < now && !['concluida', 'encerrada', 'cancelada', 'reprovada'].includes(r.status));
      total += overdue.length;
      for (const r of overdue.slice(0, DISPLAY_LIMIT)) {
        next.push({
          id: `request-${r.id}`,
          message: `Requisição ${r.code} fora do SLA de solução`,
          tone: 'danger',
          onClick: () => navigate(`/requests/${r.id}`),
        });
      }
    }

    if (hasPermission('certification:read')) {
      const expiring = await certificationsApi.expiring(30);
      total += expiring.length;
      for (const c of expiring.slice(0, DISPLAY_LIMIT)) {
        const days = Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / 86_400_000);
        next.push({
          id: `cert-${c.id}`,
          message: `${c.type} de ${c.collaborator.fullName} ${days < 0 ? 'venceu' : `vence em ${days}d`}`,
          tone: days < 0 ? 'danger' : 'warning',
          onClick: () => navigate(`/collaborators/${c.collaboratorId}/edit`),
        });
      }
    }

    if (hasPermission('project:read')) {
      // Obra concluída no Field nos projetos do usuário: encerrar o projeto continua manual (PA-18).
      // Aviso é auxiliar: se a consulta falhar, o resto das notificações continua valendo.
      const completed = await projectsApi.fieldAlerts().catch(() => []);
      total += completed.length;
      for (const p of completed.slice(0, DISPLAY_LIMIT)) {
        next.push({
          id: `field-completed-${p.projectId}`,
          message: `Obra do projeto ${p.projectCode} concluída no Field — encerre o projeto`,
          tone: 'warning',
          onClick: () => navigate(`/projects/${p.projectId}/edit`),
        });
      }
    }

    if (hasPermission('integration:read')) {
      const failed = await outboxApi.list({ status: 'failed', perPage: DISPLAY_LIMIT });
      total += failed.meta.total;
      for (const e of failed.data) {
        next.push({
          id: `outbox-${e.id}`,
          message: `Falha na entrega do evento ${e.eventType}`,
          tone: 'danger',
          onClick: () => navigate('/integrations'),
        });
      }
    }

    setItems(next);
    setTotalCount(total);
  };

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notificações"
        style={{
          position: 'relative',
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          borderRadius: 6,
          padding: '5px 9px',
          fontSize: 14,
          color: 'var(--text)',
        }}
      >
        🔔
        {totalCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              background: 'var(--danger)',
              color: '#fff',
              borderRadius: 999,
              fontSize: 10,
              lineHeight: 1,
              padding: '2px 5px',
              fontWeight: 700,
            }}
          >
            {totalCount}
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            width: 320,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: 'var(--shadow)',
            zIndex: 100,
          }}
        >
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600 }}>Notificações</div>
          {items.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma notificação no momento.</div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  background: 'none',
                  fontSize: 12,
                  color: item.tone === 'danger' ? 'var(--danger)' : 'var(--warning)',
                  cursor: 'pointer',
                }}
              >
                {item.message}
              </button>
            ))
          )}
          {totalCount > items.length && (
            <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              +{totalCount - items.length} outras notificações
            </div>
          )}
          <button
            onClick={() => {
              navigate('/dashboard');
              setOpen(false);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'center',
              padding: '10px 14px',
              border: 'none',
              background: 'none',
              fontSize: 12,
              color: 'var(--accent)',
              cursor: 'pointer',
            }}
          >
            Ver todas
          </button>
        </div>
      )}
    </div>
  );
}

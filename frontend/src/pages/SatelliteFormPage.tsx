import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { FormSection, sectionStyle } from '../components/layout/FormPage';
import { integrationApi, type CreateSatelliteInput, type CreateSatelliteResult } from '../api/integration';
import { translateApiError } from '../utils/apiError';

const emptyForm: CreateSatelliteInput = { name: '', webhookUrl: '', subscribedEvents: [] };

const EVENT_TYPES = [
  'collaborator.created',
  'collaborator.updated',
  'collaborator.offboarded',
  'client.created',
  'client.updated',
  'project.created',
  'project.status_changed',
  'ticket.created',
  'ticket.status_changed',
  'ticket.escalated',
];

export function SatelliteFormPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<CreateSatelliteInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateSatelliteResult | null>(null);

  const toggleEvent = (eventType: string) => {
    setForm((f) => ({
      ...f,
      subscribedEvents: f.subscribedEvents.includes(eventType)
        ? f.subscribedEvents.filter((e) => e !== eventType)
        : [...f.subscribedEvents, eventType],
    }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setCreated(await integrationApi.create(form));
    } catch (err) {
      setError(translateApiError(err, 'Erro ao registrar satélite.'));
    }
  };

  if (created) {
    return (
      <AppLayout breadcrumb={['Axis', 'Integrações', 'Novo satélite']}>
        <div style={{ ...sectionStyle, maxWidth: 520 }}>
          <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>
            Guarde estas credenciais agora — elas não serão mostradas novamente.
          </p>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>API Key</label>
          <code style={{ display: 'block', padding: 8, background: 'var(--bg)', borderRadius: 6, marginBottom: 10, wordBreak: 'break-all' }}>
            {created.apiKey}
          </code>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>HMAC Secret</label>
          <code style={{ display: 'block', padding: 8, background: 'var(--bg)', borderRadius: 6, wordBreak: 'break-all' }}>{created.hmacSecret}</code>
          <button
            onClick={() => navigate('/integrations')}
            style={{
              marginTop: 16,
              width: '100%',
              background: 'var(--accent)',
              color: 'var(--accent-contrast)',
              border: 'none',
              borderRadius: 6,
              padding: '9px',
              fontWeight: 600,
            }}
          >
            Entendi, fechar
          </button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={['Axis', 'Integrações', 'Novo satélite']}>
      <form onSubmit={onSubmit} style={{ maxWidth: 520 }}>
        <FormSection title="Dados do satélite">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input placeholder="Nome do satélite" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input placeholder="URL do webhook" value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} required />
            <input
              placeholder="URL do frontend (opcional — habilita o botão “Abrir”)"
              value={form.frontendUrl ?? ''}
              onChange={(e) => setForm({ ...form, frontendUrl: e.target.value || undefined })}
            />
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Eventos inscritos</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {EVENT_TYPES.map((eventType) => (
                  <label key={eventType} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={form.subscribedEvents.includes(eventType)} onChange={() => toggleEvent(eventType)} />
                    {eventType}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </FormSection>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="submit"
            disabled={form.subscribedEvents.length === 0}
            style={{ background: 'var(--accent)', color: 'var(--accent-contrast)', border: 'none', borderRadius: 6, padding: '10px 20px', fontWeight: 600 }}
          >
            Registrar satélite
          </button>
          <button
            type="button"
            onClick={() => navigate('/integrations')}
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 20px' }}
          >
            Cancelar
          </button>
        </div>
      </form>
    </AppLayout>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { Button } from '../components/Button';
import { EventSubscriptionPicker } from '../components/EventSubscriptionPicker';
import {
  integrationApi,
  type CreateSatelliteInput,
  type CreateSatelliteResult,
  type EventTypeInfo,
  type SatelliteDetail,
} from '../api/integration';
import { extractApiMessages } from '../utils/apiError';
import '../styles/satellite-form.css';

const emptyForm: CreateSatelliteInput = { name: '', webhookUrl: '', subscribedEvents: [] };

/**
 * Cadastro de satélite (`/integrations/new`) e edição da assinatura de um satélite já cadastrado
 * (`/integrations/:id/edit`). Os eventos vêm do catálogo do Core (`GET /integration/event-types`).
 */
export function SatelliteFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editing = Boolean(id);
  const [form, setForm] = useState<CreateSatelliteInput>(emptyForm);
  const [satellite, setSatellite] = useState<SatelliteDetail | null>(null);
  const [catalog, setCatalog] = useState<EventTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateSatelliteResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([integrationApi.eventTypes(), id ? integrationApi.get(id) : Promise.resolve(null)])
      .then(([types, existing]) => {
        if (cancelled) return;
        setCatalog(types);
        if (existing) {
          setSatellite(existing);
          setForm((f) => ({ ...f, subscribedEvents: existing.subscribedEvents }));
        }
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(extractApiMessages(err, 'Não foi possível carregar os eventos do Core.')[0]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.subscribedEvents.length === 0) {
      setError('Escolha ao menos um evento.');
      return;
    }
    try {
      if (id) {
        await integrationApi.updateSubscriptions(id, form.subscribedEvents);
        navigate('/integrations');
      } else {
        setCreated(await integrationApi.create(form));
      }
    } catch (err) {
      setError(extractApiMessages(err, editing ? 'Não foi possível salvar a assinatura.' : 'Erro ao registrar satélite.').join(' '));
    }
  };

  const breadcrumb = ['Axis', 'Integrações', editing ? `Assinatura de ${satellite?.name ?? 'satélite'}` : 'Novo satélite'];

  if (created) {
    return (
      <AppLayout breadcrumb={breadcrumb}>
        <div className="satellite-credentials">
          <FormSection title={`Credenciais de ${created.name}`}>
            <p className="satellite-credentials-warning">Guarde estas credenciais agora — elas não serão mostradas novamente.</p>
            <label>API Key</label>
            <code>{created.apiKey}</code>
            <label>HMAC Secret</label>
            <code>{created.hmacSecret}</code>
            <Button variant="primary" className="satellite-credentials-close" onClick={() => navigate('/integrations')}>
              Entendi, fechar
            </Button>
          </FormSection>
        </div>
      </AppLayout>
    );
  }

  if (loadError) {
    return (
      <AppLayout breadcrumb={breadcrumb}>
        <p role="alert" className="satellite-form-error">
          {loadError}
        </p>
        <Button variant="secondary" onClick={() => navigate('/integrations')}>
          Voltar para Integrações
        </Button>
      </AppLayout>
    );
  }

  return (
    <FormPage
      breadcrumb={breadcrumb}
      onSubmit={onSubmit}
      onCancel={() => navigate('/integrations')}
      error={error}
      loading={loading}
      submitLabel={editing ? 'Salvar assinatura' : 'Registrar satélite'}
      maxWidth={960}
    >
      <FormSection title="Dados do satélite">
        {satellite ? (
          <dl className="satellite-form-summary">
            <dt>Nome</dt>
            <dd>{satellite.name}</dd>
            <dt>Webhook</dt>
            <dd>
              <code>{satellite.webhookUrl}</code>
            </dd>
            <dt>Frontend</dt>
            <dd>{satellite.frontendUrl ?? '—'}</dd>
          </dl>
        ) : (
          <div className="satellite-form-fields">
            <input placeholder="Nome do satélite" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input placeholder="URL do webhook" value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} required />
            <input
              placeholder="URL do frontend (opcional — habilita o botão “Abrir”)"
              value={form.frontendUrl ?? ''}
              onChange={(e) => setForm({ ...form, frontendUrl: e.target.value || undefined })}
            />
          </div>
        )}
      </FormSection>

      <FormSection title="Eventos assinados">
        <p className="satellite-form-hint">
          O satélite recebe no webhook só os eventos marcados. A mudança vale também para os eventos ainda pendentes de entrega.
        </p>
        <EventSubscriptionPicker
          catalog={catalog}
          selected={form.subscribedEvents}
          onChange={(subscribedEvents) => setForm((f) => ({ ...f, subscribedEvents }))}
        />
      </FormSection>
    </FormPage>
  );
}

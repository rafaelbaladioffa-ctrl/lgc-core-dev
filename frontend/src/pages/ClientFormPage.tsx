import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { clientsApi, type CreateClientInput } from '../api/clients';
import { translateApiError } from '../utils/apiError';
import { MASKS } from '../utils/mask';
import { MaskedInput } from '../components/MaskedInput';
import { ClientSites } from '../components/ClientSites';

const emptyForm: CreateClientInput = { legalName: '', cnpj: '' };

export function ClientFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState<CreateClientInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!id) return;
    void clientsApi.get(id).then((c) => {
      setForm({ legalName: c.legalName, cnpj: c.cnpj ?? undefined });
      setLoading(false);
    });
  }, [id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit && id) {
        await clientsApi.update(id, form);
      } else {
        await clientsApi.create(form);
      }
      navigate('/clients');
    } catch (err) {
      setError(translateApiError(err, isEdit ? 'Erro ao salvar cliente.' : 'Erro ao cadastrar cliente.'));
    }
  };

  return (
    <FormPage
      breadcrumb={['Axis', 'Clientes', isEdit ? 'Editar' : 'Novo']}
      onSubmit={onSubmit}
      onCancel={() => navigate('/clients')}
      error={error}
      loading={loading}
      submitLabel={isEdit ? 'Salvar alterações' : 'Cadastrar'}
      maxWidth={520}
    >
      <FormSection title="Dados do cliente">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="Razão social" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} required />
          <MaskedInput mask={MASKS.cnpj} value={form.cnpj ?? ''} onChange={(v) => setForm({ ...form, cnpj: v })} placeholder="CNPJ" />
        </div>
      </FormSection>
      {isEdit && id && (
        <FormSection title="Sites">
          <ClientSites clientId={id} />
        </FormSection>
      )}
    </FormPage>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { clientsApi, type CreateClientInput } from '../api/clients';
import { lookupCep } from '../api/collaborators';
import { translateApiError } from '../utils/apiError';
import { MASKS, formatPhoneBR } from '../utils/mask';
import { MaskedInput } from '../components/MaskedInput';
import { ClientSites } from '../components/ClientSites';
import '../styles/client-form.css';

type FormState = {
  legalName: string;
  tradeName: string;
  cnpj: string;
  phone: string;
  email: string;
  cep: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressDistrict: string;
  addressCity: string;
  addressState: string;
};

const emptyForm: FormState = {
  legalName: '',
  tradeName: '',
  cnpj: '',
  phone: '',
  email: '',
  cep: '',
  addressStreet: '',
  addressNumber: '',
  addressComplement: '',
  addressDistrict: '',
  addressCity: '',
  addressState: '',
};

/** Campo vazio vai como `null`: limpa o valor na edição e evita CNPJ `''` duplicado no índice único. */
function toInput(form: FormState): CreateClientInput {
  const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    legalName: form.legalName.trim(),
    tradeName: orNull(form.tradeName),
    cnpj: orNull(form.cnpj),
    phone: orNull(form.phone),
    email: orNull(form.email),
    cep: orNull(form.cep),
    addressStreet: orNull(form.addressStreet),
    addressNumber: orNull(form.addressNumber),
    addressComplement: orNull(form.addressComplement),
    addressDistrict: orNull(form.addressDistrict),
    addressCity: orNull(form.addressCity),
    addressState: orNull(form.addressState.toUpperCase()),
  };
}

export function ClientFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const lastCepLookup = useRef<string | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!id) return;
    clientsApi
      .get(id)
      .then((c) => {
        setForm({
          legalName: c.legalName,
          tradeName: c.tradeName ?? '',
          cnpj: c.cnpj ?? '',
          phone: c.phone ?? '',
          email: c.email ?? '',
          cep: c.cep ?? '',
          addressStreet: c.addressStreet ?? '',
          addressNumber: c.addressNumber ?? '',
          addressComplement: c.addressComplement ?? '',
          addressDistrict: c.addressDistrict ?? '',
          addressCity: c.addressCity ?? '',
          addressState: c.addressState ?? '',
        });
        // Não consulta de novo o CEP já salvo ao abrir a edição.
        lastCepLookup.current = (c.cep ?? '').replace(/\D/g, '') || null;
      })
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar cliente.')))
      .finally(() => setLoading(false));
  }, [id]);

  const fetchAddress = async (cep: string) => {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8 || digits === lastCepLookup.current) return;
    lastCepLookup.current = digits;
    setCepError(null);
    setCepLoading(true);
    try {
      const outcome = await lookupCep(digits);
      if (outcome.kind === 'not_found') {
        setCepError('CEP não encontrado. Preencha o endereço manualmente.');
      } else if (outcome.kind === 'network_error') {
        setCepError('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
        lastCepLookup.current = null;
      } else if (outcome.kind === 'found') {
        const r = outcome.result;
        // O `complemento` do ViaCEP é a faixa de numeração da rua ("de 612 a 1510 - lado par"),
        // não o complemento do endereço do cliente: não é copiado.
        setForm((f) => ({
          ...f,
          addressStreet: r.logradouro || f.addressStreet,
          addressDistrict: r.bairro || f.addressDistrict,
          addressCity: r.localidade || f.addressCity,
          addressState: r.uf || f.addressState,
        }));
        numberRef.current?.focus();
      }
    } finally {
      setCepLoading(false);
    }
  };

  const onCepChange = (value: string) => {
    set('cep', value);
    if (value.replace(/\D/g, '').length === 8) void fetchAddress(value);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const input = toInput(form);
      if (isEdit && id) {
        await clientsApi.update(id, input);
      } else {
        await clientsApi.create(input);
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
      maxWidth={760}
    >
      <FormSection title="Dados do cliente">
        <div className="client-form-grid">
          <label className="axis-field span-6">
            Razão social *
            <input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} maxLength={255} required />
          </label>
          <label className="axis-field span-4">
            Nome fantasia
            <input value={form.tradeName} onChange={(e) => set('tradeName', e.target.value)} maxLength={255} />
          </label>
          <label className="axis-field span-2">
            CNPJ
            <MaskedInput mask={MASKS.cnpj} value={form.cnpj} onChange={(v) => set('cnpj', v)} placeholder="00.000.000/0000-00" />
          </label>
        </div>
      </FormSection>

      <FormSection title="Contato">
        <div className="client-form-grid">
          <label className="axis-field span-2">
            Telefone
            <input
              value={form.phone}
              onChange={(e) => set('phone', formatPhoneBR(e.target.value))}
              inputMode="tel"
              placeholder="(00) 0000-0000"
            />
          </label>
          <label className="axis-field span-4">
            E-mail
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={255} placeholder="contato@empresa.com.br" />
          </label>
        </div>
      </FormSection>

      <FormSection title="Endereço">
        <div className="client-form-grid">
          <label className="axis-field span-2">
            {cepLoading ? 'Buscando CEP...' : 'CEP'}
            <MaskedInput
              mask={MASKS.cep}
              value={form.cep}
              onChange={onCepChange}
              onBlur={() => void fetchAddress(form.cep)}
              placeholder="00000-000"
            />
          </label>
          <label className="axis-field span-4">
            Logradouro
            <input value={form.addressStreet} onChange={(e) => set('addressStreet', e.target.value)} maxLength={255} />
          </label>
          <label className="axis-field span-2">
            Número
            <input ref={numberRef} value={form.addressNumber} onChange={(e) => set('addressNumber', e.target.value)} maxLength={20} />
          </label>
          <label className="axis-field span-4">
            Complemento
            <input value={form.addressComplement} onChange={(e) => set('addressComplement', e.target.value)} maxLength={120} />
          </label>
          <label className="axis-field span-2">
            Bairro
            <input value={form.addressDistrict} onChange={(e) => set('addressDistrict', e.target.value)} maxLength={120} />
          </label>
          <label className="axis-field span-3">
            Cidade
            <input value={form.addressCity} onChange={(e) => set('addressCity', e.target.value)} maxLength={120} />
          </label>
          <label className="axis-field span-1">
            UF
            <input value={form.addressState} onChange={(e) => set('addressState', e.target.value.toUpperCase())} maxLength={2} />
          </label>
        </div>
        {cepError && <p className="client-form-hint">{cepError}</p>}
      </FormSection>
      {isEdit && id && (
        <FormSection title="Sites">
          <ClientSites clientId={id} />
        </FormSection>
      )}
    </FormPage>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { MaskedInput } from '../components/MaskedInput';
import { sitesApi, type CreateSiteInput } from '../api/sites';
import { clientsApi } from '../api/clients';
import { lookupCep } from '../api/collaborators';
import { translateApiError } from '../utils/apiError';
import { MASKS } from '../utils/mask';
import '../styles/sites.css';

type FormState = {
  code: string;
  name: string;
  cep: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressDistrict: string;
  addressCity: string;
  addressState: string;
  latitude: string;
  longitude: string;
  active: boolean;
};

const emptyForm: FormState = {
  code: '',
  name: '',
  cep: '',
  addressStreet: '',
  addressNumber: '',
  addressComplement: '',
  addressDistrict: '',
  addressCity: '',
  addressState: '',
  latitude: '',
  longitude: '',
  active: true,
};

/** Mesmo padrão do servidor: letras, números, ponto, hífen e sublinhado, até 20 caracteres. */
const SITE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

/** Aceita vírgula ou ponto decimal; vazio é "sem coordenada". `NaN` quando não é número. */
function parseCoordinate(raw: string): number | null {
  if (raw.trim() === '') return null;
  return Number(raw.trim().replace(',', '.'));
}

const formatCoordinate = (value: number | null) => (value === null ? '' : String(value).replace('.', ','));

/**
 * Cadastro de site (local de obra/entrega) de um cliente. O cliente vem da rota e não muda;
 * o código (ex.: GRU53) é único dentro do cliente.
 */
export function SiteFormPage() {
  const { clientId = '', id } = useParams<{ clientId: string; id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [clientName, setClientName] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const lastCepLookup = useRef<string | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const backToClient = () => navigate(`/clients/${clientId}/edit`);

  useEffect(() => {
    clientsApi
      .get(clientId)
      .then((c) => setClientName(c.legalName))
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar o cliente.')));
  }, [clientId]);

  useEffect(() => {
    if (!id) return;
    sitesApi
      .get(id)
      .then((s) => {
        setForm({
          code: s.code,
          name: s.name,
          cep: s.cep ?? '',
          addressStreet: s.addressStreet ?? '',
          addressNumber: s.addressNumber ?? '',
          addressComplement: s.addressComplement ?? '',
          addressDistrict: s.addressDistrict ?? '',
          addressCity: s.addressCity ?? '',
          addressState: s.addressState ?? '',
          latitude: formatCoordinate(s.latitude),
          longitude: formatCoordinate(s.longitude),
          active: s.active,
        });
        // Não consulta de novo o CEP já salvo ao abrir a edição.
        lastCepLookup.current = (s.cep ?? '').replace(/\D/g, '') || null;
      })
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar o site.')))
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
        // O `complemento` do ViaCEP é a faixa de numeração da rua, não o complemento do site: não é copiado.
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

    const code = form.code.trim().toUpperCase();
    if (!SITE_CODE_PATTERN.test(code)) {
      setError('Código do site inválido. Use letras, números, ponto, hífen ou sublinhado (até 20 caracteres), sem espaços.');
      return;
    }
    const latitude = parseCoordinate(form.latitude);
    const longitude = parseCoordinate(form.longitude);
    if (latitude !== null && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) {
      setError('Latitude inválida. Informe um número entre -90 e 90.');
      return;
    }
    if (longitude !== null && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) {
      setError('Longitude inválida. Informe um número entre -180 e 180.');
      return;
    }

    const fields = {
      code,
      name: form.name.trim(),
      cep: orNull(form.cep),
      addressStreet: orNull(form.addressStreet),
      addressNumber: orNull(form.addressNumber),
      addressComplement: orNull(form.addressComplement),
      addressDistrict: orNull(form.addressDistrict),
      addressCity: orNull(form.addressCity),
      addressState: orNull(form.addressState.toUpperCase()),
      latitude,
      longitude,
    } satisfies Omit<CreateSiteInput, 'clientId'>;

    try {
      if (isEdit && id) {
        await sitesApi.update(id, { ...fields, active: form.active });
      } else {
        await sitesApi.create({ clientId, ...fields });
      }
      backToClient();
    } catch (err) {
      setError(translateApiError(err, isEdit ? 'Erro ao salvar o site.' : 'Erro ao cadastrar o site.'));
    }
  };

  return (
    <FormPage
      breadcrumb={['Axis', 'Clientes', clientName ?? '…', isEdit ? `Site ${form.code || ''}`.trim() : 'Novo site']}
      onSubmit={onSubmit}
      onCancel={backToClient}
      error={error}
      loading={loading}
      submitLabel={isEdit ? 'Salvar alterações' : 'Cadastrar'}
      maxWidth={760}
    >
      <FormSection title="Dados do site">
        <div className="site-form-grid">
          <label className="axis-field span-2">
            Código *
            <input
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              maxLength={20}
              placeholder="GRU53"
              required
            />
          </label>
          <label className="axis-field span-4">
            Nome *
            <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={200} required />
          </label>
          {isEdit && (
            <label className="site-form-check span-6">
              <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Site ativo (site inativo não pode ser escolhido em projetos novos)
            </label>
          )}
        </div>
      </FormSection>

      <FormSection title="Endereço">
        <div className="site-form-grid">
          <label className="axis-field span-2">
            {cepLoading ? 'Buscando CEP...' : 'CEP'}
            <MaskedInput mask={MASKS.cep} value={form.cep} onChange={onCepChange} placeholder="00000-000" />
          </label>
          <label className="axis-field span-4">
            Logradouro
            <input value={form.addressStreet} onChange={(e) => set('addressStreet', e.target.value)} maxLength={255} />
          </label>
          <label className="axis-field span-2">
            Número
            <input ref={numberRef} value={form.addressNumber} onChange={(e) => set('addressNumber', e.target.value)} maxLength={30} />
          </label>
          <label className="axis-field span-4">
            Complemento
            <input value={form.addressComplement} onChange={(e) => set('addressComplement', e.target.value)} maxLength={100} />
          </label>
          <label className="axis-field span-2">
            Bairro
            <input value={form.addressDistrict} onChange={(e) => set('addressDistrict', e.target.value)} maxLength={100} />
          </label>
          <label className="axis-field span-3">
            Cidade
            <input value={form.addressCity} onChange={(e) => set('addressCity', e.target.value)} maxLength={100} />
          </label>
          <label className="axis-field span-1">
            UF
            <input value={form.addressState} onChange={(e) => set('addressState', e.target.value.toUpperCase())} maxLength={2} placeholder="SP" />
          </label>
          {cepError && <p className="site-form-hint span-6">{cepError}</p>}
        </div>
      </FormSection>

      <FormSection title="Localização (opcional)">
        <div className="site-form-grid">
          <label className="axis-field span-3">
            Latitude
            <input value={form.latitude} onChange={(e) => set('latitude', e.target.value)} inputMode="decimal" placeholder="-23,4356" />
          </label>
          <label className="axis-field span-3">
            Longitude
            <input value={form.longitude} onChange={(e) => set('longitude', e.target.value)} inputMode="decimal" placeholder="-46,4731" />
          </label>
          <p className="site-form-hint span-6">Usada pela Logística e pelo Field para localizar o site no mapa.</p>
        </div>
      </FormSection>
    </FormPage>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Button } from '../components/Button';
import { MaskedInput } from '../components/MaskedInput';
import { MASKS } from '../utils/mask';
import {
  collaboratorsApi,
  lookupCep,
  type CollaboratorSafe,
  type CollaboratorStatus,
  type CostCenterAllocation,
  type ContractType,
  type CreateCollaboratorInput,
  type Gender,
  type ManagementLevel,
  type MaritalStatus,
} from '../api/collaborators';
import { sectorsApi, type Sector } from '../api/sectors';
import { jobTitlesApi, type JobTitle } from '../api/jobTitles';
import { workSchedulesApi, type WorkSchedule } from '../api/workSchedules';
import { costCentersApi, type CostCenter } from '../api/costCenters';
import {
  certificationsApi,
  type Certification,
  type CertificationType,
  type CreateCertificationInput,
} from '../api/certifications';
import { translateApiError } from '../utils/apiError';
import { formatDateOnly } from '../utils/formatDate';
import '../styles/cost-centers.css';

const emptyForm: CreateCollaboratorInput = {
  fullName: '',
  rg: '',
  cpf: '',
  corporateEmail: '',
  jobTitleId: '',
  sectorId: '',
};

const NR_TYPES: CertificationType[] = ['NR10', 'NR35', 'NR12', 'NR18'];

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 };
const labelStyle = { fontSize: 11, color: 'var(--text-muted)' };
const sectionStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)' as const,
  padding: 20,
};

type StepId = 'basic' | 'contact' | 'address' | 'employment' | 'documents' | 'certifications';

interface StepDef {
  id: StepId;
  label: string;
}

const BASE_STEPS: StepDef[] = [
  { id: 'basic', label: 'Dados básicos' },
  { id: 'contact', label: 'Contato pessoal' },
  { id: 'address', label: 'Endereço' },
  { id: 'employment', label: 'Dados funcionais' },
  { id: 'documents', label: 'Documentos' },
];

const NR_STEP: StepDef = { id: 'certifications', label: 'Certificações NR' };

export function CollaboratorFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [workSchedules, setWorkSchedules] = useState<WorkSchedule[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [status, setStatus] = useState<CollaboratorStatus>('ativo');
  const [matricula, setMatricula] = useState<string | null>(null);
  const [form, setForm] = useState<CreateCollaboratorInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [newCerts, setNewCerts] = useState<Record<CertificationType, { enabled: boolean; issuedAt: string; expiresAt: string }>>({
    NR10: { enabled: false, issuedAt: '', expiresAt: '' },
    NR35: { enabled: false, issuedAt: '', expiresAt: '' },
    NR12: { enabled: false, issuedAt: '', expiresAt: '' },
    NR18: { enabled: false, issuedAt: '', expiresAt: '' },
  });
  const [existingCerts, setExistingCerts] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(isEdit);
  // Vigência do centro de custo (edição): CC salvo, início da nova alocação e histórico.
  const [originalCostCenterId, setOriginalCostCenterId] = useState<string | null>(null);
  const [costCenterEffectiveFrom, setCostCenterEffectiveFrom] = useState('');
  const [allocationHistory, setAllocationHistory] = useState<CostCenterAllocation[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [stepIndex, setStepIndex] = useState(0);
  // In create mode the wizard is strictly linear — a step is only reachable once the previous
  // one validated. In edit mode every step already has data loaded, so the user can jump freely
  // (the planning session asked for this split explicitly).
  const [maxVisited, setMaxVisited] = useState(0);

  useEffect(() => {
    void Promise.all([
      sectorsApi.list(),
      jobTitlesApi.list(),
      workSchedulesApi.list(),
      costCentersApi.list(),
      collaboratorsApi.list(),
    ]).then(([secs, jts, ws, ccs, cols]) => {
      setSectors(secs);
      setJobTitles(jts);
      setWorkSchedules(ws);
      setCostCenters(ccs);
      setCollaborators(cols);
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    collaboratorsApi
      .costCenterHistory(id)
      .then(setAllocationHistory)
      .catch((err: unknown) => setHistoryError(translateApiError(err, 'Não foi possível carregar o histórico de centros de custo.')));
    void (async () => {
      const c = await collaboratorsApi.get(id);
      setOriginalCostCenterId(c.costCenterId);
      setStatus(c.status);
      setMatricula(c.matricula);
      setForm({
        fullName: c.fullName,
        rg: '',
        cpf: '',
        corporateEmail: c.corporateEmail,
        personalEmail: c.personalEmail ?? undefined,
        jobTitleId: c.jobTitleId,
        sectorId: c.sectorId,
        supervisorId: c.supervisorId ?? undefined,
        asoDate: c.asoDate ?? undefined,
        asoValidity: c.asoValidity ?? undefined,
        yellowBadge: c.yellowBadge ?? undefined,
        managementLevel: c.managementLevel,
        phone: c.phone ?? undefined,
        emergencyContactName: c.emergencyContactName ?? undefined,
        emergencyContactPhone: c.emergencyContactPhone ?? undefined,
        birthDate: c.birthDate ?? undefined,
        maritalStatus: c.maritalStatus ?? undefined,
        gender: c.gender ?? undefined,
        cep: c.cep ?? undefined,
        addressStreet: c.addressStreet ?? undefined,
        addressNumber: c.addressNumber ?? undefined,
        addressComplement: c.addressComplement ?? undefined,
        addressDistrict: c.addressDistrict ?? undefined,
        addressCity: c.addressCity ?? undefined,
        addressState: c.addressState ?? undefined,
        admissionDate: c.admissionDate ?? undefined,
        contractType: c.contractType ?? undefined,
        workScheduleId: c.workScheduleId ?? undefined,
        costCenterId: c.costCenterId ?? undefined,
        photoFilename: c.photoFilename ?? undefined,
        photoStoragePath: c.photoStoragePath ?? undefined,
        uniformSize: c.uniformSize ?? undefined,
        cnhCategory: c.cnhCategory ?? undefined,
        cnhNumber: c.cnhNumber ?? undefined,
        cnhExpiresAt: c.cnhExpiresAt ?? undefined,
      });
      setExistingCerts(await certificationsApi.listForCollaborator(id));
      setLoading(false);
      // Edit mode: every step already has data, so the whole stepper unlocks immediately.
      setMaxVisited(BASE_STEPS.length);
    })();
  }, [id]);

  const selectedJobTitle = jobTitles.find((j) => j.id === form.jobTitleId);
  const isTechnician = selectedJobTitle?.isTechnician ?? false;

  const steps = useMemo(() => (isTechnician ? [...BASE_STEPS, NR_STEP] : BASE_STEPS), [isTechnician]);
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)];

  const onCepBlur = async () => {
    if (!form.cep) return;
    setCepError(null);
    setCepLoading(true);
    try {
      const outcome = await lookupCep(form.cep);
      switch (outcome.kind) {
        case 'invalid_format':
          setCepError('CEP em formato inválido. Use 00000-000 e preencha o endereço manualmente.');
          return;
        case 'not_found':
          setCepError('CEP não encontrado. Preencha o endereço manualmente.');
          return;
        case 'network_error':
          setCepError('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
          return;
        case 'found':
          setForm((f) => ({
            ...f,
            addressStreet: outcome.result.logradouro || f.addressStreet,
            addressComplement: outcome.result.complemento || f.addressComplement,
            addressDistrict: outcome.result.bairro || f.addressDistrict,
            addressCity: outcome.result.localidade || f.addressCity,
            addressState: outcome.result.uf || f.addressState,
          }));
      }
    } finally {
      setCepLoading(false);
    }
  };

  const onPhotoSelected = (file: File | null) => {
    if (!file) {
      setForm((f) => ({ ...f, photoFilename: undefined, photoStoragePath: undefined }));
      return;
    }
    setForm((f) => ({ ...f, photoFilename: file.name, photoStoragePath: `collaborators/photos/${Date.now()}-${file.name}` }));
  };

  /** Same requiredness as the single-page form had — the wizard only reorganizes fields into
   * steps, it doesn't add or drop any required field. */
  function validateStep(stepId: StepId): string | null {
    switch (stepId) {
      case 'basic':
        if (!form.fullName.trim()) return 'Informe o nome completo.';
        if (!isEdit && !form.rg.trim()) return 'Informe o RG.';
        if (!isEdit && !form.cpf.trim()) return 'Informe o CPF.';
        if (!form.jobTitleId) return 'Selecione o cargo.';
        if (!form.sectorId) return 'Selecione o setor.';
        return null;
      case 'contact':
        if (!form.corporateEmail.trim()) return 'Informe o email corporativo.';
        return null;
      default:
        return null;
    }
  }

  const goNext = () => {
    const message = validateStep(currentStep.id);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    const next = Math.min(stepIndex + 1, steps.length - 1);
    setStepIndex(next);
    setMaxVisited((m) => Math.max(m, next));
  };

  const goBack = () => {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const goToStep = (index: number) => {
    // Edit mode: free navigation (maxVisited was set to the full step count on load).
    // Create mode: only steps already reached are clickable, same rule as "Próximo".
    if (index <= maxVisited) {
      setError(null);
      setStepIndex(index);
    }
  };

  // Troca de CC na edição: pede a data de início da nova alocação (vigência, docs/integracao-centros-de-custo.md §2).
  const costCenterChanged = isEdit && Boolean(form.costCenterId) && (form.costCenterId ?? null) !== originalCostCenterId;
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = validateStep(currentStep.id);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    try {
      let collaboratorId = id;
      if (isEdit && id) {
        const effectiveFrom = costCenterChanged && costCenterEffectiveFrom ? { costCenterEffectiveFrom } : {};
        await collaboratorsApi.update(id, { ...form, status, ...effectiveFrom });
      } else {
        const created = await collaboratorsApi.create(form);
        collaboratorId = created.id;
      }

      if (isTechnician && collaboratorId) {
        const toCreate: CreateCertificationInput[] = NR_TYPES.filter((t) => newCerts[t].enabled && newCerts[t].issuedAt && newCerts[t].expiresAt).map(
          (t) => ({ collaboratorId: collaboratorId!, type: t, issuedAt: newCerts[t].issuedAt, expiresAt: newCerts[t].expiresAt }),
        );
        await Promise.all(toCreate.map((c) => certificationsApi.create(c)));
      }

      navigate('/collaborators');
    } catch (err: unknown) {
      setError(translateApiError(err, isEdit ? 'Erro ao salvar colaborador.' : 'Erro ao cadastrar colaborador.'));
    }
  };

  if (loading) {
    return (
      <AppLayout breadcrumb={['Axis', 'Colaboradores', 'Editar']}>
        <p>Carregando...</p>
      </AppLayout>
    );
  }

  const isLastStep = stepIndex === steps.length - 1;
  const otherCollaborators = collaborators.filter((c) => c.id !== id);

  return (
    <AppLayout breadcrumb={['Axis', 'Colaboradores', isEdit ? 'Editar' : 'Novo']}>
      {/* Stepper / progress indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {steps.map((step, i) => {
          const reachable = i <= maxVisited;
          const isCurrent = i === stepIndex;
          const isDone = i < stepIndex || (isEdit && i <= maxVisited && i !== stepIndex);
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => goToStep(i)}
              disabled={!reachable}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: 'none',
                background: 'none',
                padding: '4px 8px',
                cursor: reachable ? 'pointer' : 'default',
                opacity: reachable ? 1 : 0.4,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: isCurrent ? '#fff' : isDone ? 'var(--success)' : 'var(--text-muted)',
                  background: isCurrent ? 'var(--bg-topbar)' : isDone ? 'var(--success-soft)' : 'var(--bg-sidebar)',
                  border: isCurrent ? 'none' : '1px solid var(--border)',
                }}
              >
                {isDone && !isCurrent ? '✓' : i + 1}
              </span>
              <span style={{ fontSize: 12, color: isCurrent ? 'var(--text)' : 'var(--text-muted)', fontWeight: isCurrent ? 600 : 400 }}>
                {step.label}
              </span>
              {i < steps.length - 1 && <span style={{ width: 16, height: 1, background: 'var(--border)', marginLeft: 6 }} />}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -12, marginBottom: 16 }}>
        Etapa {stepIndex + 1} de {steps.length}
      </p>

      <form onSubmit={onSubmit} style={{ maxWidth: 760 }}>
        {currentStep.id === 'basic' && (
          <div style={sectionStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <input
                placeholder="Nome completo"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                style={{ gridColumn: '1 / -1' }}
              />
              {isEdit && matricula && (
                <div style={fieldStyle}>
                  <span style={labelStyle}>Matrícula</span>
                  <input value={matricula} disabled />
                </div>
              )}
              <div style={fieldStyle}>
                <span style={labelStyle}>RG {isEdit && '(deixe em branco para manter)'}</span>
                <MaskedInput mask={MASKS.rg} value={form.rg} onChange={(v) => setForm({ ...form, rg: v })} />
              </div>
              <div style={fieldStyle}>
                <span style={labelStyle}>CPF {isEdit && '(deixe em branco para manter)'}</span>
                <MaskedInput mask={MASKS.cpf} value={form.cpf} onChange={(v) => setForm({ ...form, cpf: v })} />
              </div>
              <div style={fieldStyle}>
                <span style={labelStyle}>CTPS</span>
                <MaskedInput mask={MASKS.ctps} value={form.ctps ?? ''} onChange={(v) => setForm({ ...form, ctps: v })} />
              </div>
              <div style={fieldStyle}>
                <span style={labelStyle}>PIS</span>
                <MaskedInput mask={MASKS.pis} value={form.pis ?? ''} onChange={(v) => setForm({ ...form, pis: v })} />
              </div>
              <select value={form.jobTitleId} onChange={(e) => setForm({ ...form, jobTitleId: e.target.value })}>
                <option value="">Selecione o cargo</option>
                {jobTitles.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
              <select value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}>
                <option value="">Selecione o setor</option>
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select value={form.supervisorId ?? ''} onChange={(e) => setForm({ ...form, supervisorId: e.target.value || undefined })}>
                <option value="">Superior direto (opcional)</option>
                {otherCollaborators.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName}
                  </option>
                ))}
              </select>
              {isEdit && (
                <select value={status} onChange={(e) => setStatus(e.target.value as CollaboratorStatus)}>
                  <option value="ativo">Ativo</option>
                  <option value="afastado">Afastado</option>
                  <option value="ferias">Férias</option>
                  <option value="desligado">Desligado</option>
                </select>
              )}
            </div>
          </div>
        )}

        {currentStep.id === 'contact' && (
          <div style={sectionStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={fieldStyle}>
                <span style={labelStyle}>Email corporativo</span>
                <input type="email" value={form.corporateEmail} onChange={(e) => setForm({ ...form, corporateEmail: e.target.value })} />
              </div>
              <div style={fieldStyle}>
                <span style={labelStyle}>Email pessoal</span>
                <input type="email" value={form.personalEmail ?? ''} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} />
              </div>
              <div style={fieldStyle}>
                <span style={labelStyle}>Telefone/celular</span>
                <MaskedInput mask={MASKS.phone} value={form.phone ?? ''} onChange={(v) => setForm({ ...form, phone: v })} />
              </div>
              <div style={fieldStyle}>
                <span style={labelStyle}>Data de nascimento</span>
                <input type="date" value={form.birthDate ?? ''} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
              </div>
              <select value={form.maritalStatus ?? ''} onChange={(e) => setForm({ ...form, maritalStatus: (e.target.value || undefined) as MaritalStatus | undefined })}>
                <option value="">Estado civil</option>
                <option value="solteiro">Solteiro(a)</option>
                <option value="casado">Casado(a)</option>
                <option value="divorciado">Divorciado(a)</option>
                <option value="viuvo">Viúvo(a)</option>
                <option value="uniao_estavel">União estável</option>
              </select>
              <select value={form.gender ?? ''} onChange={(e) => setForm({ ...form, gender: (e.target.value || undefined) as Gender | undefined })}>
                <option value="">Gênero</option>
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
                <option value="outro">Outro</option>
                <option value="prefiro_nao_informar">Prefiro não informar</option>
              </select>
              <input
                placeholder="Contato de emergência (nome)"
                value={form.emergencyContactName ?? ''}
                onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
              />
              <MaskedInput
                mask={MASKS.phone}
                value={form.emergencyContactPhone ?? ''}
                onChange={(v) => setForm({ ...form, emergencyContactPhone: v })}
                placeholder="Contato de emergência (telefone)"
              />
            </div>
          </div>
        )}

        {currentStep.id === 'address' && (
          <div style={sectionStyle}>
            <div style={fieldStyle}>
              <span style={labelStyle}>{cepLoading ? 'Buscando CEP...' : 'CEP'}</span>
              <MaskedInput mask={MASKS.cep} value={form.cep ?? ''} onChange={(v) => setForm({ ...form, cep: v })} onBlur={() => void onCepBlur()} />
            </div>
            {cepError && <p style={{ color: 'var(--warning)', fontSize: 12, margin: '6px 0 0' }}>{cepError}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
              <input placeholder="Logradouro" value={form.addressStreet ?? ''} onChange={(e) => setForm({ ...form, addressStreet: e.target.value })} />
              <input placeholder="Número" value={form.addressNumber ?? ''} onChange={(e) => setForm({ ...form, addressNumber: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <input placeholder="Complemento" value={form.addressComplement ?? ''} onChange={(e) => setForm({ ...form, addressComplement: e.target.value })} />
              <input placeholder="Bairro" value={form.addressDistrict ?? ''} onChange={(e) => setForm({ ...form, addressDistrict: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
              <input placeholder="Cidade" value={form.addressCity ?? ''} onChange={(e) => setForm({ ...form, addressCity: e.target.value })} />
              <input placeholder="UF" value={form.addressState ?? ''} onChange={(e) => setForm({ ...form, addressState: e.target.value })} maxLength={2} />
            </div>
          </div>
        )}

        {currentStep.id === 'employment' && (
          <div style={sectionStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={fieldStyle}>
                <span style={labelStyle}>Data de admissão</span>
                <input type="date" value={form.admissionDate ?? ''} onChange={(e) => setForm({ ...form, admissionDate: e.target.value })} />
              </div>
              <select value={form.contractType ?? ''} onChange={(e) => setForm({ ...form, contractType: (e.target.value || undefined) as ContractType | undefined })}>
                <option value="">Tipo de contrato</option>
                <option value="CLT">CLT</option>
                <option value="PJ">PJ</option>
                <option value="estagio">Estágio</option>
                <option value="terceirizado">Terceirizado</option>
              </select>
              <select value={form.workScheduleId ?? ''} onChange={(e) => setForm({ ...form, workScheduleId: e.target.value || undefined })}>
                <option value="">Regime de jornada</option>
                {workSchedules.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.startTime}-{w.endTime})
                  </option>
                ))}
              </select>
              <div style={fieldStyle}>
                <span style={labelStyle}>Nível de gestão</span>
                <select
                  value={form.managementLevel ?? 'colaborador'}
                  onChange={(e) => setForm({ ...form, managementLevel: e.target.value as ManagementLevel })}
                >
                  <option value="colaborador">Colaborador</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="coordenador">Coordenador</option>
                  <option value="gerente">Gerente</option>
                  <option value="diretor">Diretor</option>
                </select>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Usado só para resolver a cadeia de aprovação de requisições com custo.
                </span>
              </div>
              <select value={form.costCenterId ?? ''} onChange={(e) => setForm({ ...form, costCenterId: e.target.value || undefined })}>
                <option value="">Centro de custo (opcional)</option>
                {costCenters.map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.code}{cc.shortCode ? ` (${cc.shortCode})` : ''} — {cc.name}
                  </option>
                ))}
              </select>
              {costCenterChanged && (
                <label className="cc-field">
                  <span className="cc-field__label">No novo centro de custo a partir de</span>
                  <input type="date" value={costCenterEffectiveFrom} onChange={(e) => setCostCenterEffectiveFrom(e.target.value)} />
                  <span className="cc-field__hint">Em branco = hoje. Não pode ser antes do início no centro de custo atual.</span>
                </label>
              )}
              <div style={fieldStyle}>
                <span style={labelStyle}>Yellow Badge</span>
                <input placeholder="Identificador do crachá" value={form.yellowBadge ?? ''} onChange={(e) => setForm({ ...form, yellowBadge: e.target.value })} />
              </div>
              <div style={fieldStyle}>
                <span style={labelStyle}>Data do ASO</span>
                <input type="date" value={form.asoDate ?? ''} onChange={(e) => setForm({ ...form, asoDate: e.target.value })} />
              </div>
              <div style={fieldStyle}>
                <span style={labelStyle}>Validade do ASO</span>
                <input type="date" value={form.asoValidity ?? ''} onChange={(e) => setForm({ ...form, asoValidity: e.target.value })} />
              </div>
            </div>
            {isEdit && (
              <section className="allocation-history" aria-label="Histórico de centros de custo">
                <h5 className="allocation-history__title">Histórico de centros de custo</h5>
                {historyError && <p role="alert" className="cc-error">{historyError}</p>}
                {!historyError && allocationHistory.length === 0 && <p className="allocation-history__empty">Nenhuma alocação registrada.</p>}
                {allocationHistory.length > 0 && (
                  <div className="allocation-history__scroll">
                    <table>
                      <thead>
                        <tr><th>Centro de custo</th><th>De</th><th>Até</th></tr>
                      </thead>
                      <tbody>
                        {allocationHistory.map((row) => (
                          <tr key={row.id}>
                            <td>{row.costCenterCode}{row.costCenterShortCode ? ` (${row.costCenterShortCode})` : ''} — {row.costCenterName}</td>
                            <td>{formatDateOnly(row.validFrom)}</td>
                            <td>{row.validTo ? `antes de ${formatDateOnly(row.validTo)}` : 'vigente'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {currentStep.id === 'documents' && (
          <div style={sectionStyle}>
            <div style={fieldStyle}>
              <span style={labelStyle}>Foto</span>
              <input type="file" accept="image/*" onChange={(e) => onPhotoSelected(e.target.files?.[0] ?? null)} />
              {form.photoFilename && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{form.photoFilename}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
              <input placeholder="Tam. uniforme/EPP" value={form.uniformSize ?? ''} onChange={(e) => setForm({ ...form, uniformSize: e.target.value })} />
              <select value={form.cnhCategory ?? ''} onChange={(e) => setForm({ ...form, cnhCategory: e.target.value || undefined })}>
                <option value="">CNH (categoria)</option>
                {['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'].map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <div style={fieldStyle}>
                <span style={labelStyle}>CNH (número)</span>
                <MaskedInput mask={MASKS.cnhNumber} value={form.cnhNumber ?? ''} onChange={(v) => setForm({ ...form, cnhNumber: v })} />
              </div>
            </div>
            <div style={{ ...fieldStyle, marginTop: 12, maxWidth: 220 }}>
              <span style={labelStyle}>CNH válida até</span>
              <input type="date" value={form.cnhExpiresAt ?? ''} onChange={(e) => setForm({ ...form, cnhExpiresAt: e.target.value })} />
            </div>
          </div>
        )}

        {currentStep.id === 'certifications' && (
          <div style={sectionStyle}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              O cargo selecionado exige certificações NR — preencha as que já estiverem emitidas.
            </p>
            {existingCerts.length > 0 && (
              <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13 }}>
                {existingCerts.map((c) => (
                  <li key={c.id}>
                    {c.type} — válida até {new Date(c.expiresAt).toLocaleDateString('pt-BR')}
                  </li>
                ))}
              </ul>
            )}
            {NR_TYPES.map((t) => (
              <div key={t} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={newCerts[t].enabled}
                    onChange={(e) => setNewCerts((c) => ({ ...c, [t]: { ...c[t], enabled: e.target.checked } }))}
                  />
                  {t}
                </label>
                <div style={fieldStyle}>
                  <span style={labelStyle}>Emitida em</span>
                  <input
                    type="date"
                    disabled={!newCerts[t].enabled}
                    value={newCerts[t].issuedAt}
                    onChange={(e) => setNewCerts((c) => ({ ...c, [t]: { ...c[t], issuedAt: e.target.value } }))}
                  />
                </div>
                <div style={fieldStyle}>
                  <span style={labelStyle}>Válida até</span>
                  <input
                    type="date"
                    disabled={!newCerts[t].enabled}
                    value={newCerts[t].expiresAt}
                    onChange={(e) => setNewCerts((c) => ({ ...c, [t]: { ...c[t], expiresAt: e.target.value } }))}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {stepIndex > 0 && (
            <Button type="button" variant="secondary" onClick={goBack}>
              Voltar
            </Button>
          )}
          {!isLastStep ? (
            <Button type="button" variant="primary" onClick={goNext}>
              Próximo
            </Button>
          ) : (
            <Button type="submit" variant="positive">
              {isEdit ? 'Salvar alterações' : 'Cadastrar'}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => navigate('/collaborators')}>
            Cancelar
          </Button>
        </div>
      </form>
    </AppLayout>
  );
}

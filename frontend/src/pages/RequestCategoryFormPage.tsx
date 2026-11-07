import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { RequestCategoryDraftEditor, type DraftContent } from '../components/RequestCategoryDraftEditor';
import {
  requestCategoriesApi,
  type AdminCategoryDetail,
  type CategoryVersionDetail,
  type RequestCategoryKind,
  type RequestConfidentiality,
} from '../api/requestCategories';
import { sectorsApi, type Sector } from '../api/sectors';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { useAuth } from '../context/AuthContext';
import { extractApiMessages } from '../utils/apiError';
import { formatDateTime } from '../utils/formatDate';
import {
  KIND_LABELS,
  approvalFromWorkflow,
  emptyApproval,
  fieldDraftFromSchema,
  fieldDraftToSchema,
  hoursToMinutes,
  minutesToHours,
  workflowFromApproval,
} from '../utils/requestCatalog';

interface CategoryData {
  code: string;
  name: string;
  sectorId: string;
  kind: RequestCategoryKind;
  confidentiality: RequestConfidentiality;
  requiresAcceptance: boolean;
  useDynamicAuthority: boolean;
  active: boolean;
}

const emptyData: CategoryData = {
  code: '',
  name: '',
  sectorId: '',
  kind: 'padrao',
  confidentiality: 'interna',
  requiresAcceptance: false,
  useDynamicAuthority: false,
  active: true,
};

const emptyContent: DraftContent = { fields: [], approval: { ...emptyApproval }, firstResponseHours: '4', resolutionHours: '48' };

function contentFromVersion(v: CategoryVersionDetail): DraftContent {
  return {
    fields: (v.formSchema ?? []).map(fieldDraftFromSchema),
    approval: approvalFromWorkflow(v.workflowSchema ?? []),
    firstResponseHours: String(minutesToHours(v.slaFirstResponseMinutes)).replace('.', ','),
    resolutionHours: String(minutesToHours(v.slaResolutionMinutes)).replace('.', ','),
  };
}

/** Conteúdo da tela -> corpo da API; devolve erros locais se o SLA estiver inválido. */
function contentToPayload(content: DraftContent, kind: RequestCategoryKind) {
  const errors: string[] = [];
  const first = hoursToMinutes(content.firstResponseHours);
  const resolution = hoursToMinutes(content.resolutionHours);
  if (first === null) errors.push('SLA: informe a primeira resposta em horas (passos de 0,25 h).');
  if (resolution === null) errors.push('SLA: informe a solução em horas (passos de 0,25 h).');
  if (errors.length > 0 || first === null || resolution === null) return { errors };
  return {
    errors,
    payload: {
      formSchema: content.fields.map(fieldDraftToSchema),
      workflowSchema: kind === 'compra_material' ? [] : workflowFromApproval(content.approval),
      slaFirstResponseMinutes: first,
      slaResolutionMinutes: resolution,
    },
  };
}

type Pending = 'none' | 'discard' | 'publish';

export function RequestCategoryFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const [data, setData] = useState<CategoryData>(emptyData);
  const [content, setContent] = useState<DraftContent>(emptyContent);
  const [detail, setDetail] = useState<AdminCategoryDetail | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>('none');

  const draft = detail?.versions.find((v) => v.status === 'rascunho') ?? null;
  const published = detail?.versions.find((v) => v.status === 'publicada') ?? null;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await requestCategoriesApi.getAdmin(id);
      setDetail(d);
      setData({
        code: d.code,
        name: d.name,
        sectorId: d.sectorId,
        kind: d.kind,
        confidentiality: d.confidentiality,
        requiresAcceptance: d.requiresAcceptance,
        useDynamicAuthority: d.useDynamicAuthority,
        active: d.active,
      });
      const current = d.versions.find((v) => v.status === 'rascunho');
      setContent(current ? contentFromVersion(current) : emptyContent);
      setError(null);
    } catch (err) {
      setError(extractApiMessages(err, 'Não foi possível carregar a categoria.')[0]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    sectorsApi
      .list()
      .then(setSectors)
      .catch(() => setError('Não foi possível carregar os setores.'));
    collaboratorsApi
      .list()
      .then(setCollaborators)
      .catch(() => setNotice('Não foi possível carregar a lista de colaboradores; a seleção de aprovadores ficará limitada.'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeKind = (kind: RequestCategoryKind) =>
    setData((d) => ({
      ...d,
      kind,
      confidentiality: kind === 'denuncia' ? 'restrita' : d.confidentiality,
      useDynamicAuthority: kind === 'compra_material' ? false : d.useDynamicAuthority,
    }));

  /** Salva a categoria (edição) ou cria categoria + versão 1 em rascunho (novo). */
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setDraftErrors([]);
    try {
      if (isEdit && id) {
        await requestCategoriesApi.update(id, {
          name: data.name,
          sectorId: data.sectorId,
          confidentiality: data.confidentiality,
          requiresAcceptance: data.requiresAcceptance,
          useDynamicAuthority: data.useDynamicAuthority,
          active: data.active,
        });
        setNotice('Dados da categoria salvos.');
        await load();
      } else {
        const result = contentToPayload(content, data.kind);
        if (!result.payload) {
          setDraftErrors(result.errors);
          return;
        }
        const created = await requestCategoriesApi.create({
          code: data.code,
          name: data.name,
          sectorId: data.sectorId,
          kind: data.kind,
          confidentiality: data.confidentiality,
          requiresAcceptance: data.requiresAcceptance,
          useDynamicAuthority: data.useDynamicAuthority,
          ...result.payload,
        });
        navigate(`/request-categories/${created.id}`);
      }
    } catch (err) {
      const messages = extractApiMessages(err, 'Erro ao salvar a categoria.');
      // Erros de formulário/fluxo/SLA vêm com prefixo técnico e pertencem ao editor.
      const draftRelated = messages.filter((m) => /^(formSchema|workflowSchema|sla|SLA)/.test(m));
      setDraftErrors(draftRelated);
      const rest = messages.filter((m) => !draftRelated.includes(m));
      setError(rest.length > 0 ? rest.join(' ') : null);
    }
  };

  const run = async (action: () => Promise<unknown>, fallback: string, success: string) => {
    if (!id) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    setDraftErrors([]);
    try {
      await action();
      await load();
      setNotice(success);
      return true;
    } catch (err) {
      setDraftErrors(extractApiMessages(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!id) return false;
    const result = contentToPayload(content, data.kind);
    if (!result.payload) {
      setDraftErrors(result.errors);
      return false;
    }
    const payload = result.payload;
    return run(() => requestCategoriesApi.updateDraft(id, payload), 'Erro ao salvar o rascunho.', 'Rascunho salvo.');
  };

  const createDraft = () => id && run(() => requestCategoriesApi.createDraft(id), 'Erro ao criar o rascunho.', 'Rascunho criado a partir da versão publicada.');

  const confirmDiscard = async () => {
    if (!id) return;
    await run(() => requestCategoriesApi.discardDraft(id), 'Erro ao descartar o rascunho.', 'Rascunho descartado.');
    setPending('none');
  };

  const confirmPublish = async () => {
    if (!id) return;
    // O servidor publica o que está salvo: grava a tela antes.
    if (await saveDraft()) {
      await run(() => requestCategoriesApi.publishDraft(id), 'Erro ao publicar a versão.', 'Versão publicada. Novas requisições já usam esta versão.');
    }
    setPending('none');
  };

  const versionColumns: ColumnDef<CategoryVersionDetail>[] = [
    { key: 'version', header: 'Versão', render: (v) => `v${v.version}` },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge label={v.status === 'publicada' ? 'Publicada' : 'Rascunho'} tone={v.status === 'publicada' ? 'success' : 'warning'} /> },
    { key: 'publishedAt', header: 'Publicada em', render: (v) => formatDateTime(v.publishedAt) },
    { key: 'by', header: 'Por', render: (v) => (v.status === 'publicada' ? (v.publishedByName ?? '—') : (v.createdByName ?? '—')) },
  ];

  const canPublish = hasPermission('request_category:publish');
  const editorVisible = !isEdit || draft !== null;

  return (
    <FormPage
      breadcrumb={['Axis', 'Requisições', 'Catálogo de requisições', isEdit ? data.name || 'Categoria' : 'Nova']}
      onSubmit={onSubmit}
      onCancel={() => navigate('/request-categories')}
      error={error}
      loading={loading}
      submitLabel={isEdit ? 'Salvar dados da categoria' : 'Criar categoria'}
      maxWidth={960}
    >
      <FormSection title="Dados da categoria">
        <div className="axis-catalog-grid">
          <label className="axis-catalog-field">
            <span>Código {isEdit && '(não pode ser alterado)'}</span>
            <input value={data.code} maxLength={40} disabled={isEdit} required onChange={(e) => setData({ ...data, code: e.target.value.toUpperCase() })} placeholder="EX.: TI-ACESSO" />
          </label>
          <label className="axis-catalog-field">
            <span>Nome</span>
            <input value={data.name} maxLength={120} required onChange={(e) => setData({ ...data, name: e.target.value })} />
          </label>
          <label className="axis-catalog-field">
            <span>Setor</span>
            <select value={data.sectorId} required onChange={(e) => setData({ ...data, sectorId: e.target.value })}>
              <option value="">Selecione o setor</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="axis-catalog-field">
            <span>Tipo {isEdit && '(não pode ser alterado)'}</span>
            <select value={data.kind} disabled={isEdit} onChange={(e) => changeKind(e.target.value as RequestCategoryKind)}>
              {(Object.keys(KIND_LABELS) as RequestCategoryKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="axis-catalog-field">
            <span>Confidencialidade</span>
            <select value={data.confidentiality} disabled={data.kind === 'denuncia'} onChange={(e) => setData({ ...data, confidentiality: e.target.value as RequestConfidentiality })}>
              <option value="interna">Interna</option>
              <option value="confidencial">Confidencial</option>
              <option value="restrita">Restrita</option>
            </select>
          </label>
        </div>
        <div className="axis-catalog-actions">
          <label className="axis-catalog-check">
            <input type="checkbox" checked={data.requiresAcceptance} onChange={(e) => setData({ ...data, requiresAcceptance: e.target.checked })} />
            Exige aceite do solicitante antes de encerrar
          </label>
          {isEdit && (
            <label className="axis-catalog-check">
              <input type="checkbox" checked={data.active} onChange={(e) => setData({ ...data, active: e.target.checked })} />
              Categoria ativa (desativar tira do catálogo; requisições abertas continuam)
            </label>
          )}
        </div>
        {data.kind === 'denuncia' && <p className="axis-catalog-hint">Denúncias são sempre restritas.</p>}
        {isEdit && <p className="axis-catalog-hint">Mudar o setor afeta só as requisições novas.</p>}
      </FormSection>

      {isEdit && (
        <FormSection title="Versão">
          <p>
            {published ? `Versão vigente: v${published.version}.` : 'Nenhuma versão publicada ainda: a categoria não aparece na abertura de requisições.'}{' '}
            {draft ? `Rascunho em edição: v${draft.version}.` : 'Não há rascunho.'}
          </p>
          <p className="axis-catalog-hint">Só versões publicadas são usadas por novas requisições. As requisições existentes seguem na versão em que foram abertas.</p>
          {!draft && (
            <div className="axis-catalog-actions">
              <Button type="button" variant="info" disabled={busy} onClick={() => void createDraft()}>
                Criar rascunho
              </Button>
            </div>
          )}
        </FormSection>
      )}

      {notice && <p className="axis-catalog-notice">{notice}</p>}

      {editorVisible && (
        <>
          {!isEdit && <p className="axis-catalog-hint">A versão 1 será criada como rascunho. Publique depois de criar a categoria.</p>}
          <RequestCategoryDraftEditor
            value={content}
            onChange={setContent}
            kind={data.kind}
            useDynamicAuthority={data.useDynamicAuthority}
            onDynamicAuthorityChange={(value) => setData({ ...data, useDynamicAuthority: value })}
            collaborators={collaborators}
            errors={draftErrors}
            disabled={busy}
          />
          {draftErrors.length > 0 && !draftErrors.every((m) => /^(formSchema|workflowSchema|sla|SLA)/.test(m)) && (
            <ul className="axis-catalog-errors">
              {draftErrors
                .filter((m) => !/^(formSchema|workflowSchema|sla|SLA)/.test(m))
                .map((m) => (
                  <li key={m}>{m}</li>
                ))}
            </ul>
          )}
          {isEdit && draft && (
            <div className="axis-catalog-actions">
              <Button type="button" variant="positive" disabled={busy} onClick={() => void saveDraft()}>
                Salvar rascunho
              </Button>
              {canPublish && (
                <Button type="button" variant="info" disabled={busy} onClick={() => setPending('publish')}>
                  Publicar
                </Button>
              )}
              <Button type="button" variant="danger" disabled={busy} onClick={() => setPending('discard')}>
                Descartar rascunho
              </Button>
            </div>
          )}
        </>
      )}

      {isEdit && detail && (
        <FormSection title="Histórico de versões">
          <DataTable columns={versionColumns} rows={detail.versions} rowKey={(v) => v.id} emptyMessage="Nenhuma versão." />
        </FormSection>
      )}

      <ConfirmDialog
        open={pending === 'discard'}
        title="Descartar rascunho"
        message={`O rascunho v${draft?.version ?? ''} será apagado. A versão publicada não é afetada. Esta ação não pode ser desfeita.`}
        confirmLabel="Descartar"
        tone="danger"
        busy={busy}
        onConfirm={() => void confirmDiscard()}
        onCancel={() => setPending('none')}
      />
      <ConfirmDialog
        open={pending === 'publish'}
        title="Publicar versão"
        message={`Publicar a v${draft?.version ?? ''}? Novas requisições passarão a usar esta versão. Uma versão publicada não pode ser editada depois.`}
        confirmLabel="Publicar"
        busy={busy}
        onConfirm={() => void confirmPublish()}
        onCancel={() => setPending('none')}
      />
    </FormPage>
  );
}

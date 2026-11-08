import { useState, type FormEvent } from 'react';
import { createBudget, getProject, listProjects, newRevision, PROJECT_STATUS, REVISION_STATUS, syncProjects, updateBudget, type BudgetHeader, type CoreProject, type DateSource } from '../lib/budgets';
import { formatPercent } from '../lib/decimal';
import { formatBRL, formatDate, formatDateTime } from '../lib/format';
import { navigate } from '../lib/router';
import { Badge, ErrorAlert, Field, messageOf, PageHeader, useLoad } from '../components/ui';

/** "01/12/2026 a 15/01/2027"; uma das pontas vazia vira "—". */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return '—';
  return `${formatDate(start)} a ${formatDate(end)}`;
}

const SOURCE_LABEL: Record<Exclude<DateSource, null>, string> = { core: 'do Axis Core', orcamento: 'do orçamento' };

/** Código e nome do projeto do Core; projeto antigo sem nome mostra o aviso. */
function ProjectName({ project }: { project: Pick<CoreProject, 'name'> }) {
  return project.name ? <span>{project.name}</span> : <span className="muted">Sem nome no Axis Core</span>;
}

export function ProjectsPage({ canWrite, canSeeCost }: { canWrite: boolean; canSeeCost: boolean }) {
  const { data, error, loading, reload } = useLoad(listProjects, [], 'Não foi possível carregar os projetos.');
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function sync() {
    setSyncing(true);
    setNotice(null);
    try {
      const r = await syncProjects();
      setNotice({ tone: 'success', text: `Atualizado do Axis Core: ${r.projects} projetos e ${r.clients} clientes.` });
      reload();
    } catch (e) {
      setNotice({ tone: 'danger', text: messageOf(e, 'Não foi possível atualizar do Axis Core.') });
    } finally {
      setSyncing(false);
    }
  }

  const q = search.trim().toLowerCase();
  const rows = (data?.projects ?? []).filter((p) => !q || [p.code, p.name, p.client?.name, p.budget?.displayTitle].some((v) => v?.toLowerCase().includes(q)));

  return (
    <>
      <PageHeader
        title="Projetos"
        actions={
          <button className="btn btn-ghost" type="button" onClick={sync} disabled={syncing}>
            {syncing ? 'Atualizando…' : 'Atualizar do Axis Core'}
          </button>
        }
      >
        <p className="muted">Projetos do Axis Core com o orçamento de cada um. {data?.lastSyncedAt ? `Última atualização: ${formatDateTime(data.lastSyncedAt)}.` : ''}</p>
      </PageHeader>
      {notice && (
        <p className={`alert alert-${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
      <div className="toolbar">
        <input type="search" placeholder="Buscar por código, nome ou cliente" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar projeto" />
      </div>
      {error && <ErrorAlert message={error} onRetry={reload} />}
      {loading && !data && <p className="muted">Carregando…</p>}
      {data && (
        <div className="card table-card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Cliente</th>
                <th>Situação no Core</th>
                <th>Prazo previsto</th>
                <th>Orçamento</th>
                <th className="num">Valor da proposta</th>
                {canSeeCost && <th className="num">Lucro sobre o custo</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={canSeeCost ? 7 : 6} className="muted empty">
                    {data.projects.length === 0 ? 'Nenhum projeto no Financeiro ainda. Clique em "Atualizar do Axis Core".' : 'Nenhum projeto encontrado.'}
                  </td>
                </tr>
              )}
              {rows.map((p) => {
                const rev = p.budget?.revision;
                return (
                  <tr key={p.axisProjectId} className="row-link" onClick={() => navigate(`/projetos/${encodeURIComponent(p.axisProjectId)}`)}>
                    <td>
                      <a href={`#/projetos/${encodeURIComponent(p.axisProjectId)}`}>{p.code}</a>
                      <div className="cell-sub">
                        <ProjectName project={p} />
                      </div>
                      {p.warnings.map((w) => (
                        <div key={w} className="cell-sub">
                          <Badge tone="warning">{w}</Badge>
                        </div>
                      ))}
                    </td>
                    <td>{p.client?.name ?? '—'}</td>
                    <td>{p.status ? (PROJECT_STATUS[p.status] ?? p.status) : '—'}</td>
                    <td className="nowrap">{formatPeriod(p.plannedStartDate, p.plannedEndDate)}</td>
                    <td>{rev ? <Badge tone={REVISION_STATUS[rev.status].tone}>{`R${rev.number} · ${REVISION_STATUS[rev.status].label}`}</Badge> : <span className="muted">{canWrite ? 'sem orçamento' : '—'}</span>}</td>
                    <td className="num">{rev ? formatBRL(rev.revenue) : '—'}</td>
                    {canSeeCost && <td className="num">{rev?.profitOnCost ? formatPercent(rev.profitOnCost) : '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted table-count">
            {rows.length} de {data.projects.length} projetos
          </p>
        </div>
      )}
    </>
  );
}

export function ProjectPage({ id, canWrite, canSeeCost }: { id: string; canWrite: boolean; canSeeCost: boolean }) {
  const { data, error, loading, reload } = useLoad(() => getProject(id), [id], 'Não foi possível carregar o projeto.');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ revisionId: string }>) {
    setBusy(true);
    setActionError(null);
    try {
      const { revisionId } = await fn();
      navigate(`/revisoes/${revisionId}`);
    } catch (e) {
      setActionError(messageOf(e, 'Não foi possível concluir a ação.'));
      setBusy(false);
    }
  }

  if (error) return <ErrorAlert message={error} onRetry={reload} />;
  if (loading || !data) return <p className="muted">Carregando…</p>;
  const budget = data.budgets[0];
  // Nova revisão só sem rascunho, sem revisão em aprovação e antes de ganhar (a ganha é a linha de base).
  const hasDraft = budget?.revisions.some((r) => r.status === 'rascunho' || r.status === 'em_aprovacao' || r.status === 'ganha');

  return (
    <>
      <PageHeader
        title={data.name ? `${data.code} — ${data.name}` : data.code}
        back={{ href: '/projetos', label: 'Projetos' }}
        actions={
          canWrite &&
          (budget ? (
            !hasDraft && (
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run(() => newRevision(budget.id))}>
                Nova revisão
              </button>
            )
          ) : (
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run(() => createBudget(data.axisProjectId))}>
              {busy ? 'Criando…' : 'Criar orçamento'}
            </button>
          ))
        }
      >
        <p className="muted">
          {data.client?.name ?? 'Cliente não sincronizado'} · {data.status ? (PROJECT_STATUS[data.status] ?? data.status) : 'situação desconhecida'} no Axis Core
          {data.costCenter && ` · centro de custo ${[data.costCenter.code, data.costCenter.name].filter(Boolean).join(' — ')}`}
        </p>
        <p className="muted">
          Prazo previsto no Axis Core: {formatPeriod(data.plannedStartDate, data.plannedEndDate)}
          {!data.name && ' · Projeto sem nome no Axis Core: edite-o lá para o nome aparecer aqui.'}
        </p>
      </PageHeader>
      {actionError && <ErrorAlert message={actionError} />}
      {data.warnings.map((w) => (
        <p key={w} className="alert alert-warning" role="status">
          {w}
        </p>
      ))}
      {!budget && <p className="card muted">Este projeto ainda não tem orçamento.{canWrite ? ' Clique em "Criar orçamento" para montar a primeira revisão com os parâmetros vigentes.' : ''}</p>}
      {budget && (
        <section className="card table-card">
          <BudgetHeaderCard budgetId={budget.id} header={budget} project={data} canWrite={canWrite} onSaved={reload} />
          <table className="table">
            <thead>
              <tr>
                <th>Revisão</th>
                <th>Situação</th>
                <th>Parâmetros</th>
                <th className="num">Valor da proposta</th>
                {canSeeCost && <th className="num">Lucro real</th>}
                {canSeeCost && <th className="num">Lucro sobre o custo</th>}
                <th>Última alteração</th>
              </tr>
            </thead>
            <tbody>
              {budget.revisions.map((r) => (
                <tr key={r.id} className="row-link" onClick={() => navigate(`/revisoes/${r.id}`)}>
                  <td>
                    <a href={`#/revisoes/${r.id}`}>R{r.number}</a>
                  </td>
                  <td>
                    <Badge tone={REVISION_STATUS[r.status].tone}>{REVISION_STATUS[r.status].label}</Badge>
                    {r.approvedByEmail && <div className="cell-sub">envio aprovado por {r.approvedByEmail}</div>}
                  </td>
                  <td>{r.parameterSetCode}</td>
                  <td className="num">{formatBRL(r.revenue)}</td>
                  {canSeeCost && <td className="num">{formatBRL(r.profit)}</td>}
                  {canSeeCost && <td className="num">{r.profitOnCost ? formatPercent(r.profitOnCost) : '—'}</td>}
                  <td>{formatDateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

/**
 * Cabeçalho do orçamento (P-07). Título vazio = nome do projeto no Axis Core; datas vazias = prazo previsto do
 * projeto no Core. Preencher aqui sobrescreve só no orçamento (o Core não muda).
 */
export function BudgetHeaderCard({ budgetId, header, project, canWrite, onSaved }: { budgetId: string; header: BudgetHeader; project: CoreProject; canWrite: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setTitle(header.title ?? '');
    setStart(header.plannedStartDate ?? '');
    setEnd(header.plannedEndDate ?? '');
    setError(null);
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (title.trim() && title.trim().length < 3) return setError('Título: 3 a 160 caracteres, ou deixe vazio para usar o nome do Axis Core.');
    setBusy(true);
    setError(null);
    try {
      await updateBudget(budgetId, { title: title.trim() || null, plannedStartDate: start || null, plannedEndDate: end || null });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(messageOf(err, 'Não foi possível salvar o cabeçalho.'));
    } finally {
      setBusy(false);
    }
  }

  const sourceNote = (source: DateSource) => (source ? <small className="muted"> ({SOURCE_LABEL[source]})</small> : null);
  const { start: s, end: en } = header.schedule;

  if (editing) {
    return (
      <form className="card-pad" onSubmit={save} noValidate>
        <h2>Cabeçalho do orçamento</h2>
        <div className="grid-3">
          <Field label="Título" hint={project.name ? `Vazio = nome do Axis Core: ${project.name}` : 'Vazio = código e cliente (o projeto ainda não tem nome no Axis Core)'}>
            <input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={project.name ?? ''} />
          </Field>
          <Field label="Início previsto" hint={`Vazio = do Axis Core: ${formatDate(project.plannedStartDate)}`}>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Conclusão prevista" hint={`Vazio = do Axis Core: ${formatDate(project.plannedEndDate)}`}>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorAlert message={error} />}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar cabeçalho'}
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setEditing(false)}>
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="card-pad budget-header">
      <div>
        <h2>{header.displayTitle}</h2>
        <p className="muted">
          {!header.title && project.name ? 'Título: nome do projeto no Axis Core. ' : ''}
          Início previsto: {formatDate(s.value)}
          {sourceNote(s.source)} · Conclusão prevista: {formatDate(en.value)}
          {sourceNote(en.source)}
        </p>
      </div>
      {canWrite && (
        <button className="btn btn-ghost" type="button" onClick={open}>
          Editar cabeçalho
        </button>
      )}
    </div>
  );
}

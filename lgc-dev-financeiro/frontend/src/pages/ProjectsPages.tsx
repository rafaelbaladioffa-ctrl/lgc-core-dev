import { useState } from 'react';
import { createBudget, getProject, listProjects, newRevision, PROJECT_STATUS, REVISION_STATUS, syncProjects } from '../lib/budgets';
import { formatPercent } from '../lib/decimal';
import { formatBRL, formatDateTime } from '../lib/format';
import { navigate } from '../lib/router';
import { Badge, ErrorAlert, messageOf, PageHeader, useLoad } from '../components/ui';

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
  const rows = (data?.projects ?? []).filter((p) => !q || [p.code, p.client?.name, p.budget?.title].some((v) => v?.toLowerCase().includes(q)));

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
        <input type="search" placeholder="Buscar por código, cliente ou título" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar projeto" />
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
                <th>Orçamento</th>
                <th className="num">Valor da proposta</th>
                {canSeeCost && <th className="num">Lucro sobre o custo</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted empty">
                    {data.projects.length === 0 ? 'Nenhum projeto no Financeiro ainda. Clique em "Atualizar do Axis Core".' : 'Nenhum projeto encontrado.'}
                  </td>
                </tr>
              )}
              {rows.map((p) => {
                const rev = p.budget?.revision;
                return (
                  <tr key={p.axisProjectId} className="row-link" onClick={() => navigate(`/projetos/${encodeURIComponent(p.axisProjectId)}`)}>
                    <td>
                      <a href={`#/projetos/${encodeURIComponent(p.axisProjectId)}`}>{p.code ?? p.axisProjectId}</a>
                    </td>
                    <td>{p.client?.name ?? '—'}</td>
                    <td>{p.status ? (PROJECT_STATUS[p.status] ?? p.status) : '—'}</td>
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
  const hasDraft = budget?.revisions.some((r) => r.status === 'rascunho');

  return (
    <>
      <PageHeader
        title={data.code}
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
        </p>
      </PageHeader>
      {actionError && <ErrorAlert message={actionError} />}
      {!budget && <p className="card muted">Este projeto ainda não tem orçamento.{canWrite ? ' Clique em "Criar orçamento" para montar a primeira revisão com os parâmetros vigentes.' : ''}</p>}
      {budget && (
        <section className="card table-card">
          <div className="card-pad">
            <h2>{budget.title}</h2>
          </div>
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

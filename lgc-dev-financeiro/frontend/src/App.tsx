import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, bindSession, getMe, type Me } from './lib/api';
import { LoginError, loadSession, loginWithAxis, saveSession, validateLogin, type Session } from './lib/auth';
import { matchRoute, useHashPath } from './lib/router';
import { ParameterSetsPage } from './pages/ParameterSetsPage';
import { ParameterSetPage } from './pages/ParameterSetPage';
import { DestinationFormPage, DestinationsPage, MaterialFormPage, MaterialsPage } from './pages/CatalogPages';
import { ProjectPage, ProjectsPage } from './pages/ProjectsPages';
import { RevisionPage } from './pages/RevisionPage';
import { QuoteRequestsPage } from './pages/QuoteRequestsPage';
import { CostCenterBudgetPage, CostCenterPage, CostCentersPage } from './pages/CostCentersPages';
import { TeamPage, TeamsPage } from './pages/TeamsPages';
import { ControllershipPage } from './pages/ControllershipPage';
import { periodFromPath } from './lib/costCenters';

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  const update = useCallback((s: Session | null) => {
    saveSession(s);
    setSession(s);
  }, []);

  // Precisa valer antes da primeira chamada à API dos filhos (efeitos dos filhos rodam antes dos do pai).
  bindSession(session, setSession);

  return session ? <Home session={session} onLogout={() => update(null)} /> : <Login onLogin={update} />;
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateLogin(email, password);
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      onLogin(await loginWithAxis(email, password));
    } catch (err) {
      setErrors({ form: err instanceof LoginError ? err.message : 'Não foi possível entrar agora.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit} noValidate>
        <h1>Axis Financeiro</h1>
        <p className="muted">Entre com o mesmo e-mail e senha do Axis.</p>
        <label className="field">
          <span>E-mail</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
          {errors.email && <small className="field-error">{errors.email}</small>}
        </label>
        <label className="field">
          <span>Senha</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
          {errors.password && <small className="field-error">{errors.password}</small>}
        </label>
        {errors.form && (
          <p className="alert alert-danger" role="alert">
            {errors.form}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

const NEXT_STEPS = [
  { title: 'Fluxo da proposta', detail: 'Enviar para aprovação, aprovar o envio, marcar ganha ou perdida.' },
  { title: 'Proposta do cliente AWS', detail: 'Leitura da SOW, horas-meta, indicadores e valores do Bid Template.' },
  { title: 'Realizado', detail: 'Apontamento da obra e custos lançados; cotado × realizado.' },
];

/** Item de menu visível com qualquer uma das permissões. */
const NAV: Array<{ path: string; label: string; permission: string | string[] }> = [
  { path: '/projetos', label: 'Projetos', permission: 'budget:read' },
  { path: '/cotacoes', label: 'Pedidos de cotação', permission: 'budget:read' },
  { path: '/parametros', label: 'Parâmetros', permission: 'budget_params:read' },
  { path: '/materiais', label: 'Materiais', permission: 'budget_params:read' },
  { path: '/destinos', label: 'Destinos', permission: 'budget_params:read' },
  { path: '/centros-de-custo', label: 'Centros de custo', permission: ['cost_center:read', 'cost_center:read_own'] },
  { path: '/equipes', label: 'Equipes', permission: ['cost_center:read', 'cost_center:read_own'] },
  { path: '/controladoria', label: 'Controladoria', permission: 'cost_center:write' },
];

function Home({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = useHashPath();
  const route = path.split('?')[0];

  const load = useCallback(() => {
    setError(null);
    getMe()
      .then(setMe)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Não foi possível carregar seus dados.'));
  }, []);

  useEffect(load, [load]);

  const can = (p: string) => me?.permissions.includes(p) ?? false;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          Axis Financeiro
        </a>
        <nav className="topnav" aria-label="Principal">
          {NAV.filter((n) => (Array.isArray(n.permission) ? n.permission.some(can) : can(n.permission))).map((n) => (
            <a key={n.path} href={`#${n.path}`} aria-current={route === n.path || route.startsWith(`${n.path}/`) ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <span className="topbar-user">
          {session.email}
          <button className="btn btn-ghost" type="button" onClick={onLogout}>
            Sair
          </button>
        </span>
      </header>
      <main className="content">
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}{' '}
            <button className="btn btn-ghost" type="button" onClick={load}>
              Tentar de novo
            </button>
          </div>
        )}
        {!me && !error && <p className="muted">Carregando…</p>}
        {me && <Routes path={path} me={me} can={can} />}
      </main>
    </div>
  );
}

function NoAccess() {
  return (
    <div className="card">
      <h1>Sem acesso</h1>
      <p className="muted">Seu perfil no Financeiro não permite abrir esta página. Peça o acesso ao administrador.</p>
      <a href="#/">Voltar ao início</a>
    </div>
  );
}

function Routes({ path, me, can }: { path: string; me: Me; can: (p: string) => boolean }) {
  const read = can('budget_params:read');
  const write = can('budget_params:write');
  const cost = can('budget:read_cost');
  const budgetRead = can('budget:read');
  const budgetWrite = can('budget:write');
  let m: Record<string, string> | null;

  if (matchRoute('/projetos', path)) return budgetRead ? <ProjectsPage canWrite={budgetWrite} canSeeCost={cost} /> : <NoAccess />;
  if ((m = matchRoute('/projetos/:id', path))) return budgetRead ? <ProjectPage key={m.id} id={m.id} canWrite={budgetWrite} canSeeCost={cost} /> : <NoAccess />;
  if ((m = matchRoute('/revisoes/:id', path))) return budgetRead ? <RevisionPage key={m.id} id={m.id} canWrite={budgetWrite} /> : <NoAccess />;
  if (matchRoute('/cotacoes', path)) return budgetRead ? <QuoteRequestsPage canWrite={budgetWrite} /> : <NoAccess />;

  if (matchRoute('/parametros', path)) return read ? <ParameterSetsPage canWrite={write} /> : <NoAccess />;
  if ((m = matchRoute('/parametros/:id', path))) return read ? <ParameterSetPage key={m.id} id={m.id} canWrite={write} /> : <NoAccess />;
  if (matchRoute('/materiais', path)) return read ? <MaterialsPage canWrite={write} canSeeCost={cost} /> : <NoAccess />;
  if (matchRoute('/materiais/novo', path)) return write ? <MaterialFormPage id={null} canSeeCost={cost} /> : <NoAccess />;
  if ((m = matchRoute('/materiais/:id', path))) return write ? <MaterialFormPage key={m.id} id={m.id} canSeeCost={cost} /> : <NoAccess />;
  if (matchRoute('/destinos', path)) return read ? <DestinationsPage canWrite={write} /> : <NoAccess />;
  if (matchRoute('/destinos/novo', path)) return write ? <DestinationFormPage id={null} /> : <NoAccess />;
  if ((m = matchRoute('/destinos/:id', path))) return write ? <DestinationFormPage key={m.id} id={m.id} /> : <NoAccess />;

  // Centros de custo: leitura com read ou read_own (o servidor filtra o que cada um vê); escrita com write.
  const ccRead = can('cost_center:read') || can('cost_center:read_own');
  const ccWrite = can('cost_center:write');
  const period = periodFromPath(path);
  if (matchRoute('/centros-de-custo', path)) return ccRead ? <CostCentersPage period={period} /> : <NoAccess />;
  if ((m = matchRoute('/centros-de-custo/:id', path))) return ccRead ? <CostCenterPage key={m.id} id={m.id} period={period} canWrite={ccWrite} /> : <NoAccess />;
  if ((m = matchRoute('/centros-de-custo/:id/orcamento/:ano', path))) {
    const year = Number(m.ano);
    if (!ccRead) return <NoAccess />;
    return /^\d{4}$/.test(m.ano) ? <CostCenterBudgetPage key={`${m.id}-${year}`} id={m.id} year={year} canWrite={ccWrite} /> : <Start me={me} />;
  }
  if (matchRoute('/equipes', path)) return ccRead ? <TeamsPage period={period} /> : <NoAccess />;
  if ((m = matchRoute('/equipes/:id', path))) return ccRead ? <TeamPage key={m.id} id={m.id} period={period} canLog={can('team_log:write')} /> : <NoAccess />;
  if (matchRoute('/controladoria', path)) return ccWrite ? <ControllershipPage /> : <NoAccess />;
  return <Start me={me} />;
}

function Start({ me }: { me: Me }) {
  return (
    <>
      <h1>Início</h1>
      <section className="card">
        <h2>Seu acesso</h2>
        {me.financeRoles.length === 0 ? (
          <p className="muted">Você ainda não tem perfil no Financeiro. Peça ao administrador para conceder o acesso.</p>
        ) : (
          <ul className="tags">
            {me.financeRoles.map((r) => (
              <li key={r.code} className="tag">
                {r.name}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>Projetos — próximas entregas</h2>
        <ul className="steps">
          {NEXT_STEPS.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <span className="muted">{s.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

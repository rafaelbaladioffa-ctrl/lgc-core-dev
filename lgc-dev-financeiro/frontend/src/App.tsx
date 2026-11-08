import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, bindSession, getMe, type Me } from './lib/api';
import { LoginError, loadSession, loginWithAxis, saveSession, validateLogin, type Session } from './lib/auth';
import { matchRoute, useHashPath } from './lib/router';
import { useTheme, type Theme } from './lib/theme';
import { PageHeader } from './components/ui';
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
  const { theme, toggleTheme } = useTheme();

  const update = useCallback((s: Session | null) => {
    saveSession(s);
    setSession(s);
  }, []);

  // Precisa valer antes da primeira chamada à API dos filhos (efeitos dos filhos rodam antes dos do pai).
  bindSession(session, setSession);

  return session ? <Home session={session} onLogout={() => update(null)} theme={theme} onToggleTheme={toggleTheme} /> : <Login onLogin={update} />;
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
    <div className="axis-login">
      {/* Painel de marca: some em telas estreitas, onde o formulário basta. */}
      <div className="axis-login__panel">
        <img src="/brand-industrial/axis-app-icon.svg" alt="" width={52} height={52} className="axis-login__icon" />
        <h1>
          Orçamentos mais precisos.
          <br />
          Resultado mais claro.
        </h1>
        <p className="axis-login__lead">O Axis Financeiro reúne propostas, centros de custo e equipes técnicas para você acompanhar o resultado de cada projeto.</p>
      </div>

      <div className="axis-login__side">
        <div className="axis-login__card">
          <img src="/brand-industrial/axis-logo-light.svg" alt="Axis ERP + SGI" className="axis-login__logo axis-login__logo--light" />
          <img src="/brand-industrial/axis-logo-dark.svg" alt="Axis ERP + SGI" className="axis-login__logo axis-login__logo--dark" />

          <form className="axis-login__form" onSubmit={submit} noValidate>
            <p className="muted">Entre com o mesmo e-mail e senha do Axis.</p>
            <div className="axis-field">
              <label htmlFor="login-email">E-mail</label>
              <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
              {errors.email && <small className="field-error">{errors.email}</small>}
            </div>
            <div className="axis-field">
              <label htmlFor="login-password">Senha</label>
              <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
              {errors.password && <small className="field-error">{errors.password}</small>}
            </div>
            {errors.form && (
              <p className="axis-login__error" role="alert">
                {errors.form}
              </p>
            )}
            <button className="axis-btn axis-btn--primary axis-login__submit" type="submit" disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const NEXT_STEPS = [
  { title: 'Fluxo da proposta', detail: 'Enviar para aprovação, aprovar o envio, marcar ganha ou perdida.' },
  { title: 'Proposta do cliente AWS', detail: 'Leitura da SOW, horas-meta, indicadores e valores do Bid Template.' },
  { title: 'Realizado', detail: 'Apontamento da obra e custos lançados; cotado × realizado.' },
];

/** Item de menu visível com qualquer uma das permissões; `icon` segue os glifos do menu do Core. */
const NAV: Array<{ path: string; label: string; icon: string; permission: string | string[] }> = [
  { path: '/projetos', label: 'Projetos', icon: '⚑', permission: 'budget:read' },
  { path: '/cotacoes', label: 'Pedidos de cotação', icon: '☰', permission: 'budget:read' },
  { path: '/parametros', label: 'Parâmetros', icon: '⚙', permission: 'budget_params:read' },
  { path: '/materiais', label: 'Materiais', icon: '▣', permission: 'budget_params:read' },
  { path: '/destinos', label: 'Destinos', icon: '◎', permission: 'budget_params:read' },
  { path: '/centros-de-custo', label: 'Centros de custo', icon: '⧈', permission: ['cost_center:read', 'cost_center:read_own'] },
  { path: '/equipes', label: 'Equipes', icon: '☆', permission: ['cost_center:read', 'cost_center:read_own'] },
  { path: '/controladoria', label: 'Controladoria', icon: '✔', permission: 'cost_center:write' },
];

const under = (route: string, base: string) => route === base || route.startsWith(`${base}/`);

/** Migalhas "Financeiro / seção / página" derivadas da rota. */
export function breadcrumbOf(route: string): string[] {
  const seg = route.split('/').filter(Boolean);
  const root = 'Financeiro';
  if (seg.length === 0) return [root, 'Início'];
  const [section, second, third, fourth] = seg;
  switch (section) {
    case 'projetos':
      return second ? [root, 'Projetos', 'Projeto'] : [root, 'Projetos'];
    case 'revisoes':
      return [root, 'Projetos', 'Revisão'];
    case 'cotacoes':
      return [root, 'Pedidos de cotação'];
    case 'parametros':
      return second ? [root, 'Parâmetros', 'Conjunto'] : [root, 'Parâmetros'];
    case 'materiais':
      return second ? [root, 'Materiais', second === 'novo' ? 'Novo' : 'Editar'] : [root, 'Materiais'];
    case 'destinos':
      return second ? [root, 'Destinos', second === 'novo' ? 'Novo' : 'Editar'] : [root, 'Destinos'];
    case 'centros-de-custo':
      if (second && third === 'orcamento' && fourth) return [root, 'Centros de custo', `Orçamento ${fourth}`];
      return second ? [root, 'Centros de custo', 'Detalhe'] : [root, 'Centros de custo'];
    case 'equipes':
      return second ? [root, 'Equipes', 'Painel'] : [root, 'Equipes'];
    case 'controladoria':
      return [root, 'Controladoria'];
    default:
      return [root, 'Início'];
  }
}

const initials = (email?: string) => (email ? email.split('@')[0].slice(0, 2).toUpperCase() : '?');

function Home({ session, onLogout, theme, onToggleTheme }: { session: Session; onLogout: () => void; theme: Theme; onToggleTheme: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const items = NAV.filter((n) => (Array.isArray(n.permission) ? n.permission.some(can) : can(n.permission)));
  const isActive = (base: string) => under(route, base) || (base === '/projetos' && under(route, '/revisoes'));
  const crumbs = breadcrumbOf(route);

  return (
    <div className="axis-app-shell">
      <header className="axis-app-topbar">
        <a className="axis-app-topbar-brand" href="#/">
          <img src="/brand-industrial/axis-logo-dark.svg" alt="Axis ERP + SGI" />
        </a>
        <span className="axis-product-tag">Financeiro</span>
        <button
          className="axis-mobile-nav-toggle"
          type="button"
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-controls="axis-app-sidebar"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? '×' : '☰'}
        </button>
        <div className="axis-app-topbar-search" />
        <div className="axis-app-topbar-actions">
          <button className="axis-topbar-button" type="button" onClick={onToggleTheme} title="Alternar tema" aria-label="Alternar tema">
            {theme === 'light' ? '☾' : '☀'}
          </button>
          <div className="axis-app-user">
            <span className="axis-app-avatar">{initials(session.email)}</span>
            <div>
              <strong>{session.email}</strong>
              <small>{me?.financeRoles.map((r) => r.name).join(', ')}</small>
            </div>
          </div>
          <button className="axis-topbar-button" type="button" onClick={onLogout}>
            Sair
          </button>
        </div>
      </header>
      <div className="axis-app-body">
        <aside id="axis-app-sidebar" className={`axis-app-sidebar${menuOpen ? ' axis-app-sidebar-open' : ''}`}>
          <nav aria-label="Principal">
            <a href="#/" aria-current={route === '/' ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
              <span aria-hidden className="axis-nav-icon">
                ▦
              </span>
              Início
            </a>
            {items.map((n) => (
              <a key={n.path} href={`#${n.path}`} aria-current={isActive(n.path) ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
                <span aria-hidden className="axis-nav-icon">
                  {n.icon}
                </span>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="axis-sidebar-footer">
            <img src="/brand-industrial/axis-symbol.svg" alt="" />
            <span>Axis Financeiro</span>
          </div>
        </aside>
        <div className="axis-app-content">
          <nav className="axis-breadcrumb" aria-label="breadcrumb">
            {crumbs.map((crumb, i) => (
              <Fragment key={`${crumb}-${i}`}>
                {i > 0 && <span>/</span>}
                <strong>{crumb}</strong>
              </Fragment>
            ))}
          </nav>
          <main className="axis-app-main">
            {error && (
              <div className="axis-alert axis-alert--danger" role="alert">
                {error}{' '}
                <button className="axis-btn axis-btn--secondary axis-btn--sm" type="button" onClick={load}>
                  Tentar de novo
                </button>
              </div>
            )}
            {!me && !error && <p className="muted">Carregando…</p>}
            {me && <Routes path={path} me={me} can={can} />}
          </main>
        </div>
      </div>
    </div>
  );
}

function NoAccess() {
  return (
    <>
      <PageHeader title="Sem acesso" />
      <div className="card">
        <p className="muted">Seu perfil no Financeiro não permite abrir esta página. Peça o acesso ao administrador.</p>
        <a href="#/">Voltar ao início</a>
      </div>
    </>
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
  if ((m = matchRoute('/projetos/:id', path))) return budgetRead ? <ProjectPage key={m.id} id={m.id} canWrite={budgetWrite} canSeeCost={cost} canApprove={can('budget:approve')} /> : <NoAccess />;
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
      <PageHeader title="Início" />
      <section className="card">
        <h2>Seu acesso</h2>
        {me.financeRoles.length === 0 ? (
          <p className="muted">Você ainda não tem perfil no Financeiro. Peça ao administrador para conceder o acesso.</p>
        ) : (
          <ul className="tags">
            {me.financeRoles.map((r) => (
              <li key={r.code} className="axis-badge axis-badge--neutral">
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

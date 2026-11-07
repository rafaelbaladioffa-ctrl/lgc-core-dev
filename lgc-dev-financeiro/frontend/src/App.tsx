import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, bindSession, getMe, type Me } from './lib/api';
import { LoginError, loadSession, loginWithAxis, saveSession, validateLogin, type Session } from './lib/auth';

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
  { title: 'Fornecedores e dados bancários', detail: 'Cadastro com confirmação dupla da conta bancária.' },
  { title: 'Títulos a pagar', detail: 'Documento fiscal, parcelas, rateio por centro de custo e aprovação.' },
  { title: 'Programação e baixa', detail: 'Agenda de pagamentos, baixa e estorno.' },
];

function Home({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getMe()
      .then(setMe)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Não foi possível carregar seus dados.'));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="shell">
      <header className="topbar">
        <strong>Axis Financeiro</strong>
        <span className="topbar-user">
          {session.email}
          <button className="btn btn-ghost" type="button" onClick={onLogout}>
            Sair
          </button>
        </span>
      </header>
      <main className="content">
        <h1>Início</h1>
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}{' '}
            <button className="btn btn-ghost" type="button" onClick={load}>
              Tentar de novo
            </button>
          </div>
        )}
        {!me && !error && <p className="muted">Carregando…</p>}
        {me && (
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
        )}
        <section className="card">
          <h2>Em construção</h2>
          <ul className="steps">
            {NEXT_STEPS.map((s) => (
              <li key={s.title}>
                <strong>{s.title}</strong>
                <span className="muted">{s.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

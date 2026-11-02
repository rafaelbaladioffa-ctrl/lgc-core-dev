import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch {
      setError('Email ou senha inválidos.');
    }
  };

  return (
    <div style={{ minHeight: '100svh', display: 'flex' }}>
      {/* Left panel: brand gradient + headline — hidden on narrow viewports, the form alone is
          enough there. */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: 'var(--surface-dark)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '48px 56px',
        }}
        className="axis-login-panel"
      >
        <img src="/brand-industrial/axis-app-icon.svg" alt="" width={52} height={52} style={{ marginBottom: 32 }} />
        <h1 style={{ color: '#fff', fontSize: 34, lineHeight: 1.2, maxWidth: 440 }}>
          Sistemas mais inteligentes.
          <br />
          Decisões mais claras.
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, maxWidth: 420, marginTop: 16 }}>
          O sistema core corporativo que reúne colaboradores, projetos, chamados e integrações num
          só lugar.
        </p>
      </div>

      {/* Right panel: login card */}
      <div style={{ width: 440, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 320 }}>
          <img src="/brand-industrial/axis-logo-light.svg" alt="Axis ERP + SGI" className="axis-wordmark-light-theme" style={{ height: 52, marginBottom: 32 }} />
          <img src="/brand-industrial/axis-logo-dark.svg" alt="Axis ERP + SGI" className="axis-wordmark-dark-theme" style={{ height: 52, marginBottom: 32 }} />

          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Senha</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%' }} />
            </div>
            {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                height: 40,
                background: 'var(--primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius)',
                fontWeight: 700,
                marginTop: 8,
              }}
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ou</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* Visual placeholders only — no SSO is actually implemented, so these are disabled. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" disabled title="SSO ainda não disponível" style={{ height: 36, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-muted)' }}>
              Continuar com Microsoft
            </button>
            <button type="button" disabled title="SSO ainda não disponível" style={{ height: 36, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-muted)' }}>
              Continuar com Google
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .axis-login-panel { display: none; }
        }
        .axis-wordmark-dark-theme { display: none; }
        [data-theme='dark'] .axis-wordmark-light-theme { display: none; }
        [data-theme='dark'] .axis-wordmark-dark-theme { display: block; }
      `}</style>
    </div>
  );
}

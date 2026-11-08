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
    <div className="axis-login">
      {/* Painel esquerdo: marca e chamada — some em telas estreitas, onde o formulário basta. */}
      <div className="axis-login__panel">
        <img src="/brand-industrial/axis-app-icon.svg" alt="" width={52} height={52} className="axis-login__icon" />
        <h1>
          Sistemas mais inteligentes.
          <br />
          Decisões mais claras.
        </h1>
        <p className="axis-login__lead">
          O sistema core corporativo que reúne colaboradores, projetos, chamados e integrações num
          só lugar.
        </p>
      </div>

      {/* Painel direito: cartão de login */}
      <div className="axis-login__side">
        <div className="axis-login__card">
          <img src="/brand-industrial/axis-logo-light.svg" alt="Axis ERP + SGI" className="axis-login__logo axis-login__logo--light" />
          <img src="/brand-industrial/axis-logo-dark.svg" alt="Axis ERP + SGI" className="axis-login__logo axis-login__logo--dark" />

          <form onSubmit={onSubmit} className="axis-login__form">
            <div className="axis-field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="axis-field">
              <label>Senha</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="axis-login__error">{error}</p>}
            <button type="submit" disabled={loading} className="axis-btn axis-btn--primary axis-login__submit">
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div className="axis-login__divider">ou</div>

          {/* Apenas visual — SSO não está implementado, então os botões ficam desabilitados. */}
          <div className="axis-login__sso-list">
            <button type="button" disabled title="SSO ainda não disponível" className="axis-login__sso">
              Continuar com Microsoft
            </button>
            <button type="button" disabled title="SSO ainda não disponível" className="axis-login__sso">
              Continuar com Google
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

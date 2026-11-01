import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { translateApiError } from '../utils/apiError';

/**
 * Forced on login when users.must_change_password is true (PLANNING.md 4.7) — the admin/RH set a
 * temporary password at creation or reset. No navigation away from this screen is offered; the
 * rest of the app only becomes reachable once the password is changed and the new token drops the
 * flag (PrivateRoute redirects back here otherwise).
 */
export function ChangePasswordPage() {
  const { changePassword } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('A nova senha precisa ter ao menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigate('/dashboard');
    } catch (err) {
      setError(translateApiError(err, 'Erro ao trocar a senha.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 360, padding: 24 }}>
        <h1 style={{ fontSize: 20, marginBottom: 6 }}>Troque sua senha</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          Sua senha foi definida por um administrador. Defina uma nova senha para continuar.
        </p>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Senha atual</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Nova senha</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Confirmar nova senha</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              height: 40,
              background: 'var(--brand-gradient)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontWeight: 700,
              marginTop: 8,
            }}
          >
            {loading ? 'Salvando...' : 'Trocar senha'}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { usersApi, type LoginUser } from '../api/users';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';

export function UsersPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<LoginUser[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; temporaryPassword: string } | null>(null);

  const refresh = () => usersApi.list().then(setUsers);

  useEffect(() => {
    void refresh();
  }, []);

  const toggleStatus = async (user: LoginUser) => {
    setActionError(null);
    try {
      await usersApi.setStatus(user.id, user.status === 'active' ? 'disabled' : 'active');
      await refresh();
    } catch {
      setActionError('Erro ao alterar status do usuário.');
    }
  };

  const resetPassword = async (user: LoginUser) => {
    setActionError(null);
    try {
      const result = await usersApi.resetPassword(user.id);
      setResetResult({ email: user.email, temporaryPassword: result.temporaryPassword });
      await refresh();
    } catch {
      setActionError('Erro ao redefinir senha.');
    }
  };

  const columns: ColumnDef<LoginUser>[] = [
    {
      key: 'collaboratorName',
      header: 'Colaborador',
      render: (u) => `${u.collaboratorName ?? '—'}${u.collaboratorMatricula ? ` (${u.collaboratorMatricula})` : ''}`,
      filterable: true,
      filterValue: (u) => u.collaboratorName ?? '',
    },
    {
      key: 'email',
      header: 'E-mail',
      render: (u) => u.email,
      filterable: true,
      filterValue: (u) => u.email,
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (u) => u.roles.map((r) => r.name).join(', '),
      filterable: true,
      filterValue: (u) => u.roles.map((r) => r.name).join(', '),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => <StatusBadge label={u.status === 'active' ? 'Ativo' : 'Desativado'} tone={u.status === 'active' ? 'success' : 'default'} />,
      filterable: true,
      filterValue: (u) => (u.status === 'active' ? 'Ativo' : 'Desativado'),
    },
    {
      key: 'mustChangePassword',
      header: 'Troca de senha pendente',
      render: (u) => <StatusBadge label={u.mustChangePassword ? 'Sim' : 'Não'} tone={u.mustChangePassword ? 'warning' : 'default'} />,
    },
    {
      key: 'actions',
      header: 'Ações',
      render: (u) =>
        hasPermission('user:update') || hasPermission('user:reset_password') ? (
          <div style={{ display: 'flex', gap: 6 }}>
            {hasPermission('user:update') && (
              <button
                onClick={() => navigate(`/users/${u.id}/edit`)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
              >
                Editar
              </button>
            )}
            {hasPermission('user:update') && (
              <button
                onClick={() => void toggleStatus(u)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
              >
                {u.status === 'active' ? 'Desativar' : 'Ativar'}
              </button>
            )}
            {hasPermission('user:reset_password') && (
              <button
                onClick={() => void resetPassword(u)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
              >
                Redefinir senha
              </button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Usuários']}>
      <KpiRow>
        <KpiCard label="Usuários" value={users.length} />
        <KpiCard label="Ativos" value={users.filter((u) => u.status === 'active').length} tone="success" />
        <KpiCard label="Troca de senha pendente" value={users.filter((u) => u.mustChangePassword).length} tone="warning" />
      </KpiRow>

      {actionError && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{actionError}</p>}

      {resetResult && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 12,
            marginBottom: 10,
            fontSize: 13,
          }}
        >
          Senha temporária gerada para <strong>{resetResult.email}</strong>:{' '}
          <code style={{ fontSize: 14 }}>{resetResult.temporaryPassword}</code> — copie e entregue ao colaborador agora; ela não
          aparecerá de novo.{' '}
          <button
            onClick={() => setResetResult(null)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
          >
            Fechar
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={users}
        rowKey={(u) => u.id}
        toolbar={
          hasPermission('user:create') && (
            <Button variant="positive" onClick={() => navigate('/users/new')}>
              + Novo usuário
            </Button>
          )
        }
      />
    </AppLayout>
  );
}

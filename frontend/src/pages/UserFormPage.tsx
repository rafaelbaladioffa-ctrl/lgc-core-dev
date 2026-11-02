import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { usersApi, rolesApi, type Role, type CreatedUser } from '../api/users';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { translateApiError } from '../utils/apiError';

const ROLE_LABELS: Record<string, string> = {
  analista_suprimentos: 'Analista de Suprimentos',
};

export function UserFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [roles, setRoles] = useState<Role[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [collaboratorSearch, setCollaboratorSearch] = useState('');
  const [collaboratorId, setCollaboratorId] = useState('');
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedUser | null>(null);

  useEffect(() => {
    void Promise.all([rolesApi.list(), collaboratorsApi.list()]).then(([r, c]) => {
      setRoles(r);
      setCollaborators(c);
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    void usersApi.get(id).then((u) => {
      setRoleIds(u.roles.map((r) => r.id));
    });
  }, [id]);

  const selectedCollaborator = collaborators.find((c) => c.id === collaboratorId);
  const filteredCollaborators = useMemo(() => {
    const term = collaboratorSearch.trim().toLowerCase();
    if (!term) return collaborators.slice(0, 20);
    return collaborators.filter((c) => c.fullName.toLowerCase().includes(term) || c.matricula.includes(term)).slice(0, 20);
  }, [collaborators, collaboratorSearch]);

  useEffect(() => {
    if (selectedCollaborator && !email) setEmail(selectedCollaborator.corporateEmail);
  }, [selectedCollaborator, email]);

  const toggleRole = (roleId: string) => {
    setRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit && id) {
        await usersApi.updateRoles(id, roleIds);
        navigate('/users');
        return;
      }
      if (!collaboratorId) {
        setError('Selecione um colaborador.');
        return;
      }
      if (roleIds.length === 0) {
        setError('Selecione ao menos uma role.');
        return;
      }
      const result = await usersApi.create({
        collaboratorId,
        email: email || undefined,
        temporaryPassword: temporaryPassword || undefined,
        roleIds,
      });
      setCreated(result);
    } catch (err) {
      setError(translateApiError(err, isEdit ? 'Erro ao salvar usuário.' : 'Erro ao criar usuário.'));
    }
  };

  if (created) {
    return (
      <FormPage breadcrumb={['Axis', 'Usuários', 'Novo']} onSubmit={(e) => e.preventDefault()} onCancel={() => navigate('/users')} maxWidth={520} submitLabel="Ok">
        <FormSection title="Usuário criado">
          <p style={{ fontSize: 13 }}>
            Usuário <strong>{created.email}</strong> criado para <strong>{created.collaboratorName}</strong>.
          </p>
          <p style={{ fontSize: 13 }}>
            Senha temporária (copie e entregue ao colaborador agora — <strong>não aparecerá de novo</strong>):
          </p>
          <code style={{ fontSize: 16, display: 'block', padding: 8, background: 'var(--bg-elevated)', borderRadius: 'var(--radius)' }}>
            {created.temporaryPassword}
          </code>
        </FormSection>
      </FormPage>
    );
  }

  return (
    <FormPage
      breadcrumb={['Axis', 'Usuários', isEdit ? 'Editar' : 'Novo']}
      onSubmit={onSubmit}
      onCancel={() => navigate('/users')}
      error={error}
      submitLabel={isEdit ? 'Salvar roles' : 'Criar usuário'}
      maxWidth={520}
    >
      {!isEdit && (
        <FormSection title="Colaborador">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              placeholder="Buscar por nome ou matrícula..."
              value={collaboratorSearch}
              onChange={(e) => setCollaboratorSearch(e.target.value)}
            />
            <select value={collaboratorId} onChange={(e) => setCollaboratorId(e.target.value)} required>
              <option value="">Selecione o colaborador</option>
              {filteredCollaborators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName} ({c.matricula})
                </option>
              ))}
            </select>
          </div>
        </FormSection>
      )}

      {!isEdit && (
        <FormSection title="Credenciais">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input type="email" placeholder="E-mail de login" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input
              type="text"
              placeholder="Senha temporária (deixe vazio para gerar automaticamente)"
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
            />
          </div>
        </FormSection>
      )}

      <FormSection title="Roles">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {roles.map((role) => (
            <label key={role.id} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => toggleRole(role.id)} />
              {ROLE_LABELS[role.name] ?? role.name}
              {role.description && <span style={{ color: 'var(--text-muted)' }}> — {role.description}</span>}
            </label>
          ))}
        </div>
      </FormSection>
    </FormPage>
  );
}

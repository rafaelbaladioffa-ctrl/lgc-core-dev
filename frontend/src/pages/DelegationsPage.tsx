import { useEffect, useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/DataTable';
import { delegationsApi, type Delegation } from '../api/delegations';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { sectorsApi, type Sector } from '../api/sectors';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../utils/formatDate';
import { translateApiError } from '../utils/apiError';

/** "Delegações" (REQUISICOES_SPEC.md §9.1/§21.2) — início/fim/escopo explícitos, nunca
 * retroativa; quem recebe pode decidir aprovações em nome de quem delegou enquanto a janela
 * estiver ativa (RequestsService.approve/reject já checa isso). */
export function DelegationsPage() {
  const { user } = useAuth();
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [delegateId, setDelegateId] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => delegationsApi.mine().then(setDelegations);

  useEffect(() => {
    void refresh();
    void collaboratorsApi.list().then(setCollaborators);
    void sectorsApi.list().then(setSectors);
  }, []);

  const collaboratorName = (id: string) => collaborators.find((c) => c.id === id)?.fullName ?? '—';
  const sectorName = (id: string | null) => (id ? sectors.find((s) => s.id === id)?.name ?? '—' : 'Todos os setores');

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await delegationsApi.create({ delegateId, sectorId: sectorId || undefined, startsAt, endsAt });
      setDelegateId('');
      setSectorId('');
      setStartsAt('');
      setEndsAt('');
      await refresh();
    } catch (err) {
      setError(translateApiError(err, 'Erro ao criar delegação.'));
    }
  };

  const revoke = async (id: string) => {
    await delegationsApi.revoke(id);
    await refresh();
  };

  return (
    <AppLayout breadcrumb={['Axis', 'Delegações']}>
      <h2 style={{ marginBottom: 4 }}>Delegação de aprovação</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        Delegue sua alçada de aprovação de requisições a outro colaborador por um período definido.
      </p>

      <form onSubmit={create} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
        <select value={delegateId} onChange={(e) => setDelegateId(e.target.value)} required>
          <option value="">Delegar para...</option>
          {collaborators
            .filter((c) => c.id !== user?.collaboratorId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
        </select>
        <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
          <option value="">Todos os setores</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
        <Button type="submit" variant="positive">
          Criar delegação
        </Button>
      </form>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {delegations.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma delegação.</p>}
        {delegations.map((d) => {
          const isMine = d.delegatorId === user?.collaboratorId;
          const active = !d.revokedAt && new Date(d.startsAt) <= new Date() && new Date() <= new Date(d.endsAt);
          return (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 13 }}>
              <div>
                <div>
                  {isMine ? `Para ${collaboratorName(d.delegateId)}` : `De ${collaboratorName(d.delegatorId)}`} · {sectorName(d.sectorId)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {formatDateTime(d.startsAt)} — {formatDateTime(d.endsAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusBadge label={d.revokedAt ? 'Revogada' : active ? 'Ativa' : 'Fora da janela'} tone={d.revokedAt ? 'danger' : active ? 'success' : 'default'} />
                {isMine && !d.revokedAt && (
                  <Button variant="danger" onClick={() => void revoke(d.id)}>
                    Revogar
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AppLayout>
  );
}

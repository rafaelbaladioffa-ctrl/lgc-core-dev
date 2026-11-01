import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { HierarchyTree, buildTree } from '../components/HierarchyTree';
import { sectorsApi, type Sector } from '../api/sectors';
import { useAuth } from '../context/AuthContext';
import { runBulkDelete } from '../utils/bulkDelete';
import { Button } from '../components/Button';

export function SectorsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refresh = () => sectorsApi.list().then(setSectors);

  useEffect(() => {
    void refresh();
  }, []);

  const tree = buildTree(sectors, (s) => s.id, (s) => s.parentSectorId);

  return (
    <AppLayout breadcrumb={['Axis', 'Setores']}>
      <KpiRow>
        <KpiCard label="Setores cadastrados" value={sectors.length} />
        <KpiCard label="Raiz" value={sectors.filter((s) => !s.parentSectorId).length} />
      </KpiRow>

      {bulkError && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{bulkError}</p>}

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        {hasPermission('sector:create') && (
          <Button variant="positive" onClick={() => navigate('/sectors/new')}>
            + Novo setor
          </Button>
        )}
      </div>

      <HierarchyTree
        roots={tree}
        emptyMessage="Nenhum setor cadastrado."
        renderItem={(s) => (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.code}</code>{' '}
              <button
                onClick={() => navigate(`/sectors/${s.id}/edit`)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
              >
                {s.name}
              </button>
            </div>
            {hasPermission('sector:delete') && (
              <button
                onClick={async () => {
                  setBulkError(await runBulkDelete([s], (r) => sectorsApi.remove(r.id), refresh));
                }}
                style={{ fontSize: 12, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--danger-soft)', color: 'var(--danger)' }}
              >
                Excluir
              </button>
            )}
          </div>
        )}
      />
    </AppLayout>
  );
}

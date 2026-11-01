import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { HierarchyTree, buildTree } from '../components/HierarchyTree';
import { costCentersApi, type CostCenter } from '../api/costCenters';
import { sectorsApi, type Sector } from '../api/sectors';
import { useAuth } from '../context/AuthContext';
import { runBulkDelete } from '../utils/bulkDelete';
import { Button } from '../components/Button';

export function CostCentersPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([costCentersApi.list(), sectorsApi.list()]).then(([cc, secs]) => {
      setCostCenters(cc);
      setSectors(secs);
    });

  useEffect(() => {
    void refresh();
  }, []);

  const sectorName = (id: string) => sectors.find((s) => s.id === id)?.name ?? '—';
  const tree = buildTree(costCenters, (c) => c.id, (c) => c.parentCostCenterId);

  return (
    <AppLayout breadcrumb={['Axis', 'Centros de Custo']}>
      <KpiRow>
        <KpiCard label="Centros de custo" value={costCenters.length} />
        <KpiCard label="Raiz" value={costCenters.filter((c) => !c.parentCostCenterId).length} />
      </KpiRow>

      {bulkError && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{bulkError}</p>}

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        {hasPermission('cost_center:create') && (
          <Button variant="positive" onClick={() => navigate('/cost-centers/new')}>
            + Novo centro de custo
          </Button>
        )}
      </div>

      <HierarchyTree
        roots={tree}
        emptyMessage="Nenhum centro de custo cadastrado."
        renderItem={(c) => (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.code}</code>{' '}
              <button
                onClick={() => navigate(`/cost-centers/${c.id}/edit`)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
              >
                {c.name}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>({sectorName(c.sectorId)})</span>
            </div>
            {hasPermission('cost_center:delete') && (
              <button
                onClick={async () => {
                  setBulkError(await runBulkDelete([c], (r) => costCentersApi.remove(r.id), refresh));
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

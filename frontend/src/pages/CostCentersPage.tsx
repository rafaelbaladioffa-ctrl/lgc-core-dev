import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { HierarchyTree, buildTree } from '../components/HierarchyTree';
import { CostCenterBudgetBadge } from '../components/CostCenterBudgetBadge';
import { costCentersApi, COST_CENTER_KIND_LABELS, type CostCenter } from '../api/costCenters';
import { sectorsApi, type Sector } from '../api/sectors';
import { useAuth } from '../context/AuthContext';
import { runBulkDelete } from '../utils/bulkDelete';
import { translateApiError } from '../utils/apiError';
import { Button } from '../components/Button';
import '../styles/cost-centers.css';

export function CostCentersPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([costCentersApi.list(), sectorsApi.list()])
      .then(([cc, secs]) => {
        setCostCenters(cc);
        setSectors(secs);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(translateApiError(err, 'Não foi possível carregar os centros de custo.')));

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
        <KpiCard label="Orçamento estourado" value={costCenters.filter((c) => c.budgetStatus === 'estourado').length} />
      </KpiRow>

      {loadError && <p role="alert" className="cc-error">{loadError}</p>}
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
          <div className="cc-tree-item">
            <div className="cc-tree-item__main">
              <code className="cc-code">{c.code}</code>
              {c.shortCode && <span className="cc-short-code">{c.shortCode}</span>}
              <button type="button" className="cc-link" onClick={() => navigate(`/cost-centers/${c.id}/edit`)}>
                {c.name}
              </button>
              <span className="cc-meta">
                {COST_CENTER_KIND_LABELS[c.kind] ?? c.kind} · {sectorName(c.sectorId)}
              </span>
              <CostCenterBudgetBadge costCenter={c} />
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

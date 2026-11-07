import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { Button } from '../components/Button';
import { requestCategoriesApi, type AdminCategoryRow } from '../api/requestCategories';
import { useAuth } from '../context/AuthContext';
import { extractApiMessages } from '../utils/apiError';
import { KIND_LABELS } from '../utils/requestCatalog';

export function RequestCategoriesPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectorId, setSectorId] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);

  useEffect(() => {
    requestCategoriesApi
      .listAdmin()
      .then(setRows)
      .catch((err) => setError(extractApiMessages(err, 'Não foi possível carregar o catálogo de requisições.')[0]))
      .finally(() => setLoading(false));
  }, []);

  const sectors = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => map.set(r.sector.id, r.sector.name));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [rows]);

  const filtered = rows.filter((r) => (!sectorId || r.sectorId === sectorId) && (!onlyActive || r.active));

  const columns: ColumnDef<AdminCategoryRow>[] = [
    { key: 'code', header: 'Código', filterable: true, render: (r) => <code>{r.code}</code>, filterValue: (r) => r.code },
    {
      key: 'name',
      header: 'Nome',
      filterable: true,
      filterValue: (r) => r.name,
      render: (r) => (
        <button type="button" className="axis-catalog-link" onClick={() => navigate(`/request-categories/${r.id}`)}>
          {r.name}
        </button>
      ),
    },
    { key: 'sector', header: 'Setor', render: (r) => r.sector.name },
    { key: 'kind', header: 'Tipo', render: (r) => KIND_LABELS[r.kind] },
    { key: 'version', header: 'Versão vigente', render: (r) => (r.publishedVersion ? `v${r.publishedVersion}` : 'Nenhuma publicada') },
    { key: 'draft', header: 'Rascunho pendente', render: (r) => (r.hasDraft ? <StatusBadge label="Rascunho pendente" tone="warning" /> : '—') },
    { key: 'active', header: 'Ativa', render: (r) => <StatusBadge label={r.active ? 'Ativa' : 'Inativa'} tone={r.active ? 'success' : 'default'} /> },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Requisições', 'Catálogo de requisições']}>
      {error && <p className="axis-catalog-error">{error}</p>}
      <div className="axis-catalog-toolbar">
        <label className="axis-catalog-field">
          <span>Setor</span>
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            <option value="">Todos os setores</option>
            {sectors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="axis-catalog-check">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          Somente ativas
        </label>
        <div className="axis-catalog-spacer" />
        {hasPermission('request_category:create') && (
          <Button variant="positive" onClick={() => navigate('/request-categories/new')}>
            + Nova categoria
          </Button>
        )}
      </div>
      {loading ? (
        <p>Carregando...</p>
      ) : (
        <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} emptyMessage="Nenhuma categoria encontrada." />
      )}
    </AppLayout>
  );
}

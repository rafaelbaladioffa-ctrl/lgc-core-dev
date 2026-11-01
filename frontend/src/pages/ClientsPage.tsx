import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { clientsApi, type Client } from '../api/clients';
import { useAuth } from '../context/AuthContext';
import { runBulkDelete } from '../utils/bulkDelete';
import { Button } from '../components/Button';

export function ClientsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refresh = () => clientsApi.list().then(setClients);

  useEffect(() => {
    void refresh();
  }, []);

  const columns: ColumnDef<Client>[] = [
    { key: 'code', header: 'Código', render: (c) => c.code, filterable: true, width: '90px', filterValue: (c) => String(c.code) },
    {
      key: 'legalName',
      header: 'Razão social',
      render: (c) => (
        <button
          onClick={() => navigate(`/clients/${c.id}/edit`)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left' }}
        >
          {c.legalName}
        </button>
      ),
      filterable: true,
      filterValue: (c) => c.legalName,
    },
    { key: 'cnpj', header: 'CNPJ', render: (c) => c.cnpj ?? '—', filterable: true, filterValue: (c) => c.cnpj ?? '' },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Clientes']}>
      <KpiRow>
        <KpiCard label="Clientes cadastrados" value={clients.length} />
      </KpiRow>

      {bulkError && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{bulkError}</p>}

      <DataTable
        columns={columns}
        rows={clients}
        rowKey={(c) => c.id}
        bulkActions={
          hasPermission('client:delete')
            ? [
                {
                  label: 'Excluir',
                  tone: 'danger',
                  onRun: async (rows) => {
                    setBulkError(await runBulkDelete(rows, (r) => clientsApi.remove(r.id), refresh));
                  },
                },
              ]
            : undefined
        }
        toolbar={
          hasPermission('client:create') && (
            <Button variant="positive" onClick={() => navigate('/clients/new')}>
              + Novo cliente
            </Button>
          )
        }
      />
    </AppLayout>
  );
}

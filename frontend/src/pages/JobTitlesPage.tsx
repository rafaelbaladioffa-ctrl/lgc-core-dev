import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { jobTitlesApi, type JobTitle } from '../api/jobTitles';
import { useAuth } from '../context/AuthContext';
import { runBulkDelete } from '../utils/bulkDelete';
import { Button } from '../components/Button';

export function JobTitlesPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refresh = () => jobTitlesApi.list().then(setJobTitles);

  useEffect(() => {
    void refresh();
  }, []);

  const columns: ColumnDef<JobTitle>[] = [
    {
      key: 'name',
      header: 'Nome',
      render: (j) => (
        <button
          onClick={() => navigate(`/job-titles/${j.id}/edit`)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left' }}
        >
          {j.name}
        </button>
      ),
      filterable: true,
      filterValue: (j) => j.name,
    },
    {
      key: 'isTechnician',
      header: 'Técnico (exige NR)',
      render: (j) => <StatusBadge label={j.isTechnician ? 'Sim' : 'Não'} tone={j.isTechnician ? 'warning' : 'default'} />,
      filterable: true,
      filterValue: (j) => (j.isTechnician ? 'Sim' : 'Não'),
    },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Cargos']}>
      <KpiRow>
        <KpiCard label="Cargos cadastrados" value={jobTitles.length} />
        <KpiCard label="Técnicos" value={jobTitles.filter((j) => j.isTechnician).length} tone="warning" />
      </KpiRow>

      {bulkError && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{bulkError}</p>}

      <DataTable
        columns={columns}
        rows={jobTitles}
        rowKey={(j) => j.id}
        bulkActions={
          hasPermission('job_title:delete')
            ? [
                {
                  label: 'Excluir',
                  tone: 'danger',
                  onRun: async (rows) => {
                    setBulkError(await runBulkDelete(rows, (r) => jobTitlesApi.remove(r.id), refresh));
                  },
                },
              ]
            : undefined
        }
        toolbar={
          hasPermission('job_title:create') && (
            <Button variant="positive" onClick={() => navigate('/job-titles/new')}>
              + Novo cargo
            </Button>
          )
        }
      />
    </AppLayout>
  );
}

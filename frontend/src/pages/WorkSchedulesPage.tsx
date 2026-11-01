import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { workSchedulesApi, type WorkSchedule } from '../api/workSchedules';
import { useAuth } from '../context/AuthContext';
import { runBulkDelete } from '../utils/bulkDelete';
import { Button } from '../components/Button';

export function WorkSchedulesPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refresh = () => workSchedulesApi.list().then(setSchedules);

  useEffect(() => {
    void refresh();
  }, []);

  const columns: ColumnDef<WorkSchedule>[] = [
    {
      key: 'name',
      header: 'Nome',
      render: (w) => (
        <button
          onClick={() => navigate(`/work-schedules/${w.id}/edit`)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left' }}
        >
          {w.name}
        </button>
      ),
      filterable: true,
      filterValue: (w) => w.name,
    },
    { key: 'hours', header: 'Horário', render: (w) => `${w.startTime} - ${w.endTime}` },
    { key: 'break', header: 'Intervalo', render: (w) => (w.breakMinutes ? `${w.breakMinutes} min` : '—') },
    { key: 'days', header: 'Dias', render: (w) => w.daysOfWeek.join(', ') },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Jornadas de Trabalho']}>
      <KpiRow>
        <KpiCard label="Jornadas cadastradas" value={schedules.length} />
      </KpiRow>

      {bulkError && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{bulkError}</p>}

      <DataTable
        columns={columns}
        rows={schedules}
        rowKey={(w) => w.id}
        bulkActions={
          hasPermission('work_schedule:delete')
            ? [
                {
                  label: 'Excluir',
                  tone: 'danger',
                  onRun: async (rows) => {
                    setBulkError(await runBulkDelete(rows, (r) => workSchedulesApi.remove(r.id), refresh));
                  },
                },
              ]
            : undefined
        }
        toolbar={
          hasPermission('work_schedule:create') && (
            <Button variant="positive" onClick={() => navigate('/work-schedules/new')}>
              + Nova jornada
            </Button>
          )
        }
      />
    </AppLayout>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { workSchedulesApi, type CreateWorkScheduleInput } from '../api/workSchedules';
import { translateApiError } from '../utils/apiError';

const WEEKDAYS: Array<{ value: string; label: string }> = [
  { value: 'seg', label: 'Seg' },
  { value: 'ter', label: 'Ter' },
  { value: 'qua', label: 'Qua' },
  { value: 'qui', label: 'Qui' },
  { value: 'sex', label: 'Sex' },
  { value: 'sab', label: 'Sáb' },
  { value: 'dom', label: 'Dom' },
];

const emptyForm: CreateWorkScheduleInput = { name: '', startTime: '08:00', endTime: '18:00', daysOfWeek: [] };

export function WorkScheduleFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState<CreateWorkScheduleInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!id) return;
    void workSchedulesApi.list().then((list) => {
      const w = list.find((s) => s.id === id);
      if (w) setForm({ name: w.name, startTime: w.startTime, endTime: w.endTime, breakMinutes: w.breakMinutes ?? undefined, daysOfWeek: w.daysOfWeek });
      setLoading(false);
    });
  }, [id]);

  const toggleDay = (day: string) => {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day) ? f.daysOfWeek.filter((d) => d !== day) : [...f.daysOfWeek, day],
    }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit && id) {
        await workSchedulesApi.update(id, form);
      } else {
        await workSchedulesApi.create(form);
      }
      navigate('/work-schedules');
    } catch (err) {
      setError(translateApiError(err, isEdit ? 'Erro ao salvar jornada.' : 'Erro ao cadastrar jornada.'));
    }
  };

  return (
    <FormPage
      breadcrumb={['Axis', 'Jornadas de Trabalho', isEdit ? 'Editar' : 'Nova']}
      onSubmit={onSubmit}
      onCancel={() => navigate('/work-schedules')}
      error={error}
      loading={loading}
      submitLabel={isEdit ? 'Salvar alterações' : 'Cadastrar'}
      maxWidth={520}
    >
      <FormSection title="Dados da jornada">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="Nome (ex: Comercial, Escala 12x36)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required />
            <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required />
          </div>
          <input
            type="number"
            min={0}
            placeholder="Intervalo (minutos)"
            value={form.breakMinutes ?? ''}
            onChange={(e) => setForm({ ...form, breakMinutes: e.target.value ? Number(e.target.value) : undefined })}
          />
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Dias da semana</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {WEEKDAYS.map((d) => (
                <label key={d.value} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={form.daysOfWeek.includes(d.value)} onChange={() => toggleDay(d.value)} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </FormSection>
    </FormPage>
  );
}

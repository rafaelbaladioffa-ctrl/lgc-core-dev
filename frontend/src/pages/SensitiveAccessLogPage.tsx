import { useEffect, useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import { sensitiveAccessLogsApi, type SensitiveAccessLogEntry } from '../api/sensitiveAccessLogs';
import { formatDateTime } from '../utils/formatDate';

/**
 * "Log filtrável simples" pattern: filters on top (period, free-text search), plain table below,
 * no card/KPI decoration — distinct on purpose from the ERP list-page pattern used elsewhere.
 */
export function SensitiveAccessLogPage() {
  const [entries, setEntries] = useState<SensitiveAccessLogEntry[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    void sensitiveAccessLogsApi.list({ from: from || undefined, to: to || undefined, perPage: 200 }).then((r) => {
      setEntries(r.data);
      setTotal(r.meta.total);
    });
  }, [from, to]);

  const filtered = entries.filter((e) => {
    if (!search) return true;
    const needle = search.toLowerCase();
    return e.collaborator.fullName.toLowerCase().includes(needle) || e.actor.email.toLowerCase().includes(needle);
  });

  return (
    <AppLayout breadcrumb={['Axis', 'Log de acesso a dados sensíveis']}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>De</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Até</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Buscar (colaborador ou autor)</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou email..." style={{ width: '100%' }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{total} registro(s) no período</span>
      </div>

      <table style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
            <th style={{ padding: '6px 10px' }}>Data/hora</th>
            <th style={{ padding: '6px 10px' }}>Colaborador acessado</th>
            <th style={{ padding: '6px 10px' }}>Autor</th>
            <th style={{ padding: '6px 10px' }}>Campos</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                {search ? 'Nenhum acesso encontrado para essa busca.' : 'Nenhum acesso registrado no período.'}
              </td>
            </tr>
          ) : (
            filtered.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 10px' }}>{formatDateTime(e.createdAt)}</td>
                <td style={{ padding: '6px 10px' }}>{e.collaborator.fullName}</td>
                <td style={{ padding: '6px 10px' }}>{e.actor.email}</td>
                <td style={{ padding: '6px 10px' }}>
                  <code style={{ fontSize: 11 }}>{e.fields.join(', ')}</code>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </AppLayout>
  );
}

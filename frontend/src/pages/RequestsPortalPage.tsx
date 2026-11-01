import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { requestCategoriesApi, type RequestCategory } from '../api/requestCategories';
import { sectorsApi, type Sector } from '../api/sectors';

/** Portal de solicitações (REQUISICOES_SPEC.md §15.1.1): catálogo agrupado por setor. Busca,
 * favoritos e recentes ficam para a Fase 2 — aqui é a navegação essencial pra abrir uma
 * requisição a partir de qualquer categoria publicada. */
export function RequestsPortalPage() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<RequestCategory[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void Promise.all([requestCategoriesApi.list(), sectorsApi.list()]).then(([c, s]) => {
      setCategories(c);
      setSectors(s);
    });
  }, []);

  const sectorName = (id: string) => sectors.find((s) => s.id === id)?.name ?? '—';
  const filtered = categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || sectorName(c.sectorId).toLowerCase().includes(search.toLowerCase()));
  const bySector = new Map<string, RequestCategory[]>();
  for (const c of filtered) {
    if (!bySector.has(c.sectorId)) bySector.set(c.sectorId, []);
    bySector.get(c.sectorId)!.push(c);
  }

  return (
    <AppLayout breadcrumb={['Axis', 'Requisições', 'Portal']}>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <input placeholder="Buscar categoria ou setor..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 320 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/requests/mine')} style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
            Minhas requisições
          </button>
          <button onClick={() => navigate('/requests/queue')} style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
            Fila do setor
          </button>
          <button onClick={() => navigate('/requests/dashboard')} style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
            Painel gerencial
          </button>
        </div>
      </div>

      {bySector.size === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma categoria encontrada.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[...bySector.entries()].map(([sectorId, cats]) => (
          <div key={sectorId} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
            <h4 style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{sectorName(sectorId)}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
              {cats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/requests/new?categoryId=${c.id}`)}
                  style={{ textAlign: 'left', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', cursor: 'pointer' }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.code}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  );
}

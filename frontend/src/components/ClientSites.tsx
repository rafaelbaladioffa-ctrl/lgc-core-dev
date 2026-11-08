import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sitesApi, formatSiteAddress, type Site } from '../api/sites';
import { useAuth } from '../context/AuthContext';
import { Button } from './Button';
import { StatusBadge } from './DataTable';
import { translateApiError } from '../utils/apiError';
import '../styles/sites.css';

/**
 * Sites do cliente, na tela de edição do cliente. Ver exige `site:read`; cadastrar e editar
 * exigem `site:create` e `site:update` (o servidor confere de novo). Site não se exclui:
 * inativa-se, e o site inativo deixa de aparecer no seletor de projetos novos.
 *
 * Fica dentro do `<form>` do cliente: por isso tabela simples (sem os campos de filtro do
 * `DataTable`, em que o Enter enviaria o formulário) e botões `type="button"`.
 */
export function ClientSites({ clientId }: { clientId: string }) {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const canRead = hasPermission('site:read');
  const canCreate = hasPermission('site:create');
  const canUpdate = hasPermission('site:update');
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(canRead);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canRead) return Promise.resolve();
    return sitesApi
      .list({ clientId })
      .then(setSites)
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar os sites do cliente.')))
      .finally(() => setLoading(false));
  }, [clientId, canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (site: Site) => {
    if (site.active && !window.confirm(`Inativar o site ${site.code}? Ele deixa de poder ser escolhido em projetos novos.`)) return;
    setBusyId(site.id);
    setError(null);
    try {
      await sitesApi.update(site.id, { active: !site.active });
      await load();
    } catch (err) {
      setError(translateApiError(err, site.active ? 'Não foi possível inativar o site.' : 'Não foi possível reativar o site.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!canRead && !canCreate) return null;

  return (
    <div className="client-sites">
      {error && <p className="client-sites__error">{error}</p>}
      {canCreate && (
        <div className="client-sites__actions">
          <Button type="button" variant="positive" onClick={() => navigate(`/clients/${clientId}/sites/new`)}>
            + Novo site
          </Button>
        </div>
      )}
      {canRead &&
        (loading ? (
          <p className="client-sites__hint">Carregando sites...</p>
        ) : sites.length === 0 ? (
          <p className="client-sites__hint">Nenhum site cadastrado para este cliente.</p>
        ) : (
          <div className="client-sites__scroll">
            <table className="client-sites__table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nome</th>
                  <th>Endereço</th>
                  <th>Situação</th>
                  {canUpdate && <th />}
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td>{s.code}</td>
                    <td>{s.name}</td>
                    <td>{formatSiteAddress(s) || '—'}</td>
                    <td>
                      <StatusBadge label={s.active ? 'Ativo' : 'Inativo'} tone={s.active ? 'success' : 'default'} />
                    </td>
                    {canUpdate && (
                      <td>
                        <span className="client-sites__actions">
                          <Button type="button" variant="outline" onClick={() => navigate(`/clients/${clientId}/sites/${s.id}/edit`)}>
                            Editar
                          </Button>
                          <Button type="button" variant="secondary" disabled={busyId === s.id} onClick={() => void toggleActive(s)}>
                            {s.active ? 'Inativar' : 'Reativar'}
                          </Button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <p className="client-sites__hint">O projeto escolhe o site entre os do próprio cliente. Cada projeto tem um site.</p>
    </div>
  );
}

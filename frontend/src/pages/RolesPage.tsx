import { useEffect, useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import { Button } from '../components/Button';
import { rolesApi, type Permission, type Role } from '../api/users';
import { useAuth } from '../context/AuthContext';

const labels: Record<string, string> = { read: 'Pode visualizar', create: 'Pode adicionar', update: 'Pode alterar', delete: 'Pode excluir', assign: 'Pode atribuir', approve: 'Pode aprovar', comment: 'Pode comentar', read_sensitive: 'Pode visualizar dados sensíveis', reset_password: 'Pode redefinir senha', manage: 'Pode administrar', view_whistleblower_identity: 'Pode ver identidade real' };
const resourceLabels: Record<string, string> = { user: 'Usuários', request: 'Requisições', collaborator: 'Colaboradores', sector: 'Setores', project: 'Projetos', client: 'Clientes', cost_center: 'Centros de custo', job_title: 'Cargos', work_schedule: 'Jornadas de trabalho', request_category: 'Categorias de requisição', delegation: 'Delegações', certification: 'Certificações', integration: 'Integrações' };

export function RolesPage() {
  const { hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [availableMarked, setAvailableMarked] = useState<string[]>([]);
  const [chosenMarked, setChosenMarked] = useState<string[]>([]);
  const [availableFilter, setAvailableFilter] = useState('');
  const [chosenFilter, setChosenFilter] = useState('');
  const [error, setError] = useState('');

  const load = () => Promise.all([rolesApi.list(), rolesApi.permissions()]).then(([r, p]) => { setRoles(r); setPermissions(p); });
  useEffect(() => { void load(); }, []);
  const open = (role?: Role) => { setEditing(role ?? null); setName(role?.name ?? ''); setDescription(role?.description ?? ''); setSelected(role?.rolePermissions?.map((x) => x.permission.id) ?? []); setAvailableMarked([]); setChosenMarked([]); setAvailableFilter(''); setChosenFilter(''); setError(''); };
  const save = async () => { setError(''); try { const input = { name, description, permissionIds: selected }; if (editing) await rolesApi.update(editing.id, input); else await rolesApi.create(input); await load(); open(); } catch { setError('Não foi possível salvar o grupo.'); } };
  const permissionText = (p: Permission) => `${resourceLabels[p.resource] ?? p.resource} | ${labels[p.action] ?? p.description ?? p.action}`;
  const available = permissions.filter((p) => !selected.includes(p.id) && permissionText(p).toLowerCase().includes(availableFilter.toLowerCase()));
  const chosen = permissions.filter((p) => selected.includes(p.id) && permissionText(p).toLowerCase().includes(chosenFilter.toLowerCase()));
  const moveRight = () => { setSelected((current) => [...current, ...availableMarked.filter((id) => !current.includes(id))]); setAvailableMarked([]); };
  const moveLeft = () => { setSelected((current) => current.filter((id) => !chosenMarked.includes(id))); setChosenMarked([]); };
  const listStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' };
  const permissionList = (items: Permission[], marked: string[], setMarked: (ids: string[]) => void) => <div style={{ height: 230, overflowY: 'auto', padding: 6 }}>{items.map((p) => <button type="button" key={p.id} onClick={() => setMarked(marked.includes(p.id) ? marked.filter((id) => id !== p.id) : [...marked, p.id])} style={{ display: 'block', width: '100%', border: 0, borderRadius: 3, textAlign: 'left', padding: '5px 7px', background: marked.includes(p.id) ? 'var(--bg-sidebar-active)' : 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>{permissionText(p)}</button>)}</div>;
  if (!hasPermission('user:read')) return null;
  return <AppLayout breadcrumb={['Axis', 'Usuários', 'Grupos e permissões']}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}><div><h2 style={{ margin: 0 }}>Grupos e permissões</h2><p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Crie um grupo e marque exatamente o que ele pode fazer.</p></div>{hasPermission('user:update') && <Button variant="positive" onClick={() => open()}>+ Novo grupo</Button>}</div>
    {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(360px, 2fr)', gap: 14 }}>
      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 }}><strong>Grupos cadastrados</strong>{roles.map((r) => <button key={r.id} onClick={() => open(r)} style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: editing?.id === r.id ? 'var(--bg-sidebar-active)' : 'transparent', color: 'var(--text)', cursor: 'pointer' }}><b>{r.name}</b><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.description || 'Sem descrição'}</div></button>)}</section>
      {hasPermission('user:update') && <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 }}><strong>{editing ? 'Editar grupo' : 'Novo grupo'}</strong><label style={{ display: 'block', marginTop: 12, fontSize: 12 }}>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: analista_suprimentos" style={{ width: '100%', marginTop: 4 }} /></label><label style={{ display: 'block', marginTop: 10, fontSize: 12 }}>Descrição<textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', marginTop: 4 }} /></label><div style={{ marginTop: 14 }}><strong>Permissões</strong><div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '3px 0 8px' }}>Selecione uma ou mais permissões e use as setas para permitir ou retirar o acesso.</div><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><div style={listStyle}><div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 12 }}>Permissões disponíveis ({available.length})</div><input value={availableFilter} onChange={(e) => setAvailableFilter(e.target.value)} placeholder="Filtro" style={{ width: 'calc(100% - 12px)', margin: 6 }} />{permissionList(available, availableMarked, setAvailableMarked)}<button type="button" onClick={() => setAvailableMarked(available.map((p) => p.id))} style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', padding: 7, cursor: 'pointer', fontSize: 12 }}>Escolher todas as permissões</button></div><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><button type="button" title="Adicionar selecionadas" onClick={moveRight} disabled={!availableMarked.length} style={{ fontSize: 20, cursor: 'pointer' }}>→</button><button type="button" title="Remover selecionadas" onClick={moveLeft} disabled={!chosenMarked.length} style={{ fontSize: 20, cursor: 'pointer' }}>←</button></div><div style={listStyle}><div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 12 }}>Permissões escolhidas ({chosen.length})</div><input value={chosenFilter} onChange={(e) => setChosenFilter(e.target.value)} placeholder="Filtro" style={{ width: 'calc(100% - 12px)', margin: 6 }} />{permissionList(chosen, chosenMarked, setChosenMarked)}<button type="button" onClick={() => { setSelected([]); setChosenMarked([]); }} style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', background: 'transparent', color: 'var(--danger)', padding: 7, cursor: 'pointer', fontSize: 12 }}>Remover todas as permissões</button></div></div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 7 }}>Use Ctrl ou Command para selecionar visualmente várias permissões.</div></div><div style={{ marginTop: 16, display: 'flex', gap: 8 }}><Button variant="positive" onClick={() => void save()} disabled={!name.trim()}>Salvar grupo</Button><Button onClick={() => open()}>Limpar</Button></div></section>}
    </div>
  </AppLayout>;
}

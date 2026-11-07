import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Button } from '../components/Button';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { requestsApi, type MyActivity, type MyActivityBucket, type MyActivityKind, type RequestStatus } from '../api/requests';
import { formatDate } from '../utils/formatDate';

const STATUS_LABEL: Record<RequestStatus, string> = {
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  em_triagem: 'Em triagem',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  planejada: 'Planejada',
  em_atendimento: 'Em atendimento',
  aguardando_solicitante: 'Aguardando solicitante',
  aguardando_terceiro: 'Aguardando terceiro',
  aguardando_entrega: 'Aguardando entrega',
  concluida: 'Concluída',
  encerrada: 'Encerrada',
  devolvida_ajuste: 'Devolvida para ajuste',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
  suspensa: 'Suspensa',
  reaberta: 'Reaberta',
  expirada: 'Expirada',
};

const KIND_LABEL: Record<MyActivityKind, string> = {
  minha_requisicao: 'Minha requisição',
  triagem: 'Triagem',
  aprovacao: 'Aprovação',
  execucao: 'Execução',
};

const BUCKET_LABEL: Record<MyActivityBucket, string> = {
  no_prazo: 'No prazo',
  em_alerta: 'Em alerta',
  atrasado: 'Atrasado',
};

const BUCKET_TONE: Record<MyActivityBucket, 'default' | 'warning' | 'danger'> = {
  no_prazo: 'default',
  em_alerta: 'warning',
  atrasado: 'danger',
};

interface ProcessGroup {
  categoryId: string;
  categoryName: string;
  version: number;
  total: number;
  byBucket: Record<MyActivityBucket, number>;
}

/** Tela inicial do módulo de Requisições (substitui o antigo catálogo de categorias em
 * quadrados — "Nova requisição" já tem seu próprio seletor de categoria). Agrega em uma lista só
 * tudo que precisa de uma ação da pessoa logada: requisições próprias pendentes, triagem do seu
 * setor, aprovações e execuções atribuídas a ela — ver RequestsService.myActivities. */
export function MyActivitiesPage() {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<MyActivity[] | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  useEffect(() => {
    void requestsApi.myActivities().then(setActivities);
  }, []);

  const groups = useMemo<ProcessGroup[]>(() => {
    if (!activities) return [];
    const byCategory = new Map<string, ProcessGroup>();
    for (const a of activities) {
      let group = byCategory.get(a.categoryId);
      if (!group) {
        group = { categoryId: a.categoryId, categoryName: a.categoryName, version: a.categoryVersionNumber, total: 0, byBucket: { no_prazo: 0, em_alerta: 0, atrasado: 0 } };
        byCategory.set(a.categoryId, group);
      }
      group.version = Math.max(group.version, a.categoryVersionNumber);
      group.total += 1;
      group.byBucket[a.bucket] += 1;
    }
    return [...byCategory.values()].sort((a, b) => b.total - a.total);
  }, [activities]);

  const totals = useMemo(
    () => ({
      total: activities?.length ?? 0,
      no_prazo: activities?.filter((a) => a.bucket === 'no_prazo').length ?? 0,
      em_alerta: activities?.filter((a) => a.bucket === 'em_alerta').length ?? 0,
      atrasado: activities?.filter((a) => a.bucket === 'atrasado').length ?? 0,
    }),
    [activities],
  );

  const filtered = categoryFilter ? (activities ?? []).filter((a) => a.categoryId === categoryFilter) : (activities ?? []);

  const columns: ColumnDef<MyActivity>[] = [
    {
      key: 'code',
      header: 'Código',
      render: (a) => (
        <button onClick={() => navigate(`/requests/${a.requestId}`)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}>
          {a.code}
        </button>
      ),
      filterable: true,
      filterValue: (a) => a.code,
      width: '150px',
    },
    { key: 'title', header: 'Título', render: (a) => a.title, filterable: true, filterValue: (a) => a.title },
    { key: 'kind', header: 'Minha participação', render: (a) => KIND_LABEL[a.kind], filterable: true, filterValue: (a) => KIND_LABEL[a.kind] },
    { key: 'category', header: 'Processo', render: (a) => a.categoryName, filterable: true, filterValue: (a) => a.categoryName },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge label={STATUS_LABEL[a.status]} tone="default" />, filterable: true, filterValue: (a) => STATUS_LABEL[a.status] },
    {
      key: 'bucket',
      header: 'Prazo',
      render: (a) => <StatusBadge label={a.dueAt ? `${BUCKET_LABEL[a.bucket]} · ${formatDate(a.dueAt)}` : BUCKET_LABEL[a.bucket]} tone={BUCKET_TONE[a.bucket]} />,
    },
    { key: 'createdAt', header: 'Criada em', render: (a) => formatDate(a.createdAt) },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Requisições', 'Minhas atividades']}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Minhas atividades</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="positive" onClick={() => navigate('/requests/new')}>
            + Nova requisição
          </Button>
          <Button variant="secondary" onClick={() => navigate('/requests/queue')}>
            Minha fila
          </Button>
          <Button variant="secondary" onClick={() => navigate('/my-approvals')}>
            Aprovações
          </Button>
          <Button variant="secondary" onClick={() => navigate('/requests/mine')}>
            Histórico
          </Button>
        </div>
      </div>

      {!activities && <p>Carregando...</p>}

      {activities && (
        <>
          <KpiRow>
            <KpiCard label="Atividades" value={totals.total} />
            <KpiCard label="No prazo" value={totals.no_prazo} />
            <KpiCard label="Em alerta" value={totals.em_alerta} tone="warning" />
            <KpiCard label="Atrasado" value={totals.atrasado} tone="danger" />
          </KpiRow>

          {groups.length > 0 && (
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Por processo</h4>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {groups.map((g) => (
                  <button
                    key={g.categoryId}
                    onClick={() => setCategoryFilter(categoryFilter === g.categoryId ? null : g.categoryId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 4px',
                      border: 'none',
                      borderTop: '1px solid var(--border)',
                      background: categoryFilter === g.categoryId ? 'var(--bg)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      font: 'inherit',
                      color: 'var(--text)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{g.categoryName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Versão {g.version}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <StatusBadge label={`${g.total} atividade${g.total === 1 ? '' : 's'}`} tone="default" />
                      {g.byBucket.no_prazo > 0 && <StatusBadge label={`${g.byBucket.no_prazo} no prazo`} tone="default" />}
                      {g.byBucket.em_alerta > 0 && <StatusBadge label={`${g.byBucket.em_alerta} em alerta`} tone="warning" />}
                      {g.byBucket.atrasado > 0 && <StatusBadge label={`${g.byBucket.atrasado} em atraso`} tone="danger" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>
              Nenhuma atividade pendente{categoryFilter ? ' para este processo.' : '.'}
            </p>
          ) : (
            <DataTable columns={columns} rows={filtered} rowKey={(a) => `${a.kind}:${a.requestId}:${a.approvalId ?? ''}`} />
          )}
        </>
      )}
    </AppLayout>
  );
}

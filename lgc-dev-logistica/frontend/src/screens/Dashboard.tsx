import { useState } from 'react';
import { call } from '../lib/api';
import { fmtBRL, fmtDateTime } from '../lib/format';
import { DataTable, useLoad, type Column } from '../ui';

interface Kpis {
  period: { from: string; to: string };
  accuracy: { counted: number; matched: number; pct: number | null };
  serviceLevel: { orders: number; delivered: number; onTime: number; fillRatePct: number | null };
  cycleHours: Record<string, number | null>;
  stock: { policies: number; stockouts: number; belowMin: number; avgCoverageDays: number | null };
  expiring?: unknown;
  custody: { byStatus: Record<string, number>; overdue: number };
  transit: { count: number; avgHours: number | null };
  integration: { pendingOutbound: number; failedInbound: number; lastInboundAt: string | null };
  alerts: Record<string, number>;
  receiving: { withoutOrderException: number };
  /** `valueBy*` só vem para quem tem `material:read_cost`; valores já líquidos de estornos. */
  consumption: { valueByProject?: ValueRow<'project'>[]; valueByCostCenter?: ValueRow<'costCenter'>[] };
}

type ValueRow<K extends string> = Record<K, string | null> & { value: string; valueBRL: string; movements: number };

const valueCols = (key: 'project' | 'costCenter', header: string, none: string): Column<Record<string, unknown> & { value: string; movements: number }>[] => [
  { key, header, render: (r) => (r[key] as string | null) ?? <span className="hint">{none}</span> },
  { key: 'movements', header: 'Movimentos', num: true, render: (r) => r.movements.toLocaleString('pt-BR') },
  { key: 'value', header: 'Valor', num: true, render: (r) => fmtBRL(r.value) },
];

const CYCLE: Record<string, string> = { approvalToReservation: 'Aprovação → reserva', reservationToPicking: 'Reserva → separação', pickingToDispatch: 'Separação → expedição', dispatchToDelivery: 'Expedição → entrega' };
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const hours = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`);

function Tile({ label, value, hint, bad }: { label: string; value: string | number; hint?: string; bad?: boolean }) {
  return <div className="card tile"><div className="hint">{label}</div><div className={bad ? 'tile-v err' : 'tile-v'}>{value}</div>{hint && <div className="hint">{hint}</div>}</div>;
}

export function Dashboard({ warehouseId }: { warehouseId?: string }) {
  const [days, setDays] = useState(30);
  const [all, setAll] = useState(false);
  const [res, reload] = useLoad(() => {
    const p = new URLSearchParams({ from: new Date(Date.now() - days * 86_400_000).toISOString(), to: new Date().toISOString() });
    if (warehouseId && !all) p.set('warehouseId', warehouseId);
    return call<Kpis>(`/dashboard/kpis?${p}`);
  }, [days, all, warehouseId]);
  return (
    <section>
      <h1>Painel operacional</h1>
      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <label className="field">Período<select className="inp" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option></select></label>
        <label className="field">Escopo<select className="inp" value={all ? 'all' : 'one'} onChange={(e) => setAll(e.target.value === 'all')}><option value="one">Este almoxarifado</option><option value="all">Todos os acessíveis</option></select></label>
        <button type="button" className="btn ghost" onClick={reload}>Atualizar</button>
      </form>
      {res.state === 'loading' && <div className="skeleton" />}
      {res.state === 'error' && <div className="card" role="alert"><p className="err">{res.message}</p><button className="btn" onClick={reload}>Tentar de novo</button></div>}
      {res.state === 'ready' && (() => {
        const k = res.data;
        const alerts = Object.entries(k.alerts);
        return (
          <>
            <p className="hint">Período de {fmtDateTime(k.period.from)} a {fmtDateTime(k.period.to)}.</p>
            <div className="tiles">
              <Tile label="Acuracidade do inventário" value={pct(k.accuracy.pct)} hint={`${k.accuracy.matched} de ${k.accuracy.counted} linhas conferidas`} />
              <Tile label="Nível de serviço" value={pct(k.serviceLevel.fillRatePct)} hint={`${k.serviceLevel.onTime} de ${k.serviceLevel.delivered} entregues no prazo · ${k.serviceLevel.orders} ordens`} />
              <Tile label="Rupturas" value={k.stock.stockouts} bad={k.stock.stockouts > 0} hint={`${k.stock.belowMin} abaixo do mínimo · ${k.stock.policies} políticas`} />
              <Tile label="Cobertura média" value={k.stock.avgCoverageDays === null ? '—' : `${k.stock.avgCoverageDays.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`} />
              <Tile label="Em trânsito" value={k.transit.count} hint={`Tempo médio ${hours(k.transit.avgHours)}`} />
              <Tile label="Custódias atrasadas" value={k.custody.overdue} bad={k.custody.overdue > 0} />
              <Tile label="Recebimentos sem pedido" value={k.receiving.withoutOrderException} />
              <Tile label="Integração com o Axis" value={k.integration.pendingOutbound} bad={k.integration.failedInbound > 0} hint={`${k.integration.pendingOutbound} eventos a enviar · ${k.integration.failedInbound} entradas com falha`} />
            </div>
            <div className="card">
              <h3>Ciclo do atendimento (média)</h3>
              <dl className="kv">{Object.entries(CYCLE).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{hours(k.cycleHours[key])}</dd></div>)}</dl>
            </div>
            {k.consumption.valueByProject && (
              <div className="card">
                <h3>Consumo em R$ por projeto</h3>
                <DataTable cols={valueCols('project', 'Projeto', 'Sem projeto')} rows={k.consumption.valueByProject} state="ready" empty="Nenhuma entrega no período." rowKey={(r) => String(r.project ?? '-')} />
              </div>
            )}
            {k.consumption.valueByCostCenter && (
              <div className="card">
                <h3>Consumo em R$ por centro de custo</h3>
                <DataTable cols={valueCols('costCenter', 'Centro de custo', 'Sem centro de custo')} rows={k.consumption.valueByCostCenter} state="ready" empty="Nenhuma entrega no período." rowKey={(r) => String(r.costCenter ?? '-')} />
              </div>
            )}
            <div className="card">
              <h3>Alertas abertos</h3>
              {alerts.length === 0 ? <p className="hint">Nenhum alerta aberto.</p> : alerts.map(([sev, n]) => <span key={sev} className={`pill ${sev === 'CRITICO' ? 'bad' : sev === 'ATENCAO' ? 'warn' : ''}`}>{sev === 'CRITICO' ? 'Crítico' : sev === 'ATENCAO' ? 'Atenção' : 'Informativo'}: {n}</span>)}
            </div>
          </>
        );
      })()}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { projectsApi, type JourneyStage, type JourneyState, type ProjectJourney as Journey } from '../api/projects';
import { KpiCard, KpiRow } from './KpiCard';
import { Button } from './Button';
import { translateApiError } from '../utils/apiError';
import { formatDateOnly, formatDateTime } from '../utils/formatDate';
import { formatNumberBR } from '../utils/format';
import { JOURNEY_STATE_LABEL } from '../utils/journey';

const STATE_COLOR: Record<JourneyState, string> = {
  feito: 'var(--success)',
  em_andamento: 'var(--info)',
  pendente: 'var(--foreground-muted)',
  atencao: 'var(--warning)',
};

const STATE_MARK: Record<JourneyState, string> = { feito: '✓', em_andamento: '●', pendente: '○', atencao: '!' };

const isExternal = (to: string) => /^https?:\/\//i.test(to);

function StageLink({ link }: { link: NonNullable<JourneyStage['link']> }) {
  return isExternal(link.to) ? (
    <a href={link.to} target="_blank" rel="noreferrer">
      {link.label}
    </a>
  ) : (
    <Link to={link.to}>{link.label}</Link>
  );
}

function StageRow({ stage, current, last }: { stage: JourneyStage; current: boolean; last: boolean }) {
  const color = STATE_COLOR[stage.state];
  return (
    <li data-testid={`journey-stage-${stage.key}`} data-state={stage.state} aria-current={current ? 'step' : undefined} style={{ display: 'flex', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span
          aria-hidden="true"
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            border: `2px solid ${color}`,
            background: stage.state === 'feito' ? color : 'var(--surface)',
            color: stage.state === 'feito' ? 'var(--primary-foreground)' : color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {STATE_MARK[stage.state]}
        </span>
        {!last && <span style={{ flex: 1, width: 2, minHeight: 16, background: 'var(--border)' }} />}
      </div>
      <div style={{ flex: 1, paddingBottom: last ? 0 : 18, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 'var(--text-base)' }}>{stage.label}</strong>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{JOURNEY_STATE_LABEL[stage.state]}</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--foreground-muted)' }}>{stage.date ? formatDateTime(stage.date) : 'Sem data ainda'}</span>
        </div>
        <div style={{ fontSize: 'var(--text-sm)', marginTop: 2 }}>{stage.summary}</div>
        {stage.alerts.length > 0 && (
          <ul role="alert" style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 'var(--text-sm)', color: 'var(--warning)' }}>
            {stage.alerts.map((alert) => (
              <li key={alert}>{alert}</li>
            ))}
          </ul>
        )}
        {stage.details.length > 0 && (
          <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, max-content) 1fr', gap: '2px 14px', margin: '8px 0 0', fontSize: 'var(--text-sm)' }}>
            {stage.details.map((d) => (
              <div key={d.label} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--foreground-muted)' }}>{d.label}</dt>
                <dd style={{ margin: 0 }}>{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {stage.link && (
          <div style={{ marginTop: 6, fontSize: 'var(--text-sm)' }}>
            <StageLink link={stage.link} />
          </div>
        )}
      </div>
    </li>
  );
}

function hours(value: number | null): string {
  return value === null ? '—' : `${formatNumberBR(value, 1)} h`;
}

/** Linha do tempo e indicadores da jornada do projeto (PT-11). Só apresenta o que o servidor já agregou. */
export function JourneyTimeline({ journey }: { journey: Journey }) {
  const { field, shipment } = journey;
  const current = journey.stages.find((s) => s.key === journey.currentStage);
  const currentTone = current?.state === 'atencao' ? 'warning' : current?.state === 'feito' ? 'success' : 'default';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <KpiRow>
        <KpiCard label="Etapa atual" value={current?.label ?? '—'} tone={currentTone} />
        {shipment && shipment.total > 0 && (
          <KpiCard label="Material entregue" value={`${formatNumberBR(shipment.delivered, 1)} de ${formatNumberBR(shipment.total, 1)}`} tone={shipment.shortages > 0 ? 'warning' : 'default'} />
        )}
        {shipment && shipment.shortages > 0 && <KpiCard label="Itens em falta" value={shipment.shortages} tone="warning" />}
        {field && <KpiCard label="Avanço da obra" value={field.percentComplete === null ? '—' : `${formatNumberBR(field.percentComplete, 1)}%`} tone={field.completedAt ? 'success' : 'default'} />}
        {field && field.tasksTotal !== null && <KpiCard label="Tarefas" value={`${field.tasksDone ?? 0} de ${field.tasksTotal}`} />}
        {field && (field.realManHours !== null || field.plannedManHours !== null) && (
          <KpiCard
            label="HH real × previsto"
            value={`${hours(field.realManHours)} × ${hours(field.plannedManHours)}`}
            tone={field.plannedManHours && field.realManHours !== null && field.realManHours > field.plannedManHours ? 'warning' : 'default'}
          />
        )}
      </KpiRow>
      <ol aria-label="Linha do tempo do projeto" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
        {journey.stages.map((stage, index) => (
          <StageRow key={stage.key} stage={stage} current={stage.key === journey.currentStage} last={index === journey.stages.length - 1} />
        ))}
      </ol>
      {field?.progressDate && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--foreground-muted)' }}>Último avanço informado pelo Field em {formatDateOnly(field.progressDate)}.</div>}
      {journey.financeiroUrl && (
        <div>
          <a href={journey.financeiroUrl} target="_blank" rel="noreferrer">
            Ver resultado no Financeiro
          </a>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--foreground-muted)', marginLeft: 8 }}>Receita, custo e margem ficam só no Financeiro.</span>
        </div>
      )}
    </div>
  );
}

/** Busca a jornada e mostra carregando, erro (com "Tentar de novo") ou a linha do tempo. */
export function ProjectJourney({ projectId }: { projectId: string }) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Cada "Tentar de novo" soma 1 e refaz a consulta.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    projectsApi
      .journey(projectId)
      .then((data) => {
        if (!cancelled) setJourney(data);
      })
      .catch((err) => {
        if (!cancelled) setError(translateApiError(err, 'Erro ao carregar a jornada do projeto.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, attempt]);

  const retry = () => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  };

  if (loading && !journey) return <p style={{ fontSize: 'var(--text-sm)', color: 'var(--foreground-muted)' }}>Carregando a jornada do projeto…</p>;
  if (error) {
    return (
      <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{error}</span>
        <Button type="button" variant="secondary" onClick={retry}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  return journey ? <JourneyTimeline journey={journey} /> : null;
}

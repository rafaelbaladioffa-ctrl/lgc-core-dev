import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestsApi, type RequestDetail, type ShipmentData } from '../api/requests';
import { Button } from './Button';
import { translateApiError } from '../utils/apiError';
import { formatDateTime } from '../utils/formatDate';
import { formatBRL, formatNumberBR } from '../utils/format';
import { formatIsoDate } from '../utils/purchaseDeliveries';
import { deliveredByMaterial, logisticsStatusLabel, logisticsTone, shortageItems } from '../utils/shipmentLogistics';
import { StatusBadge } from './DataTable';

interface Props {
  request: RequestDetail;
  shipment: ShipmentData;
  /** Rótulo da situação da requisição (o mesmo do cabeçalho da tela). */
  statusLabel: string;
  /** Admin de Requisições (`request_category:update`): pode pedir para reavaliar o aprovador. */
  canAdminRequests: boolean;
  onChanged: () => Promise<void> | void;
}

const CARD: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, fontSize: 13 };
const LABEL: React.CSSProperties = { color: 'var(--text-muted)' };

/**
 * Detalhe do envio de material para obra (PT-06): itens, site e endereço, data de necessidade, recebedor e situação.
 * A requisição é criada pelo sistema ao aprovar o projeto; aprovar/reprovar usa os botões genéricos da tela.
 * Sem responsável no centro de custo (nem no pai), a requisição fica sem aprovador e o admin de Requisições a reavalia aqui.
 */
export function ShipmentDetails({ request, shipment, statusLabel, canAdminRequests, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noApprover = request.status === 'aguardando_aprovacao' && !request.approvals.some((a) => a.status === 'pendente');
  const destination = shipment.destination;
  const place = [destination.city, destination.state].filter(Boolean).join('/');
  const logistics = shipment.logistics;
  const delivered = deliveredByMaterial(logistics);
  const shortages = shortageItems(logistics);
  const shortageByCode = new Map(shortages.map((item) => [item.materialCode, item.shortage]));

  const resolve = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestsApi.resolveShipmentApprover(request.id);
      await onChanged();
    } catch (err) {
      setError(translateApiError(err, 'Não foi possível reavaliar o aprovador.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {noApprover && (
        <div role="alert" style={{ ...CARD, borderColor: 'var(--warning)', background: 'var(--warning-soft)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong>Sem aprovador</strong>
          <span>
            O centro de custo do projeto (e o centro de custo pai) não tem responsável cadastrado, então ninguém pode aprovar este envio.
            Cadastre o responsável e peça para reavaliar.
          </span>
          {canAdminRequests ? (
            <div>
              <Button type="button" variant="secondary" onClick={() => void resolve()} disabled={busy}>
                {busy ? 'Reavaliando…' : 'Reavaliar aprovador'}
              </Button>
            </div>
          ) : (
            <span style={LABEL}>O admin de Requisições foi avisado em Minhas atividades.</span>
          )}
          {error && <span role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      )}

      {shipment.warnings.length > 0 && (
        <div role="note" style={{ ...CARD, borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
          <strong>Avisos</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {shipment.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <strong>Envio de material para obra</strong>
        <div>
          <span style={LABEL}>Site:</span> {destination.siteCode} — {destination.siteName}
        </div>
        <div>
          <span style={LABEL}>Endereço de entrega:</span> {[destination.address, place].filter(Boolean).join(' — ') || 'Site sem endereço cadastrado'}
        </div>
        <div>
          <span style={LABEL}>Necessário no site até:</span> {formatIsoDate(shipment.neededBy)}
          {!shipment.neededBy && <span style={LABEL}> (a cotação e o projeto não têm início previsto)</span>}
        </div>
        <div>
          <span style={LABEL}>Recebedor no site:</span> {shipment.recipientName ?? '—'}
        </div>
        <div>
          <span style={LABEL}>Valor estimado:</span> {formatBRL(request.estimatedValue)}
        </div>
        <div>
          <span style={LABEL}>Situação:</span> {statusLabel}
          {shipment.approvedAt ? ` · enviado à Logística em ${formatDateTime(shipment.approvedAt)}` : ' · ainda não enviado à Logística'}
        </div>
        {request.projectId && (
          <div>
            <span style={LABEL}>Projeto:</span> <Link to={`/projects/${request.projectId}/edit`}>Abrir o projeto</Link>
          </div>
        )}
      </div>

      {logistics && (
        <div data-testid="logistics-card" style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 6, borderColor: shortages.length > 0 ? 'var(--warning)' : undefined }}>
          <strong>Situação na Logística</strong>
          <div>
            <span style={LABEL}>Ordem de atendimento:</span> {logistics.orderCode ?? '—'}{' '}
            <StatusBadge label={logisticsStatusLabel(logistics.status)} tone={logisticsTone(logistics.status)} />
          </div>
          {logistics.statusReason && <div style={LABEL}>{logistics.statusReason}</div>}
          {shortages.length > 0 && (
            <div role="alert">
              <span style={{ color: 'var(--warning)', fontWeight: 600 }}>Falta material no estoque.</span> A Logística não compra: o Suprimentos abre a compra do que falta.
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {shortages.map((item) => (
                  <li key={item.materialCode}>
                    {item.materialCode}{item.description ? ` — ${item.description}` : ''}: faltam {formatNumberBR(item.shortage, 3)} de {formatNumberBR(item.quantity, 3)} {item.unit ?? ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {logistics.shipments.map((row) => (
            <div key={row.shipmentId}>
              <span style={LABEL}>Expedido:</span> {row.dispatchedAt ? formatDateTime(row.dispatchedAt) : '—'}
              {row.manifest ? ` · romaneio ${row.manifest}` : row.shipmentCode ? ` · remessa ${row.shipmentCode}` : ''}
              {row.carrier ? ` · ${row.carrier}` : ''}
            </div>
          ))}
          {logistics.deliveredAt && (
            <div>
              <span style={LABEL}>Entregue no site:</span> {formatDateTime(logistics.deliveredAt)}
            </div>
          )}
          {logistics.refusals.map((row) => (
            <div key={row.eventId} style={{ color: 'var(--danger)' }}>
              Entrega recusada{row.refusedAt ? ` em ${formatDateTime(row.refusedAt)}` : ''}: {row.reason ?? 'motivo não informado'}
            </div>
          ))}
        </div>
      )}

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Materiais a enviar</div>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: 9 }}>Código</th>
                <th style={{ padding: 9 }}>Material</th>
                <th style={{ padding: 9 }}>Unidade</th>
                <th style={{ padding: 9, textAlign: 'right' }}>Quantidade</th>
                {logistics && <th style={{ padding: 9, textAlign: 'right' }}>Falta no estoque</th>}
                {logistics && <th style={{ padding: 9, textAlign: 'right' }}>Entregue</th>}
              </tr>
            </thead>
            <tbody>
              {shipment.items.map((item, index) => (
                <tr key={item.materialCode} style={{ borderBottom: index === shipment.items.length - 1 ? undefined : '1px solid var(--border)' }}>
                  <td style={{ padding: 9 }}>{item.materialCode}</td>
                  <td style={{ padding: 9, fontWeight: 600 }}>{item.description}</td>
                  <td style={{ padding: 9 }}>{item.unit}</td>
                  <td style={{ padding: 9, textAlign: 'right' }}>{formatNumberBR(item.quantity, 3)}</td>
                  {logistics && <td style={{ padding: 9, textAlign: 'right' }}>{shortageByCode.has(item.materialCode) ? formatNumberBR(shortageByCode.get(item.materialCode), 3) : '—'}</td>}
                  {logistics && <td style={{ padding: 9, textAlign: 'right' }}>{formatNumberBR(delivered[item.materialCode] ?? 0, 3)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

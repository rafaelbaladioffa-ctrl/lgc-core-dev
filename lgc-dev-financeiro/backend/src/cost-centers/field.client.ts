import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Horas reais de um técnico num projeto num dia (`GET /api/integration/labor-hours` do Field, PT-10). */
export interface LaborHourRow {
  axisProjectId: string;
  axisCollaboratorId: string;
  /** AAAA-MM-DD (São Paulo). */
  date: string;
  /** Decimal com 2 casas. */
  hours: string;
  adjusted: boolean;
}

export interface LaborHours {
  rows: LaborHourRow[];
  /** Linhas fora do contrato (ignoradas e contadas). */
  invalid: number;
}

const TIMEOUT_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

/** Cliente do Field por API key (`FIELD_API_URL` termina em `/api`; `FIELD_API_KEY` = `FIELD_INTEGRATION_API_KEY` de lá). */
@Injectable()
export class FieldClient {
  constructor(private readonly config: ConfigService) {}

  async laborHours(from: string, to: string, fetchFn: typeof fetch = fetch): Promise<LaborHours> {
    const base = (this.config.get<string>('FIELD_API_URL') ?? '').replace(/\/+$/, '');
    const key = this.config.get<string>('FIELD_API_KEY');
    if (!base || !key) throw new ServiceUnavailableException('Integração com o Field não configurada (FIELD_API_URL e FIELD_API_KEY).');
    let res: Response;
    try {
      res = await fetchFn(`${base}/integration/labor-hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        headers: { 'X-Api-Key': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('O Field não respondeu. Tente de novo em instantes.');
    }
    if (!res.ok) throw new BadGatewayException(`O Field recusou a consulta (HTTP ${res.status}).`);
    const body = (await res.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) throw new BadGatewayException('Resposta inesperada do Field.');
    return parseLaborHours(body);
  }
}

/** Valida o contrato linha a linha; o que não cabe nele é descartado e contado, nunca lançado. */
export function parseLaborHours(body: unknown[]): LaborHours {
  const rows: LaborHourRow[] = [];
  let invalid = 0;
  for (const raw of body) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const hours = typeof r.hours === 'number' ? String(r.hours) : r.hours;
    if (
      typeof r.axis_project_id === 'string' && UUID.test(r.axis_project_id) &&
      typeof r.axis_collaborator_id === 'string' && UUID.test(r.axis_collaborator_id) &&
      typeof r.date === 'string' && DATE.test(r.date) &&
      typeof hours === 'string' && DECIMAL.test(hours)
    ) {
      rows.push({ axisProjectId: r.axis_project_id.toLowerCase(), axisCollaboratorId: r.axis_collaborator_id.toLowerCase(), date: r.date, hours, adjusted: r.adjusted === true });
    } else invalid++;
  }
  return { rows, invalid };
}

import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Linhas da API por chave da Logística (docs/integracao-centros-de-custo.md §5). */
export interface ConsumptionRow {
  cost_center_id: string | null;
  project_id: string | null;
  value: string;
  movements: number;
}

export interface CustodyRow {
  custodian_id: string;
  items: number;
  value: string;
}

/** Material do catálogo da Logística, só o que o orçamento usa (custo médio fica de fora de propósito). */
export interface LogisticsMaterial {
  id: string;
  code: string;
  description: string;
  unit: string | null;
}

const TIMEOUT_MS = 15_000;
export const MIN_SEARCH_LENGTH = 2;
export const MAX_SEARCH_LIMIT = 50;
/** Limite de códigos por consulta da Logística (PT-04). */
export const MAX_CODES_PER_LOOKUP = 200;

@Injectable()
export class LogisticsClient {
  constructor(private readonly config: ConfigService) {}

  private async get<T>(path: string, fetchFn: typeof fetch): Promise<T> {
    const base = (this.config.get<string>('LOGISTICA_API_URL') ?? '').replace(/\/+$/, '');
    const key = this.config.get<string>('LOGISTICA_API_KEY');
    if (!base || !key) throw new ServiceUnavailableException('Integração com a Logística não configurada (LOGISTICA_API_URL e LOGISTICA_API_KEY).');
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new BadGatewayException('A Logística não respondeu. Tente de novo em instantes.');
    }
    if (!res.ok) throw new BadGatewayException(`A Logística recusou a consulta (HTTP ${res.status}).`);
    const body = (await res.json().catch(() => null)) as unknown;
    if (body === null || typeof body !== 'object') throw new BadGatewayException('Resposta inesperada da Logística.');
    return body as T;
  }

  /**
   * Busca por texto no catálogo ativo da Logística (`GET /integration/materials?search=&limit=`, PT-04): casa
   * "contém", sem diferenciar maiúsculas, em código ou descrição; o código igual ao termo vem primeiro. Termo com
   * menos de 2 caracteres não chama a Logística. Mesmo formato de resposta e mesmo filtro de `materialsByCodes`.
   */
  async searchMaterials(term: string, limit = 20, fetchFn: typeof fetch = fetch): Promise<LogisticsMaterial[]> {
    const text = term.trim();
    if (text.length < MIN_SEARCH_LENGTH) return [];
    const size = Math.min(Math.max(Math.trunc(limit) || 20, 1), MAX_SEARCH_LIMIT);
    const body = await this.get<{ items?: unknown }>(`/integration/materials?search=${encodeURIComponent(text)}&limit=${size}`, fetchFn);
    return toMaterials(body);
  }

  /**
   * Materiais pelos códigos (`GET /integration/materials?codes=A,B`, PT-04: até 200 códigos; resposta
   * `{ items, notFound }`). Só volta material ativo, com id, código, descrição e unidade: o custo médio que a
   * Logística também devolve fica de fora de propósito. A rota não busca por texto; o orçamentista informa o código.
   */
  async materialsByCodes(codes: string[], fetchFn: typeof fetch = fetch): Promise<LogisticsMaterial[]> {
    if (codes.length === 0) return [];
    const body = await this.get<{ items?: unknown }>(`/integration/materials?codes=${encodeURIComponent(codes.join(','))}`, fetchFn);
    return toMaterials(body);
  }

  /**
   * Confere códigos na Logística (`GET /integration/materials?codes=`, de 200 em 200). Devolve os que não voltaram
   * como material ativo: inexistentes (`notFound`) ou inativos. Erro de comunicação sobe como a Logística respondeu
   * (`ServiceUnavailableException` sem configuração, `BadGatewayException` fora do ar ou recusando).
   */
  async missingCodes(codes: string[], fetchFn: typeof fetch = fetch): Promise<string[]> {
    const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
    const active = new Set<string>();
    for (let i = 0; i < unique.length; i += MAX_CODES_PER_LOOKUP) {
      const chunk = unique.slice(i, i + MAX_CODES_PER_LOOKUP);
      const body = await this.get<{ items?: unknown }>(`/integration/materials?codes=${encodeURIComponent(chunk.join(','))}`, fetchFn);
      for (const m of toMaterials(body)) active.add(m.code);
    }
    return unique.filter((c) => !active.has(c));
  }

  consumption(month: string, fetchFn: typeof fetch = fetch) {
    return this.get<ConsumptionRow[]>(`/integration/consumption-by-cost-center?month=${encodeURIComponent(month)}`, fetchFn);
  }

  custody(fetchFn: typeof fetch = fetch) {
    return this.get<CustodyRow[]>('/integration/custody-value', fetchFn);
  }
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function toLogisticsMaterial(row: Record<string, unknown>): LogisticsMaterial | null {
  const id = text(row.id);
  const code = text(row.code);
  if (!id || !code) return null;
  return { id, code, description: text(row.shortDescription) ?? text(row.description) ?? code, unit: text(row.unit) };
}

/** `{ items }` da Logística → materiais ativos, só com id, código, descrição e unidade (nunca o custo). */
function toMaterials(body: { items?: unknown }): LogisticsMaterial[] {
  if (!Array.isArray(body.items)) throw new BadGatewayException('Resposta inesperada da Logística.');
  return (body.items as Array<Record<string, unknown>>)
    .filter((row) => row.active !== false)
    .map(toLogisticsMaterial)
    .filter((m): m is LogisticsMaterial => m !== null);
}

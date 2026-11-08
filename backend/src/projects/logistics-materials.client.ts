import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Material da Logística como o Core o usa: o id (para a cotação) e o custo médio (só para estimar o valor). */
export interface LogisticsMaterialInfo {
  id: string;
  code: string;
  /** Texto decimal com 4 casas, ou `null` quando o material ainda não tem custo médio. */
  averageCost: string | null;
}

export type LogisticsLookup =
  | { ok: true; materials: Map<string, LogisticsMaterialInfo>; notFound: string[] }
  | { ok: false; reason: string };

const TIMEOUT_MS = 8_000;
/** `GET /integration/materials?codes=` aceita de 1 a 200 códigos por chamada (docs/integracao-core-logistica.md §4.2). */
const MAX_CODES_PER_CALL = 200;

/**
 * Consulta de materiais da Logística por API key (`GET /integration/materials?codes=`, §4.2 de
 * docs/integracao-core-logistica.md), feita pelo servidor do Core. O custo médio nunca vai ao navegador: serve só
 * para o valor estimado da requisição de envio. **Nunca lança**: se a Logística estiver fora do ar, sem
 * configuração ou responder algo inesperado, devolve `{ ok: false, reason }` e a aprovação do projeto segue com
 * valor estimado 0 e um aviso na requisição.
 */
@Injectable()
export class LogisticsMaterialsClient {
  private readonly logger = new Logger(LogisticsMaterialsClient.name);

  constructor(private readonly config: ConfigService) {}

  async lookup(codes: string[], fetchFn: typeof fetch = fetch): Promise<LogisticsLookup> {
    const unique = [...new Set(codes)];
    const base = (this.config.get<string>('LOGISTICA_API_URL') ?? '').replace(/\/+$/, '');
    const key = this.config.get<string>('LOGISTICA_API_KEY');
    if (!base || !key) return { ok: false, reason: 'Integração com a Logística não configurada (LOGISTICA_API_URL e LOGISTICA_API_KEY).' };

    const materials = new Map<string, LogisticsMaterialInfo>();
    const notFound: string[] = [];
    try {
      for (let i = 0; i < unique.length; i += MAX_CODES_PER_CALL) {
        const chunk = unique.slice(i, i + MAX_CODES_PER_CALL);
        const res = await fetchFn(`${base}/integration/materials?codes=${encodeURIComponent(chunk.join(','))}`, {
          headers: { 'X-Api-Key': key, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false, reason: `A Logística recusou a consulta de materiais (HTTP ${res.status}).` };
        const body = (await res.json().catch(() => null)) as { items?: unknown; notFound?: unknown } | null;
        if (!body || !Array.isArray(body.items)) return { ok: false, reason: 'Resposta inesperada da Logística na consulta de materiais.' };
        for (const raw of body.items as Array<Record<string, unknown>>) {
          if (typeof raw?.id !== 'string' || typeof raw?.code !== 'string') continue;
          const cost = raw.averageCost;
          materials.set(raw.code, {
            id: raw.id,
            code: raw.code,
            averageCost: typeof cost === 'string' && /^\d+(\.\d+)?$/.test(cost) ? cost : typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? String(cost) : null,
          });
        }
        if (Array.isArray(body.notFound)) notFound.push(...body.notFound.filter((c): c is string => typeof c === 'string'));
      }
    } catch (err) {
      this.logger.warn(`Consulta de materiais à Logística falhou: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'A Logística não respondeu à consulta de materiais.' };
    }
    return { ok: true, materials, notFound };
  }
}

import { Prisma } from '@prisma/client';
import type { InboundEvent } from '../inbound-handler.js';

/** Utilitários dos handlers de entrada: leitura tolerante do payload e erros em português (viram o `error` da inbox). */

export type SatelliteKind = 'logistica' | 'field';

const SATELLITE_NAME_PART: Record<SatelliteKind, string> = { logistica: 'logistic', field: 'field' };
const SATELLITE_LABEL: Record<SatelliteKind, string> = { logistica: 'Logística', field: 'Field' };

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Confere de qual satélite veio o evento: `field.*` só vale vindo do Field, `fulfillment.*`/`shipment.*`/`delivery.*`
 * só vindo da Logística. O satélite é identificado pela assinatura/API key (nunca pelo campo `source` do corpo).
 */
export function assertFromSatellite(event: InboundEvent, kind: SatelliteKind): void {
  if (normalize(event.satellite.name).includes(SATELLITE_NAME_PART[kind])) return;
  throw new Error(
    `O evento "${event.eventType}" só é aceito do satélite ${SATELLITE_LABEL[kind]}, mas chegou de "${event.satellite.name}". ` +
      'Confira a chave e o segredo configurados no satélite que está enviando.',
  );
}

export function asText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Texto obrigatório; `label` entra na mensagem de erro. */
export function requireText(event: InboundEvent, field: string): string {
  const value = asText(event.payload[field]);
  if (!value) throw new Error(`Evento "${event.eventType}" sem "${field}" no payload.`);
  return value;
}

export function asInt(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) ? number : null;
}

export function asDecimal(value: unknown): Prisma.Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  try {
    const decimal = new Prisma.Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

export function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `AAAA-MM-DD` → Date em UTC (coluna `DATE`); aceita também um instante ISO (usa a parte da data). */
export function asDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row)) : [];
}

/** Data e hora no fuso de São Paulo, para os comentários (`08/11/2026 14:30`). */
export function formatDateTimeSp(date: Date | null): string {
  if (!date) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(date).replace(',', '');
}

import type { BootLocation, BootMaterial } from './codes';
import { defaultAuthUrl, msUntilExpiry, refreshWithAxis } from './auth';
import type { OpResult, QueueOp } from './queue';

/** Autenticação: SSO do Axis. O token chega por #token=… (hand-off) ou é colado uma vez; nunca há login próprio. */
const SETTINGS_KEY = 'logistica.settings';
export interface Settings { apiUrl: string; authUrl: string; token: string; refreshToken?: string; userEmail?: string; warehouseId?: string; deviceId: string }

const randomDevice = () => `PWA-${(globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)).slice(0, 8).toUpperCase()}`;

export function loadSettings(): Settings {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fromHash = hash.get('token');
  let saved: Partial<Settings> = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>; } catch { /* armazenamento indisponível */ }
  const s: Settings = { apiUrl: saved.apiUrl ?? '/api/v1', authUrl: saved.authUrl ?? defaultAuthUrl(), token: fromHash ?? saved.token ?? '', refreshToken: saved.refreshToken, userEmail: saved.userEmail, warehouseId: saved.warehouseId, deviceId: saved.deviceId ?? randomDevice() };
  if (fromHash) history.replaceState(null, '', location.pathname + location.search); // tira o token da barra de endereços
  saveSettings(s);
  return s;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* sem armazenamento: segue em memória */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Sessão atual: o App a mantém atualizada; a renovação do token acontece aqui e é repassada ao App. */
let session: Settings | null = null;
let onSession: ((s: Settings) => void) | null = null;
let refreshing: Promise<boolean> | null = null;
export function bindSession(get: Settings, listener: (s: Settings) => void) { session = get; onSession = listener; }

/** Renova o token (uma vez, mesmo com várias chamadas simultâneas). Falhou = sessão expirada: o App volta ao login, sem perder a fila. */
function renew(): Promise<boolean> {
  if (!session?.refreshToken) return Promise.resolve(false);
  refreshing ??= (async () => {
    const pair = await refreshWithAxis(session!.authUrl, session!.refreshToken!);
    if (!pair) return false;
    session = { ...session!, token: pair.accessToken, refreshToken: pair.refreshToken };
    saveSettings(session);
    onSession?.(session);
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function call<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  if (!session) throw new ApiError(401, 'Sessão não iniciada.');
  if (!retried && session.refreshToken && msUntilExpiry(session.token) < 30_000) await renew(); // evita o 401 óbvio
  const res = await fetch(`${session.apiUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`, ...(init?.headers ?? {}) } });
  if (res.status === 401 && !retried && (await renew())) return call<T>(path, init, true);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new ApiError(res.status, Array.isArray(body.message) ? body.message.join('; ') : body.message ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface Warehouse { id: string; code: string; name: string }
export interface Bootstrap {
  generatedAt: string;
  warehouseId: string;
  locations: BootLocation[];
  materials: BootMaterial[];
  lots: Array<{ id: string; lotNumber: string; expiresAt: string | null }>;
  pickingTasks: Array<{ id: string; code: string; status: string; priority: number; items: Array<{ id: string; materialId: string; locationId: string; locationCode?: string; lotId: string | null; planned: string; picked: string; status: string }> }>;
  putawayTasks: Array<{ id: string; code: string; materialId: string; lotId: string | null; quantity: string; suggestedLocationId: string | null; suggestedLocationCode: string | null }>;
  countSheets: Array<{ id: string; code: string; round: number; lines: Array<{ id: string; materialId: string; locationId: string; locationCode?: string; lotId: string | null; serialId: string | null; condition: string }> }>;
}

export const api = {
  warehouses: () => call<Warehouse[]>('/warehouses'),
  bootstrap: (warehouseId: string) => call<Bootstrap>(`/sync/bootstrap?warehouseId=${warehouseId}`),
  batch: async (ops: Array<Pick<QueueOp, 'opId' | 'type' | 'payload' | 'clientAt'>>) =>
    (await call<{ results: OpResult[] }>('/sync/batch', { method: 'POST', body: JSON.stringify({ deviceId: session!.deviceId, operations: ops }) })).results,
};

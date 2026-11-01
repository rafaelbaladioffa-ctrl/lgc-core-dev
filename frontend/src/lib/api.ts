import type { BootLocation, BootMaterial } from './codes';
import type { OpResult, QueueOp } from './queue';

/** Autenticação: SSO do Axis. O token chega por #token=… (hand-off) ou é colado uma vez; nunca há login próprio. */
const SETTINGS_KEY = 'logistica.settings';
export interface Settings { apiUrl: string; token: string; warehouseId?: string; deviceId: string }

const randomDevice = () => `PWA-${(globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)).slice(0, 8).toUpperCase()}`;

export function loadSettings(): Settings {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fromHash = hash.get('token');
  let saved: Partial<Settings> = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>; } catch { /* armazenamento indisponível */ }
  const s: Settings = { apiUrl: saved.apiUrl ?? '/api/v1', token: fromHash ?? saved.token ?? '', warehouseId: saved.warehouseId, deviceId: saved.deviceId ?? randomDevice() };
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

async function call<T>(s: Settings, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${s.apiUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}`, ...(init?.headers ?? {}) } });
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
  warehouses: (s: Settings) => call<Warehouse[]>(s, '/warehouses'),
  bootstrap: (s: Settings, warehouseId: string) => call<Bootstrap>(s, `/sync/bootstrap?warehouseId=${warehouseId}`),
  batch: async (s: Settings, ops: Array<Pick<QueueOp, 'opId' | 'type' | 'payload' | 'clientAt'>>) =>
    (await call<{ results: OpResult[] }>(s, '/sync/batch', { method: 'POST', body: JSON.stringify({ deviceId: s.deviceId, operations: ops }) })).results,
};

import { refreshWithAxis, saveSession, type Session } from './auth';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Mensagem para a tela a partir da resposta de erro da API (Nest devolve `message` como texto ou lista). */
export function errorMessage(status: number, body: unknown): string {
  const m = (body as { message?: unknown } | null)?.message;
  const text = Array.isArray(m) ? m.filter((x) => typeof x === 'string').join(' ') : typeof m === 'string' ? m : '';
  if (status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (status === 403) return text || 'Você não tem permissão para esta ação.';
  if (status >= 500) return 'O Financeiro está indisponível no momento. Tente novamente em instantes.';
  return text || 'Não foi possível concluir a operação.';
}

let session: Session | null = null;
let onSessionChange: (s: Session | null) => void = () => {};
let refreshing: Promise<boolean> | null = null;

export function bindSession(current: Session | null, listener: (s: Session | null) => void) {
  session = current;
  onSessionChange = listener;
}

/** Renova uma vez, mesmo com várias chamadas simultâneas. Falhou = sessão encerrada. */
function renew(): Promise<boolean> {
  refreshing ??= (async () => {
    const pair = session ? await refreshWithAxis(session.refreshToken) : null;
    session = pair && session ? { ...session, ...pair } : null;
    saveSession(session);
    onSessionChange(session);
    return session !== null;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'Não foi possível falar com o Financeiro. Verifique a conexão.');
  }
  if (res.status === 401 && retry && session && (await renew())) return api<T>(path, init, false);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, body));
  return body as T;
}

export interface Me {
  userId: string;
  email: string;
  collaboratorId: string | null;
  axisRoles: string[];
  financeRoles: Array<{ code: string; name: string }>;
  permissions: string[];
}

export const getMe = () => api<Me>('/me');

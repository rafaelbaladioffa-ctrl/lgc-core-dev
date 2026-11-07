/**
 * Login com o e-mail e a senha do Axis (especificação §2.1): o frontend chama o login e o refresh do Core
 * por CORS e usa o access token do Core na API do Financeiro. Não há login próprio.
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
  email: string;
}

const SESSION_KEY = 'financeiro.session';

/** URL da API do Core. Em produção vem de VITE_AXIS_URL no build; em dev, o Core local. */
export const axisUrl = () => (import.meta.env?.VITE_AXIS_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');

export function decodeJwt(token: string): { exp?: number; email?: string; sub?: string; mustChangePassword?: boolean } | null {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as { exp?: number };
  } catch {
    return null;
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validação no cliente (a definitiva é do Core), com mensagens por campo. */
export function validateLogin(email: string, password: string): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {};
  if (!email.trim()) errors.email = 'Informe o e-mail.';
  else if (!EMAIL_RE.test(email.trim())) errors.email = 'E-mail inválido.';
  if (!password) errors.password = 'Informe a senha.';
  return errors;
}

/** Mensagem da falha de login, sem revelar se o e-mail existe. */
export function loginErrorMessage(status: number | 'rede', serverMessage?: string): string {
  if (status === 'rede') return 'Não foi possível falar com o Axis. Verifique a conexão e tente de novo.';
  if (status === 400) return 'Confira o e-mail e a senha informados.';
  if (status === 401) return 'E-mail ou senha incorretos.';
  if (status === 403) return serverMessage === 'password' ? 'É necessário trocar a senha no Axis antes de usar o Financeiro.' : 'Seu acesso está bloqueado. Fale com o administrador.';
  if (status === 429) return 'Muitas tentativas. Aguarde um instante e tente de novo.';
  return 'Não foi possível entrar agora. Tente novamente em instantes.';
}

export class LoginError extends Error {
  constructor(
    public status: number | 'rede',
    message: string,
  ) {
    super(message);
  }
}

export async function loginWithAxis(email: string, password: string, fetchFn: typeof fetch = fetch, base = axisUrl()): Promise<Session> {
  let res: Response;
  try {
    res = await fetchFn(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
  } catch {
    throw new LoginError('rede', loginErrorMessage('rede'));
  }
  const body = (await res.json().catch(() => ({}))) as Partial<Session>;
  if (!res.ok) throw new LoginError(res.status, loginErrorMessage(res.status));
  if (!body.accessToken || !body.refreshToken) throw new LoginError(500, loginErrorMessage(500));
  const claims = decodeJwt(body.accessToken);
  if (claims?.mustChangePassword) throw new LoginError(403, loginErrorMessage(403, 'password'));
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, email: claims?.email ?? email.trim() };
}

/** Renova o par de tokens no Core (o refresh é rotacionado a cada uso). `null` = sessão encerrada. */
export async function refreshWithAxis(refreshToken: string, fetchFn: typeof fetch = fetch, base = axisUrl()): Promise<Pick<Session, 'accessToken' | 'refreshToken'> | null> {
  try {
    const res = await fetchFn(`${base}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<Session>;
    return b.accessToken && b.refreshToken ? { accessToken: b.accessToken, refreshToken: b.refreshToken } : null;
  } catch {
    return null;
  }
}

export function loadSession(storage: Pick<Storage, 'getItem'> = localStorage): Session | null {
  try {
    const s = JSON.parse(storage.getItem(SESSION_KEY) ?? 'null') as Partial<Session> | null;
    return s?.accessToken && s.refreshToken && s.email ? (s as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage) {
  try {
    if (s) storage.setItem(SESSION_KEY, JSON.stringify(s));
    else storage.removeItem(SESSION_KEY);
  } catch {
    /* sem armazenamento: a sessão vale só nesta aba */
  }
}

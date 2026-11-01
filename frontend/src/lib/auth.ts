/** Login com o e-mail e a senha do Axis (SSO, PLANNING_LOGISTICA 0.3): o front chama o login do Axis e usa o JWT recebido. */

export interface TokenPair { accessToken: string; refreshToken: string }

/** URL do Axis core (login). Em produção vem de VITE_AXIS_URL no build; em dev, o Axis local. */
export const defaultAuthUrl = () => (import.meta.env?.VITE_AXIS_URL as string | undefined) || 'http://localhost:3000/api/v1';

export function decodeJwt(token: string): { exp?: number; email?: string; sub?: string; mustChangePassword?: boolean } | null {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    return JSON.parse(decodeURIComponent(escape(json))) as { exp?: number };
  } catch {
    return null;
  }
}

/** Milissegundos até o token expirar (negativo se já expirou; 0 se ilegível — trata como vencido). */
export function msUntilExpiry(token: string, now = Date.now()): number {
  const exp = decodeJwt(token)?.exp;
  return exp ? exp * 1000 - now : 0;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validação no cliente (a validação definitiva é do Axis): mensagens em pt-BR por campo. */
export function validateLogin(email: string, password: string): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {};
  if (!email.trim()) errors.email = 'Informe o e-mail.';
  else if (!EMAIL_RE.test(email.trim())) errors.email = 'E-mail inválido.';
  if (!password) errors.password = 'Informe a senha.';
  else if (password.length < 8) errors.password = 'A senha tem no mínimo 8 caracteres.';
  return errors;
}

/** Traduz a falha do login em mensagem para o operador, sem revelar se o e-mail existe. */
export function loginErrorMessage(status: number | 'rede', serverMessage?: string): string {
  if (status === 'rede') return 'Não foi possível falar com o Axis. Verifique a conexão e tente de novo.';
  if (status === 400) return 'Confira o e-mail e a senha informados.';
  if (status === 401) return 'E-mail ou senha incorretos.';
  if (status === 403) return serverMessage?.toLowerCase().includes('password') ? 'É necessário trocar a senha no Axis antes de usar a Logística.' : 'Seu acesso está bloqueado. Fale com o administrador.';
  if (status === 429) return 'Muitas tentativas. Aguarde um instante e tente de novo.';
  return 'Não foi possível entrar agora. Tente novamente em instantes.';
}

export class LoginError extends Error {
  constructor(public status: number | 'rede', message: string) { super(message); }
}

export async function loginWithAxis(authUrl: string, email: string, password: string, fetchFn: typeof fetch = fetch): Promise<TokenPair & { email: string; mustChangePassword: boolean }> {
  let res: Response;
  try {
    res = await fetchFn(`${authUrl.replace(/\/$/, '')}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
  } catch {
    throw new LoginError('rede', loginErrorMessage('rede'));
  }
  const body = (await res.json().catch(() => ({}))) as Partial<TokenPair> & { message?: string | string[] };
  if (!res.ok) throw new LoginError(res.status, loginErrorMessage(res.status, Array.isArray(body.message) ? body.message.join(' ') : body.message));
  if (!body.accessToken || !body.refreshToken) throw new LoginError(500, loginErrorMessage(500));
  const claims = decodeJwt(body.accessToken);
  if (claims?.mustChangePassword) throw new LoginError(403, loginErrorMessage(403, 'password'));
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, email: claims?.email ?? email.trim(), mustChangePassword: false };
}

/** Renova o par de tokens com o refresh token (o Axis rotaciona o refresh a cada uso). */
export async function refreshWithAxis(authUrl: string, refreshToken: string, fetchFn: typeof fetch = fetch): Promise<TokenPair | null> {
  try {
    const res = await fetchFn(`${authUrl.replace(/\/$/, '')}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<TokenPair>;
    return b.accessToken && b.refreshToken ? { accessToken: b.accessToken, refreshToken: b.refreshToken } : null;
  } catch {
    return null;
  }
}

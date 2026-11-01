import { describe, expect, it, vi } from 'vitest';
import { decodeJwt, loginErrorMessage, loginWithAxis, msUntilExpiry, refreshWithAxis, validateLogin } from './auth';

const b64 = (o: object) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: object) => `${b64({ alg: 'HS256' })}.${b64(claims)}.assinatura`;
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('JWT', () => {
  it('lê claims e calcula o tempo até expirar; token ilegível conta como vencido', () => {
    const t = jwt({ exp: 2000, email: 'a@b.co' });
    expect(decodeJwt(t)).toMatchObject({ email: 'a@b.co' });
    expect(msUntilExpiry(t, 1_000_000)).toBe(1_000_000);
    expect(msUntilExpiry(t, 3_000_000)).toBe(-1_000_000);
    expect(msUntilExpiry('lixo')).toBe(0);
    expect(decodeJwt('a.b.c')).toBeNull();
  });
  it('aceita acentos no payload', () => expect(decodeJwt(jwt({ email: 'josé@lgc.com' }))?.email).toBe('josé@lgc.com'));
});

describe('validateLogin', () => {
  it('mensagens em pt-BR por campo', () => {
    expect(validateLogin('', '')).toEqual({ email: 'Informe o e-mail.', password: 'Informe a senha.' });
    expect(validateLogin('sem-arroba', '12345678').email).toBe('E-mail inválido.');
    expect(validateLogin('a@b.co', '1234567').password).toBe('A senha tem no mínimo 8 caracteres.');
    expect(validateLogin(' a@b.co ', '12345678')).toEqual({});
  });
});

describe('loginWithAxis', () => {
  it('chama POST /auth/login do Axis com e-mail aparado e devolve os tokens', async () => {
    const f = vi.fn(async () => res(200, { accessToken: jwt({ exp: 9e9, email: 'a@b.co' }), refreshToken: 'r1' }));
    const r = await loginWithAxis('http://axis/api/v1/', ' a@b.co ', 'senha-forte', f as never);
    expect(f).toHaveBeenCalledWith('http://axis/api/v1/auth/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@b.co', password: 'senha-forte' }) }));
    expect(r).toMatchObject({ email: 'a@b.co', refreshToken: 'r1' });
  });
  it('401 vira mensagem genérica, rede vira mensagem de conexão, senha temporária exige troca no Axis', async () => {
    await expect(loginWithAxis('http://x', 'a@b.co', 'errada123', (async () => res(401, { message: 'Invalid credentials' })) as never)).rejects.toMatchObject({ status: 401, message: 'E-mail ou senha incorretos.' });
    await expect(loginWithAxis('http://x', 'a@b.co', 'x12345678', (async () => { throw new Error('Failed to fetch'); }) as never)).rejects.toMatchObject({ status: 'rede' });
    const temp = jwt({ exp: 9e9, email: 'a@b.co', mustChangePassword: true });
    await expect(loginWithAxis('http://x', 'a@b.co', 'x12345678', (async () => res(200, { accessToken: temp, refreshToken: 'r' })) as never)).rejects.toMatchObject({ status: 403, message: expect.stringContaining('trocar a senha') });
    await expect(loginWithAxis('http://x', 'a@b.co', 'x12345678', (async () => res(200, {})) as never)).rejects.toMatchObject({ status: 500 });
  });
  it('mensagens por status', () => {
    expect(loginErrorMessage(429)).toMatch(/Muitas tentativas/);
    expect(loginErrorMessage(400)).toMatch(/Confira/);
    expect(loginErrorMessage(503)).toMatch(/Tente novamente/);
    expect(loginErrorMessage(403, 'x')).toMatch(/bloqueado/);
  });
});

describe('refreshWithAxis', () => {
  it('devolve o novo par ou null se o refresh foi recusado ou a rede falhou', async () => {
    expect(await refreshWithAxis('http://x', 'r', (async () => res(200, { accessToken: 'a', refreshToken: 'b' })) as never)).toEqual({ accessToken: 'a', refreshToken: 'b' });
    expect(await refreshWithAxis('http://x', 'r', (async () => res(401, {})) as never)).toBeNull();
    expect(await refreshWithAxis('http://x', 'r', (async () => { throw new Error('x'); }) as never)).toBeNull();
    expect(await refreshWithAxis('http://x', 'r', (async () => res(200, { accessToken: 'a' })) as never)).toBeNull();
  });
});

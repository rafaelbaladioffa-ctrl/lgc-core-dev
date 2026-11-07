import { errorMessage } from './api';
import { decodeJwt, loadSession, LoginError, loginWithAxis, refreshWithAxis, validateLogin } from './auth';
import { formatBRL, formatDate, formatDateTime } from './format';

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const token = (claims: object) => `h.${b64(claims)}.s`;
const respond = (status: number, body: unknown) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe('login no Core', () => {
  it('valida e-mail e senha antes de chamar o Core', () => {
    expect(validateLogin('', '')).toEqual({ email: 'Informe o e-mail.', password: 'Informe a senha.' });
    expect(validateLogin('ana@', 'x')).toEqual({ email: 'E-mail inválido.' });
    expect(validateLogin('ana@lgc.com.br', 'segredo')).toEqual({});
  });

  it('devolve a sessão com o e-mail do token', async () => {
    const fetchFn = respond(200, { accessToken: token({ email: 'ana@lgc.com.br' }), refreshToken: 'r1' });
    const s = await loginWithAxis(' ana@lgc.com.br ', 'segredo', fetchFn, 'http://core/api/v1');
    expect(s.email).toBe('ana@lgc.com.br');
    expect(fetchFn).toHaveBeenCalledWith('http://core/api/v1/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('traduz as falhas sem revelar se o e-mail existe', async () => {
    await expect(loginWithAxis('a@b.co', 'x', respond(401, {}), 'u')).rejects.toThrow('E-mail ou senha incorretos.');
    await expect(loginWithAxis('a@b.co', 'x', vi.fn().mockRejectedValue(new Error('down')), 'u')).rejects.toBeInstanceOf(LoginError);
  });

  it('bloqueia quem precisa trocar a senha no Axis', async () => {
    const fetchFn = respond(200, { accessToken: token({ email: 'a@b.co', mustChangePassword: true }), refreshToken: 'r' });
    await expect(loginWithAxis('a@b.co', 'x', fetchFn, 'u')).rejects.toThrow('É necessário trocar a senha no Axis antes de usar o Financeiro.');
  });

  it('refresh com falha encerra a sessão', async () => {
    expect(await refreshWithAxis('r', respond(401, {}), 'u')).toBeNull();
    expect(await refreshWithAxis('r', respond(200, { accessToken: 'a', refreshToken: 'b' }), 'u')).toEqual({ accessToken: 'a', refreshToken: 'b' });
  });

  it('decodifica claims com acentos e ignora token ilegível', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ email: 'joão@lgc.com.br' }));
    const t = `h.${btoa(String.fromCharCode(...bytes)).replace(/=+$/, '')}.s`;
    expect(decodeJwt(t)?.email).toBe('joão@lgc.com.br');
    expect(decodeJwt('lixo')).toBeNull();
  });

  it('sessão salva incompleta é descartada', () => {
    expect(loadSession({ getItem: () => JSON.stringify({ accessToken: 'a' }) })).toBeNull();
    expect(loadSession({ getItem: () => '{' })).toBeNull();
  });
});

describe('mensagens de erro da API', () => {
  it('usa a mensagem do servidor e cobre sessão expirada e indisponibilidade', () => {
    expect(errorMessage(400, { message: ['Perfis repetidos.'] })).toBe('Perfis repetidos.');
    expect(errorMessage(403, { message: 'Permissão insuficiente. Necessário: rbac:read.' })).toBe('Permissão insuficiente. Necessário: rbac:read.');
    expect(errorMessage(401, null)).toBe('Sua sessão expirou. Entre novamente.');
    expect(errorMessage(502, null)).toBe('O Financeiro está indisponível no momento. Tente novamente em instantes.');
  });
});

describe('formatação', () => {
  it('formata moeda, data de negócio e instante em São Paulo', () => {
    expect(formatBRL('1234.5')).toBe('R$ 1.234,50'.replace(' ', ' '));
    expect(formatBRL(null)).toBe('—');
    expect(formatDate('2026-12-01')).toBe('01/12/2026');
    expect(formatDateTime('2026-11-07T03:30:00Z')).toBe('07/11/2026 00:30');
  });
});

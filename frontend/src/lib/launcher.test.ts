import { describe, expect, it, vi } from 'vitest';
import { exchangeLauncherToken, takeLauncherToken } from './auth';

const TOKEN = 'a'.repeat(30) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(10);
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('takeLauncherToken (botão "Abrir" do Axis)', () => {
  it('lê axisToken e o remove da URL na hora, preservando os demais parâmetros e o hash', () => {
    const hist = { replaceState: vi.fn() };
    const t = takeLauncherToken({ search: `?axisToken=${TOKEN}&x=1`, pathname: '/app', hash: '#h' }, hist);
    expect(t).toBe(TOKEN);
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/app?x=1#h');
  });
  it('sem parâmetro não mexe na URL; com parâmetro vazio/curto remove mas não aceita', () => {
    const hist = { replaceState: vi.fn() };
    expect(takeLauncherToken({ search: '?x=1', pathname: '/', hash: '' }, hist)).toBeNull();
    expect(hist.replaceState).not.toHaveBeenCalled();
    expect(takeLauncherToken({ search: '?axisToken=curto', pathname: '/', hash: '' }, hist)).toBeNull();
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/');
  });
});

describe('exchangeLauncherToken', () => {
  it('envia o token ao backend da Logística (sem Authorization) e devolve a sessão', async () => {
    const f = vi.fn(async () => res(200, { accessToken: 'sessao', email: 'a@b.co', expiresIn: 28800 }));
    const r = await exchangeLauncherToken('/api/v1/', TOKEN, f as never);
    expect(f).toHaveBeenCalledWith('/api/v1/auth/exchange', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: TOKEN }) }));
    expect((f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers).not.toHaveProperty('Authorization');
    expect(r).toEqual({ accessToken: 'sessao', email: 'a@b.co' });
  });
  it('token expirado/inválido cai para o login normal com mensagem; senha temporária e rede têm mensagem própria', async () => {
    await expect(exchangeLauncherToken('/api', TOKEN, (async () => res(401, {})) as never)).rejects.toMatchObject({ status: 401, message: expect.stringContaining('e-mail e senha') });
    await expect(exchangeLauncherToken('/api', TOKEN, (async () => res(403, {})) as never)).rejects.toMatchObject({ message: expect.stringContaining('trocar a senha') });
    await expect(exchangeLauncherToken('/api', TOKEN, (async () => { throw new Error('x'); }) as never)).rejects.toMatchObject({ status: 'rede' });
    await expect(exchangeLauncherToken('/api', TOKEN, (async () => res(200, {})) as never)).rejects.toMatchObject({ status: 200 });
  });
});

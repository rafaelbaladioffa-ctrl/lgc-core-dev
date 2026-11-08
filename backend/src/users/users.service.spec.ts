import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service.js';

/** Criação de usuário: conflitos de e-mail e de colaborador viram 409 com mensagem em pt-BR, não 500. */

const COLLABORATOR = { id: 'col-1', fullName: 'Fulano', matricula: '0001', corporateEmail: 'fulano@lgc.com.br' };
const ROLE_ID = '11111111-1111-4111-8111-111111111111';

function fixture() {
  const prisma: any = {
    collaborator: { findUnique: vi.fn().mockResolvedValue(COLLABORATOR) },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }) => ({
        id: 'usr-1',
        email: data.email,
        collaboratorId: data.collaboratorId,
        status: 'active',
        mustChangePassword: true,
        lastLoginAt: null,
        createdAt: new Date(),
        collaborator: COLLABORATOR,
        userRoles: [{ role: { id: ROLE_ID, name: 'gestor', description: null } }],
      })),
    },
    role: { findMany: vi.fn().mockResolvedValue([{ id: ROLE_ID }]) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  return { service: new UsersService(prisma, outbox as any), prisma, outbox };
}

const DTO = { collaboratorId: COLLABORATOR.id, roleIds: [ROLE_ID], temporaryPassword: '12345678' };

describe('UsersService.create', () => {
  it('cria o usuário com o e-mail corporativo quando o e-mail não é informado', async () => {
    const { service, prisma } = fixture();
    const result = await service.create(DTO);
    expect(prisma.user.create.mock.calls[0][0].data.email).toBe(COLLABORATOR.corporateEmail);
    expect(result.temporaryPassword).toBe('12345678');
  });

  it('recusa e-mail já usado por outra conta (mesmo desativada), sem diferenciar maiúsculas', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockResolvedValue({ id: 'old' });
    await expect(service.create({ ...DTO, email: 'FULANO@lgc.com.br' })).rejects.toThrow(
      new ConflictException('Já existe um usuário com este e-mail. Use outro e-mail ou reative o usuário existente.'),
    );
    expect(prisma.user.findFirst.mock.calls[0][0].where.email).toEqual({ equals: 'FULANO@lgc.com.br', mode: 'insensitive' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('recusa colaborador que já tem usuário', async () => {
    const { service, prisma } = fixture();
    prisma.user.findUnique.mockResolvedValue({ id: 'old' });
    await expect(service.create(DTO)).rejects.toThrow(new ConflictException('Este colaborador já tem um usuário de acesso.'));
  });

  it('violação de unicidade no insert (corrida) vira 409, não 500', async () => {
    const { service, prisma } = fixture();
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['email'] } }),
    );
    await expect(service.create(DTO)).rejects.toBeInstanceOf(ConflictException);
  });
});

/** Eventos `user.*` (contrato V1, docs/mapa-interoperabilidade.md §6): estado completo, na mesma transação da escrita. */
describe('UsersService: eventos user.*', () => {
  const stored = (status: 'active' | 'disabled', roles = ['gestor']) => ({
    id: 'usr-1',
    email: 'fulano@lgc.com.br',
    collaboratorId: COLLABORATOR.id,
    status,
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: new Date(),
    collaborator: COLLABORATOR,
    userRoles: roles.map((name) => ({ role: { id: `r-${name}`, name, description: null } })),
  });

  function withExisting(status: 'active' | 'disabled') {
    const f = fixture();
    let current = stored(status);
    f.prisma.user.findUnique.mockImplementation(async () => current);
    f.prisma.user.findUniqueOrThrow = vi.fn(async () => current);
    f.prisma.user.update = vi.fn(async ({ data }: any) => (current = { ...current, ...data }));
    f.prisma.userRole = {
      deleteMany: vi.fn(),
      createMany: vi.fn(async () => {
        current = stored(current.status, ['gestor', 'financeiro']);
      }),
    };
    return f;
  }

  it('criar grava user.created com e-mail, nome do colaborador, papéis e active', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create(DTO);
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'user.created', {
      user_id: 'usr-1',
      email: COLLABORATOR.corporateEmail,
      name: 'Fulano',
      status: 'active',
      active: true,
      collaborator_id: COLLABORATOR.id,
      roles: ['gestor'],
    });
  });

  it('trocar papéis grava user.updated com os papéis novos', async () => {
    const { service, prisma, outbox } = withExisting('active');
    prisma.role.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await service.updateRoles('usr-1', { roleIds: ['a', 'b'] });
    expect(outbox.record).toHaveBeenCalledTimes(1);
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'user.updated', expect.objectContaining({ user_id: 'usr-1', roles: ['gestor', 'financeiro'], active: true }));
  });

  it('desativar grava user.disabled com status disabled e active false', async () => {
    const { service, prisma, outbox } = withExisting('active');
    await service.setStatus('usr-1', { status: 'disabled' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'user.disabled', {
      user_id: 'usr-1',
      email: 'fulano@lgc.com.br',
      name: 'Fulano',
      status: 'disabled',
      active: false,
      collaborator_id: COLLABORATOR.id,
      roles: ['gestor'],
    });
  });

  it('reativar grava user.updated com active true', async () => {
    const { service, prisma, outbox } = withExisting('disabled');
    await service.setStatus('usr-1', { status: 'active' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'user.updated', expect.objectContaining({ status: 'active', active: true }));
  });

  it('usuário sem colaborador usa o e-mail como nome', async () => {
    const { userEventPayload } = await import('./users.service.js');
    expect(userEventPayload({ id: 'u', email: 'x@lgc.com.br', status: 'active', collaboratorId: null, collaborator: null, userRoles: [] })).toMatchObject({
      name: 'x@lgc.com.br',
      collaborator_id: null,
      roles: [],
    });
  });
});

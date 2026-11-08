import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SetUserStatusDto } from './dto/set-user-status.dto.js';

const INCLUDE = {
  collaborator: { select: { id: true, fullName: true, matricula: true, corporateEmail: true } },
  userRoles: { include: { role: true } },
} as const;

const EMAIL_IN_USE = 'Já existe um usuário com este e-mail. Use outro e-mail ou reative o usuário existente.';
const COLLABORATOR_HAS_USER = 'Este colaborador já tem um usuário de acesso.';

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof INCLUDE }>;

/**
 * Estado completo do usuário em `user.created`, `user.updated` e `user.disabled` (os satélites substituem o
 * cache `USER` a cada evento). `name` é o nome do colaborador ou, sem colaborador, o e-mail; `roles` são os
 * nomes dos papéis. Contrato: docs/dominio/cadastros.md e docs/mapa-interoperabilidade.md §6.
 */
export function userEventPayload(user: Pick<UserWithRelations, 'id' | 'email' | 'status' | 'collaboratorId'> & {
  collaborator: { fullName: string } | null;
  userRoles: Array<{ role: { name: string } }>;
}): Record<string, unknown> {
  return {
    user_id: user.id,
    email: user.email,
    name: user.collaborator?.fullName ?? user.email,
    status: user.status,
    active: user.status === 'active',
    collaborator_id: user.collaboratorId,
    roles: user.userRoles.map((ur) => ur.role.name),
  };
}

/** `user.disabled` quando o usuário fica desativado; qualquer outra mudança (papéis, reativação) é `user.updated`. */
export function userEventType(status: string): 'user.updated' | 'user.disabled' {
  return status === 'disabled' ? 'user.disabled' : 'user.updated';
}

/** Generated once, shown to the admin/RH a single time to hand to the collaborator (no SMTP yet, PLANNING.md 4.7). */
function generateTemporaryPassword(): string {
  return randomBytes(9).toString('base64url');
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateUserDto) {
    const collaborator = await this.prisma.collaborator.findUnique({ where: { id: dto.collaboratorId } });
    if (!collaborator) throw new BadRequestException('Collaborator not found');

    const existingUser = await this.prisma.user.findUnique({ where: { collaboratorId: dto.collaboratorId } });
    if (existingUser) throw new ConflictException(COLLABORATOR_HAS_USER);

    const roles = await this.prisma.role.findMany({ where: { id: { in: dto.roleIds } } });
    if (roles.length !== dto.roleIds.length) throw new BadRequestException('One or more roles not found');

    const email = dto.email ?? collaborator.corporateEmail;
    const emailInUse = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (emailInUse) throw new ConflictException(EMAIL_IN_USE);

    const temporaryPassword = dto.temporaryPassword ?? generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            collaboratorId: collaborator.id,
            mustChangePassword: true,
            userRoles: { createMany: { data: dto.roleIds.map((roleId) => ({ roleId })) } },
          },
          include: INCLUDE,
        });
        await this.outbox.record(tx, 'user.created', userEventPayload(created));
        return created;
      });
    } catch (err) {
      // Corrida entre a verificação acima e o insert: o índice único decide.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = JSON.stringify(err.meta?.target ?? '');
        throw new ConflictException(target.includes('collaborator') ? COLLABORATOR_HAS_USER : EMAIL_IN_USE);
      }
      throw err;
    }

    // Returned once — the admin/RH copies it to hand to the collaborator; never retrievable again.
    return { ...this.toSafeView(user), temporaryPassword };
  }

  async findAll(filters: { status?: 'active' | 'disabled'; roleId?: string; search?: string }) {
    const users = await this.prisma.user.findMany({
      where: {
        status: filters.status,
        // Fora o usuário técnico "Axis (automático)" (sem login), que não é uma conta de pessoa.
        NOT: { collaborator: { isSystem: true } },
        userRoles: filters.roleId ? { some: { roleId: filters.roleId } } : undefined,
        OR: filters.search
          ? [
              { email: { contains: filters.search, mode: 'insensitive' } },
              { collaborator: { fullName: { contains: filters.search, mode: 'insensitive' } } },
              { collaborator: { matricula: { contains: filters.search, mode: 'insensitive' } } },
            ]
          : undefined,
      },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => this.toSafeView(u));
  }

  async findOne(id: string) {
    const user = await this.getOrThrow(id);
    return this.toSafeView(user);
  }

  async updateRoles(id: string, dto: UpdateUserRolesDto) {
    await this.getOrThrow(id);
    const roles = await this.prisma.role.findMany({ where: { id: { in: dto.roleIds } } });
    if (roles.length !== dto.roleIds.length) throw new BadRequestException('One or more roles not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: dto.roleIds.map((roleId) => ({ userId: id, roleId })) });
      const user = await tx.user.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      await this.outbox.record(tx, userEventType(user.status), userEventPayload(user));
      return user;
    });
    return this.toSafeView(updated);
  }

  async resetPassword(id: string, dto: ResetPasswordDto) {
    await this.getOrThrow(id);
    const temporaryPassword = dto.temporaryPassword ?? generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
    return { temporaryPassword };
  }

  async setStatus(id: string, dto: SetUserStatusDto) {
    await this.getOrThrow(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data: { status: dto.status }, include: INCLUDE });
      await this.outbox.record(tx, userEventType(user.status), userEventPayload(user));
      return user;
    });
    return this.toSafeView(updated);
  }

  private async getOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: INCLUDE });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private toSafeView(
    user: Awaited<ReturnType<PrismaService['user']['findUniqueOrThrow']>> & {
      collaborator: { id: string; fullName: string; matricula: string; corporateEmail: string } | null;
      userRoles: Array<{ role: { id: string; name: string; description: string | null } }>;
    },
  ) {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      mustChangePassword: user.mustChangePassword,
      collaboratorId: user.collaboratorId,
      collaboratorName: user.collaborator?.fullName ?? null,
      collaboratorMatricula: user.collaborator?.matricula ?? null,
      roles: user.userRoles.map((ur) => ur.role),
      createdAt: user.createdAt,
    };
  }
}

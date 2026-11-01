import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateDelegationDto } from './dto/create-delegation.dto.js';

@Injectable()
export class DelegationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nunca retroativa (§9.1/§21.2: "não podem ser retroativas") — `startsAt` tem que ser agora ou
   * no futuro. `approvedBy` é o próprio delegador, criando a delegação da sua alçada. */
  create(delegatorId: string, dto: CreateDelegationDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (startsAt.getTime() < Date.now() - 60_000) throw new BadRequestException('Delegação não pode começar no passado');
    if (endsAt <= startsAt) throw new BadRequestException('Data de término deve ser depois do início');

    return this.prisma.delegation.create({
      data: { delegatorId, delegateId: dto.delegateId, sectorId: dto.sectorId, startsAt, endsAt, approvedBy: delegatorId },
    });
  }

  findMine(collaboratorId: string) {
    return this.prisma.delegation.findMany({
      where: { OR: [{ delegatorId: collaboratorId }, { delegateId: collaboratorId }] },
      orderBy: { startsAt: 'desc' },
    });
  }

  async revoke(id: string, actorId: string) {
    const delegation = await this.prisma.delegation.findUnique({ where: { id } });
    if (!delegation) throw new NotFoundException('Delegação não encontrada');
    if (delegation.delegatorId !== actorId) throw new ForbiddenException('Somente quem delegou pode revogar');
    return this.prisma.delegation.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /** Usado por RequestsService.approve/reject: alguém pode decidir "em nome de" outro aprovador
   * quando existe uma delegação ativa, não revogada, dentro da janela e (se com escopo de setor)
   * o setor da requisição bate (§9.1, §21.2 — expirada/fora de escopo é recusada). */
  async findActiveDelegate(delegatorId: string, actingAs: string, sectorId: string): Promise<boolean> {
    const now = new Date();
    const delegation = await this.prisma.delegation.findFirst({
      where: {
        delegatorId,
        delegateId: actingAs,
        revokedAt: null,
        startsAt: { lte: now },
        endsAt: { gte: now },
        OR: [{ sectorId: null }, { sectorId }],
      },
    });
    return delegation !== null;
  }
}

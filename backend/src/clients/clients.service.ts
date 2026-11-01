import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateClientDto) {
    return this.prisma.$transaction(async (tx) => {
      // nextval() on a native Postgres sequence is atomic, so concurrent creates
      // never hand out the same client code (see migration 20261030000000_clients_projects).
      const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('client_code_seq') AS nextval`;
      const code = Number(rows[0].nextval);

      const client = await tx.client.create({
        data: {
          code,
          legalName: dto.legalName,
          cnpj: dto.cnpj,
          contacts: dto.contacts as Prisma.InputJsonValue | undefined,
          address: dto.address as Prisma.InputJsonValue | undefined,
        },
      });
      await this.outbox.record(tx, 'client.created', { client_id: client.id, code: client.code });
      return client;
    });
  }

  findAll() {
    return this.prisma.client.findMany({ orderBy: { code: 'asc' } });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id },
        data: {
          legalName: dto.legalName,
          cnpj: dto.cnpj,
          contacts: dto.contacts as Prisma.InputJsonValue | undefined,
          address: dto.address as Prisma.InputJsonValue | undefined,
        },
      });
      await this.outbox.record(tx, 'client.updated', { client_id: client.id, changed_fields: Object.keys(dto) });
      return client;
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.client.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('Cannot delete a client that still has linked projects');
      }
      throw err;
    }
  }
}

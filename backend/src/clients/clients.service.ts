import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';
import { Prisma, type Client } from '@prisma/client';

/**
 * Campos da escrita comuns a criar e editar. `undefined` não altera; `null` limpa o valor.
 * UF sempre em maiúsculas.
 */
function toClientData(dto: UpdateClientDto) {
  return {
    legalName: dto.legalName,
    tradeName: dto.tradeName,
    cnpj: dto.cnpj,
    phone: dto.phone,
    email: dto.email,
    cep: dto.cep,
    addressStreet: dto.addressStreet,
    addressNumber: dto.addressNumber,
    addressComplement: dto.addressComplement,
    addressDistrict: dto.addressDistrict,
    addressCity: dto.addressCity,
    addressState: dto.addressState?.toUpperCase() ?? dto.addressState,
    contacts: dto.contacts as Prisma.InputJsonValue | undefined,
    address: dto.address as Prisma.InputJsonValue | undefined,
  };
}

function rethrowDuplicateCnpj(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new ConflictException('A client with this CNPJ already exists');
  }
  throw err;
}

/**
 * Estado completo do cliente enviado em `client.created` e `client.updated` (os satélites substituem o
 * cache inteiro a cada evento). `name` repete a razão social para os caches genéricos que leem `name`.
 * Contrato: docs/dominio/cadastros.md §9 e docs/mapa-interoperabilidade.md §6.
 */
export function clientEventPayload(client: Client): Record<string, unknown> {
  return {
    client_id: client.id,
    code: client.code,
    name: client.legalName,
    legal_name: client.legalName,
    trade_name: client.tradeName,
    cnpj: client.cnpj,
    phone: client.phone,
    email: client.email,
    cep: client.cep,
    address_street: client.addressStreet,
    address_number: client.addressNumber,
    address_complement: client.addressComplement,
    address_district: client.addressDistrict,
    address_city: client.addressCity,
    address_state: client.addressState,
    active: true,
  };
}

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
          ...toClientData(dto),
          legalName: dto.legalName,
        },
      });
      await this.outbox.record(tx, 'client.created', clientEventPayload(client));
      return client;
    }).catch(rethrowDuplicateCnpj);
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
          ...toClientData(dto),
        },
      });
      await this.outbox.record(tx, 'client.updated', { ...clientEventPayload(client), changed_fields: Object.keys(dto) });
      return client;
    }).catch(rethrowDuplicateCnpj);
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.$transaction(async (tx) => {
        const client = await tx.client.delete({ where: { id } });
        await this.outbox.record(tx, 'client.deleted', { client_id: client.id, code: client.code, active: false, deleted: true });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('Cannot delete a client that still has linked projects');
      }
      throw err;
    }
  }
}

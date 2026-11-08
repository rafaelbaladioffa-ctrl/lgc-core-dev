import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Site } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateSiteDto } from './dto/create-site.dto.js';
import { UpdateSiteDto } from './dto/update-site.dto.js';

/** Campos do site que um `PUT` pode alterar (a ordem define `changed_fields` do evento). */
const EDITABLE_FIELDS = [
  'code',
  'name',
  'cep',
  'addressStreet',
  'addressNumber',
  'addressComplement',
  'addressDistrict',
  'addressCity',
  'addressState',
  'latitude',
  'longitude',
  'active',
] as const satisfies ReadonlyArray<keyof Site>;

/**
 * Estado completo do site enviado em todo evento `site.*` (os satélites guardam o último snapshot
 * no cache, então cada evento traz tudo). Contrato: docs/dominio/cadastros.md §9.1.
 */
export function siteEventPayload(site: Site): Record<string, unknown> {
  return {
    site_id: site.id,
    client_id: site.clientId,
    code: site.code,
    name: site.name,
    cep: site.cep,
    address_street: site.addressStreet,
    address_number: site.addressNumber,
    address_complement: site.addressComplement,
    address_district: site.addressDistrict,
    address_city: site.addressCity,
    address_state: site.addressState,
    latitude: site.latitude,
    longitude: site.longitude,
    active: site.active,
  };
}

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Lista por código; `clientId` e `active` filtram no servidor (o seletor do projeto usa os dois). */
  findAll(filter: { clientId?: string; active?: boolean } = {}) {
    return this.prisma.site.findMany({
      where: { clientId: filter.clientId, active: filter.active },
      orderBy: [{ clientId: 'asc' }, { code: 'asc' }],
    });
  }

  async findOne(id: string) {
    const site = await this.prisma.site.findUnique({ where: { id } });
    if (!site) throw new NotFoundException('Site não encontrado.');
    return site;
  }

  async create(dto: CreateSiteDto) {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId }, select: { id: true } });
    if (!client) throw new BadRequestException('Cliente não encontrado.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const site = await tx.site.create({
          data: {
            clientId: dto.clientId,
            code: dto.code,
            name: dto.name,
            cep: dto.cep ?? null,
            addressStreet: dto.addressStreet ?? null,
            addressNumber: dto.addressNumber ?? null,
            addressComplement: dto.addressComplement ?? null,
            addressDistrict: dto.addressDistrict ?? null,
            addressCity: dto.addressCity ?? null,
            addressState: dto.addressState ?? null,
            latitude: dto.latitude ?? null,
            longitude: dto.longitude ?? null,
          },
        });
        await this.outbox.record(tx, 'site.created', siteEventPayload(site));
        return site;
      });
    } catch (err) {
      throw this.translateUniqueViolation(err);
    }
  }

  async update(id: string, dto: UpdateSiteDto) {
    const current = await this.findOne(id);
    if (dto.code === null || dto.name === null) {
      throw new BadRequestException('O código e o nome do site não podem ficar vazios.');
    }
    // Só o que veio no corpo e mudou de verdade vai para o banco e para `changed_fields`.
    const data: Prisma.SiteUpdateInput = {};
    const changed: string[] = [];
    for (const field of EDITABLE_FIELDS) {
      const value = dto[field];
      if (value !== undefined && value !== current[field]) {
        (data as Record<string, unknown>)[field] = value;
        changed.push(field);
      }
    }
    if (changed.length === 0) return current;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const site = await tx.site.update({ where: { id }, data });
        await this.outbox.record(tx, 'site.updated', { ...siteEventPayload(site), changed_fields: changed });
        return site;
      });
    } catch (err) {
      throw this.translateUniqueViolation(err);
    }
  }

  private translateUniqueViolation(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('Já existe um site com este código para o cliente.');
    }
    return err;
  }
}

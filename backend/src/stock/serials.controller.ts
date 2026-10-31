import { BadRequestException, Body, ConflictException, Controller, Get, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

class CreateSerialDto {
  @IsUUID('all', { message: 'Material inválido.' }) materialId!: string;
  @IsString({ message: 'Informe o número de série.' }) @MinLength(1) @MaxLength(80) serial!: string;
  @IsOptional() @IsString() @MaxLength(40) assetTag?: string;
  @IsOptional() @IsUUID('all', { message: 'Lote inválido.' }) lotId?: string;
}

class ListSerialsQuery {
  @IsOptional() @IsUUID('all') materialId?: string;
  @IsOptional() @IsString() q?: string;
}

@Controller('serial-numbers')
export class SerialsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('stock:read')
  list(@Query() q: ListSerialsQuery) {
    return this.prisma.serialNumber.findMany({
      where: { ...(q.materialId && { materialId: q.materialId }), ...(q.q && { OR: [{ serial: { contains: q.q, mode: 'insensitive' } }, { assetTag: { contains: q.q, mode: 'insensitive' } }] }) },
      orderBy: { serial: 'asc' },
      take: 200,
    });
  }

  /** O cadastro não coloca o item em estoque: isso é feito por um movimento de entrada. Série única por material (11.7). */
  @Post()
  @RequirePermissions('serial:write')
  async create(@Body() dto: CreateSerialDto, @CurrentUser() user: AuthenticatedUser) {
    const material = await this.prisma.material.findUnique({ where: { id: dto.materialId } });
    if (!material) throw new BadRequestException('Material não encontrado.');
    if (!material.serialControlled) throw new BadRequestException('Este material não é controlado por número de série.');
    if (dto.assetTag && !material.assetTagged) throw new BadRequestException('Este material não é controlado por patrimônio.');
    if (dto.lotId) {
      const lot = await this.prisma.lot.findUnique({ where: { id: dto.lotId } });
      if (!lot || lot.materialId !== material.id) throw new BadRequestException('Lote não pertence ao material informado.');
    }
    try {
      const serial = await this.prisma.serialNumber.create({ data: { ...dto, createdBy: user.userId } });
      await this.audit.record(user.userId, 'serial.created', 'serial_number', serial.id, { materialId: serial.materialId, serial: serial.serial });
      return serial;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Número de série ou patrimônio já cadastrado.');
      throw e;
    }
  }
}

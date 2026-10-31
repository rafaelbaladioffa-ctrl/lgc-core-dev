import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { LotStatus, Prisma } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

class CreateLotDto {
  @IsUUID('all', { message: 'Material inválido.' }) materialId!: string;
  @IsString({ message: 'Informe o número do lote.' }) @MinLength(1) @MaxLength(60) lotNumber!: string;
  @IsOptional() @IsDateString({ strict: true }, { message: 'Data de fabricação inválida (AAAA-MM-DD).' }) manufacturedAt?: string;
  @IsOptional() @IsDateString({ strict: true }, { message: 'Data de validade inválida (AAAA-MM-DD).' }) expiresAt?: string;
  @IsOptional() @IsString() @MaxLength(60) supplierAxisId?: string;
}

class SetLotStatusDto {
  @IsEnum(LotStatus, { message: 'Status de lote inválido.' }) status!: LotStatus;
  @IsString({ message: 'Informe o motivo.' }) @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300) reason!: string;
}

class ListLotsQuery {
  @IsOptional() @IsUUID('all') materialId?: string;
  @IsOptional() @IsEnum(LotStatus) status?: LotStatus;
}

@Controller('lots')
export class LotsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('stock:read')
  list(@Query() q: ListLotsQuery) {
    return this.prisma.lot.findMany({ where: { ...(q.materialId && { materialId: q.materialId }), ...(q.status && { status: q.status }) }, orderBy: [{ expiresAt: 'asc' }, { lotNumber: 'asc' }], take: 200 });
  }

  @Post()
  @RequirePermissions('lot:write')
  async create(@Body() dto: CreateLotDto, @CurrentUser() user: AuthenticatedUser) {
    const material = await this.prisma.material.findUnique({ where: { id: dto.materialId } });
    if (!material) throw new BadRequestException('Material não encontrado.');
    if (!material.lotControlled) throw new BadRequestException('Este material não é controlado por lote.');
    if (material.expiryControlled && !dto.expiresAt) throw new BadRequestException('Material com controle de validade exige a data de validade do lote.');
    if (dto.expiresAt && dto.manufacturedAt && dto.expiresAt < dto.manufacturedAt) throw new BadRequestException('A validade não pode ser anterior à fabricação.');
    try {
      const lot = await this.prisma.lot.create({
        data: { materialId: dto.materialId, lotNumber: dto.lotNumber, supplierAxisId: dto.supplierAxisId, createdBy: user.userId, manufacturedAt: dto.manufacturedAt ? new Date(dto.manufacturedAt) : undefined, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined },
      });
      await this.audit.record(user.userId, 'lot.created', 'lot', lot.id, { materialId: lot.materialId, lotNumber: lot.lotNumber });
      return lot;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`O lote ${dto.lotNumber} já existe para este material.`);
      throw e;
    }
  }

  /** Bloquear/liberar lote (HSE/Qualidade); gera evento lot.blocked/released para o Axis (12.3). */
  @Patch(':id/status')
  @RequirePermissions('lot:block')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetLotStatusDto, @CurrentUser() user: AuthenticatedUser) {
    const lot = await this.prisma.lot.findUnique({ where: { id } });
    if (!lot) throw new NotFoundException('Lote não encontrado.');
    if (lot.status === dto.status) return lot;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.lot.update({ where: { id }, data: { status: dto.status, statusReason: dto.reason } });
      await this.audit.record(user.userId, 'lot.status_changed', 'lot', id, { from: lot.status, to: dto.status, reason: dto.reason }, tx);
      await tx.integrationMessage.create({
        data: { direction: 'OUTBOUND', eventId: crypto.randomUUID(), eventType: dto.status === 'LIBERADO' ? 'lot.released' : 'lot.blocked', occurredAt: new Date(), status: 'PENDING', payload: { lot_id: id, material_id: lot.materialId, lot_number: lot.lotNumber, status: dto.status, reason: dto.reason } },
      });
      return updated;
    });
  }
}

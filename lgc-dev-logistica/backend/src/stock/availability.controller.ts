import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsOptional, IsUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { AvailabilityService } from './availability.service.js';
import { ListBalancesQuery } from './stock.dto.js';
import { StockService } from './stock.service.js';

class AvailabilityQuery {
  @IsOptional() @IsUUID('all', { message: 'Almoxarifado inválido.' }) warehouse_id?: string;
  @IsOptional() @IsDateString({ strict: true }, { message: 'needed_by inválido (AAAA-MM-DD).' }) needed_by?: string;
}

class BatchAvailabilityDto {
  @IsArray() @ArrayMinSize(1, { message: 'Informe ao menos um material.' }) @ArrayMaxSize(200, { message: 'No máximo 200 materiais por consulta.' })
  @IsUUID('all', { each: true, message: 'Material inválido.' })
  material_ids!: string[];

  @IsOptional() @IsUUID('all', { message: 'Almoxarifado inválido.' }) warehouse_id?: string;
  @IsOptional() @IsDateString({ strict: true }, { message: 'needed_by inválido (AAAA-MM-DD).' }) needed_by?: string;
}

/**
 * Disponibilidade "publicável" (13.1): qualquer usuário com stock:read consulta o agregado, sem escopo por
 * almoxarifado — o solicitante precisa saber se há material. Detalhe por endereço continua restrito.
 */
@Controller()
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly stock: StockService,
  ) {}

  @Get('materials/:id/availability')
  @RequirePermissions('stock:read')
  async one(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQuery) {
    const [row] = await this.availability.compute([id], { warehouseId: q.warehouse_id, neededBy: q.needed_by ? new Date(q.needed_by) : undefined });
    if (!row) throw new NotFoundException('Material não encontrado.');
    return row;
  }

  @Post('materials/availability\\:batch')
  @RequirePermissions('stock:read')
  async batch(@Body() dto: BatchAvailabilityDto) {
    const items = await this.availability.compute(dto.material_ids, { warehouseId: dto.warehouse_id, neededBy: dto.needed_by ? new Date(dto.needed_by) : undefined });
    if (items.length === 0) throw new BadRequestException('Nenhum dos materiais informados foi encontrado.');
    return { items };
  }

  @Get('material-categories')
  @RequirePermissions('material:read')
  async categories() {
    const rows = await this.prisma.material.groupBy({ by: ['category', 'subcategory'], where: { status: 'ATIVO' }, _count: { _all: true }, orderBy: [{ category: 'asc' }, { subcategory: 'asc' }] });
    return rows.map((r) => ({ category: r.category, subcategory: r.subcategory, materials: r._count._all }));
  }

  @Get('warehouses/:id/stock')
  @RequirePermissions('stock:read')
  async warehouseStock(@Param('id', ParseUUIDPipe) id: string, @Query() q: ListBalancesQuery, @CurrentUser() user: AuthenticatedUser) {
    await this.rbac.assertWarehouseAccess(user, id);
    return this.stock.listBalances({ ...q, warehouseId: id }, user);
  }
}

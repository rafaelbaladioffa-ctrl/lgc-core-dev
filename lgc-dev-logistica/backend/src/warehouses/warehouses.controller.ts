import { BadRequestException, Body, ConflictException, Controller, Get, Logger, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { checkAxisRefs, PERSON_KINDS } from '../common/axis-cache.js';
import { CreateLocationDto, CreateWarehouseDto, UpdateLocationDto } from './warehouses.dto.js';

/** Hierarquia 5.1: cada nível só pode ficar sob o imediatamente superior (AREA é raiz). */
const LEVEL_ORDER = ['AREA', 'CORREDOR', 'ESTANTE', 'NIVEL', 'POSICAO'] as const;

@Controller('warehouses')
export class WarehousesController {
  private readonly logger = new Logger(WarehousesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('warehouse:read')
  async list(@CurrentUser() user: AuthenticatedUser) {
    const ids = await this.rbac.accessibleWarehouseIds(user);
    return this.prisma.warehouse.findMany({ where: ids === 'ALL' ? {} : { id: { in: ids } }, orderBy: { code: 'asc' } });
  }

  @Post()
  @RequirePermissions('warehouse:write')
  async create(@Body() dto: CreateWarehouseDto, @CurrentUser() user: AuthenticatedUser) {
    // Cadastros do Core (L1/L7): ausente do cache só avisa; responsável, projeto ou site inativo é recusado (422).
    const referenceWarnings = await checkAxisRefs(this.prisma, [
      { id: dto.responsibleAxisUserId, kinds: PERSON_KINDS, label: 'Responsável', onInactive: 'block' },
      { id: dto.projectAxisId, kinds: ['PROJECT'], label: 'Projeto', onInactive: 'block' },
      { id: dto.siteAxisId, kinds: ['SITE'], label: 'Site', onInactive: 'block' },
    ]);
    try {
      const warehouse = await this.prisma.warehouse.create({ data: { ...dto, createdBy: user.userId } });
      await this.audit.record(user.userId, 'warehouse.created', 'warehouse', warehouse.id, { code: warehouse.code, ...(referenceWarnings.length > 0 && { referenceWarnings }) });
      for (const w of referenceWarnings) this.logger.warn(`Almoxarifado ${warehouse.code}: ${w}`);
      return { ...warehouse, referenceWarnings };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Já existe um almoxarifado com o código ${dto.code}.`);
      throw e;
    }
  }

  @Get(':id/locations')
  @RequirePermissions('warehouse:read')
  async locations(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.rbac.assertWarehouseAccess(user, id);
    return this.prisma.location.findMany({ where: { warehouseId: id }, orderBy: { code: 'asc' } });
  }

  @Post(':id/locations')
  @RequirePermissions('warehouse:write')
  async createLocation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateLocationDto, @CurrentUser() user: AuthenticatedUser) {
    await this.rbac.assertWarehouseAccess(user, id);
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) throw new NotFoundException('Almoxarifado não encontrado.');
    if (warehouse.status !== 'ATIVO') throw new BadRequestException('Almoxarifado inativo não aceita novos endereços.');

    const levelIdx = LEVEL_ORDER.indexOf(dto.level);
    if (levelIdx === 0 && dto.parentId) throw new BadRequestException('Uma área/zona é raiz e não pode ter endereço pai.');
    if (levelIdx > 0) {
      if (!dto.parentId) throw new BadRequestException(`O nível ${dto.level} exige um endereço pai (${LEVEL_ORDER[levelIdx - 1]}).`);
      const parent = await this.prisma.location.findFirst({ where: { id: dto.parentId, warehouseId: id } });
      if (!parent) throw new BadRequestException('Endereço pai não encontrado neste almoxarifado.');
      if (parent.level !== LEVEL_ORDER[levelIdx - 1]) throw new BadRequestException(`O pai de ${dto.level} deve ser do nível ${LEVEL_ORDER[levelIdx - 1]}.`);
    }
    try {
      const location = await this.prisma.location.create({ data: { ...dto, warehouseId: id } });
      await this.audit.record(user.userId, 'location.created', 'location', location.id, { warehouseId: id, code: location.code });
      return location;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Já existe um endereço com o código ${dto.code} neste almoxarifado.`);
      throw e;
    }
  }

  @Patch(':id/locations/:locationId')
  @RequirePermissions('warehouse:write')
  async updateLocation(@Param('id', ParseUUIDPipe) id: string, @Param('locationId', ParseUUIDPipe) locationId: string, @Body() dto: UpdateLocationDto, @CurrentUser() user: AuthenticatedUser) {
    await this.rbac.assertWarehouseAccess(user, id);
    const loc = await this.prisma.location.findFirst({ where: { id: locationId, warehouseId: id } });
    if (!loc) throw new NotFoundException('Endereço não encontrado neste almoxarifado.');
    if (loc.isVirtual && dto.status && dto.status !== 'ATIVO') throw new BadRequestException('Endereço virtual (quarentena, trânsito, perda) não pode ser bloqueado nem inativado.');
    const status = dto.status ?? loc.status;
    const reason = dto.blockedReason?.trim() ?? loc.blockedReason;
    if (status === 'BLOQUEADO' && !reason) throw new BadRequestException('Informe o motivo do bloqueio.');
    if ((dto.capacityKind !== undefined || dto.capacityValue !== undefined) && !((dto.capacityKind ?? loc.capacityKind) && (dto.capacityValue ?? loc.capacityValue) !== null)) {
      throw new BadRequestException('Informe o tipo e o valor da capacidade juntos.');
    }
    if (status === 'INATIVO' && loc.status !== 'INATIVO') {
      const stock = await this.prisma.stockBalance.count({ where: { locationId, quantity: { gt: 0 } } });
      if (stock > 0) throw new ConflictException('O endereço ainda tem saldo; transfira o estoque antes de inativá-lo.');
      const children = await this.prisma.location.count({ where: { parentId: locationId, status: { not: 'INATIVO' } } });
      if (children > 0) throw new ConflictException('O endereço tem endereços inferiores ativos; inative-os primeiro.');
    }
    const data = { ...dto, name: dto.name?.trim() || dto.name, status, blockedReason: status === 'BLOQUEADO' ? reason : null };
    const updated = await this.prisma.location.update({ where: { id: locationId }, data });
    await this.audit.record(user.userId, 'location.updated', 'location', locationId, { warehouseId: id, before: { status: loc.status, name: loc.name }, after: { status: updated.status, name: updated.name } });
    return updated;
  }
}

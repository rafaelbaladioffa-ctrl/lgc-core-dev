import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CostCentersService } from './cost-centers.service.js';
import { CreateCostCenterDto } from './dto/create-cost-center.dto.js';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

@Controller('cost-centers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CostCentersController {
  constructor(private readonly costCentersService: CostCentersService) {}

  @Post()
  @RequirePermissions('cost_center:create')
  create(@Body() dto: CreateCostCenterDto) {
    return this.costCentersService.create(dto);
  }

  @Get()
  @RequirePermissions('cost_center:read')
  findAll() {
    return this.costCentersService.findAll();
  }

  @Get(':id')
  @RequirePermissions('cost_center:read')
  findOne(@Param('id') id: string) {
    return this.costCentersService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('cost_center:update')
  update(@Param('id') id: string, @Body() dto: UpdateCostCenterDto) {
    return this.costCentersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('cost_center:delete')
  remove(@Param('id') id: string) {
    return this.costCentersService.remove(id);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SectorsService } from './sectors.service.js';
import { CreateSectorDto } from './dto/create-sector.dto.js';
import { UpdateSectorDto } from './dto/update-sector.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

@Controller('sectors')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SectorsController {
  constructor(private readonly sectorsService: SectorsService) {}

  @Post()
  @RequirePermissions('sector:create')
  create(@Body() dto: CreateSectorDto) {
    return this.sectorsService.create(dto);
  }

  @Get()
  @RequirePermissions('sector:read')
  findAll() {
    return this.sectorsService.findAll();
  }

  @Get(':id')
  @RequirePermissions('sector:read')
  findOne(@Param('id') id: string) {
    return this.sectorsService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('sector:update')
  update(@Param('id') id: string, @Body() dto: UpdateSectorDto) {
    return this.sectorsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('sector:delete')
  remove(@Param('id') id: string) {
    return this.sectorsService.remove(id);
  }
}

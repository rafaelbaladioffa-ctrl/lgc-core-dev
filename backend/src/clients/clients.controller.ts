import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @RequirePermissions('client:create')
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Get()
  @RequirePermissions('client:read')
  findAll() {
    return this.clientsService.findAll();
  }

  @Get(':id')
  @RequirePermissions('client:read')
  findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('client:update')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('client:delete')
  remove(@Param('id') id: string) {
    return this.clientsService.remove(id);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CertificationsService } from './certifications.service.js';
import { CreateCertificationDto } from './dto/create-certification.dto.js';
import { UpdateCertificationDto } from './dto/update-certification.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

@Controller('certifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CertificationsController {
  constructor(private readonly certificationsService: CertificationsService) {}

  @Post()
  @RequirePermissions('certification:create')
  create(@Body() dto: CreateCertificationDto) {
    return this.certificationsService.create(dto);
  }

  @Get('expiring')
  @RequirePermissions('certification:read')
  findExpiring(@Query('windowDays') windowDays?: string) {
    return this.certificationsService.findExpiring(windowDays ? Number(windowDays) : undefined);
  }

  @Get('collaborator/:collaboratorId')
  @RequirePermissions('certification:read')
  findAllForCollaborator(@Param('collaboratorId') collaboratorId: string) {
    return this.certificationsService.findAllForCollaborator(collaboratorId);
  }

  @Put(':id')
  @RequirePermissions('certification:update')
  update(@Param('id') id: string, @Body() dto: UpdateCertificationDto) {
    return this.certificationsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('certification:delete')
  remove(@Param('id') id: string) {
    return this.certificationsService.remove(id);
  }
}

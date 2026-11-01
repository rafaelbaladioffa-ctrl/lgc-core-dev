import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { HolidaysService } from './holidays.service.js';
import { CreateHolidayDto } from './dto/create-holiday.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';

@Controller('holidays')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Post()
  @RequirePermissions('request_category:create')
  @AuditAction({ action: 'create_holiday', resourceType: 'holiday' })
  create(@Body() dto: CreateHolidayDto) {
    return this.holidaysService.create(dto);
  }

  @Get()
  @RequirePermissions('request_category:read')
  findAll() {
    return this.holidaysService.findAll();
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('request_category:create')
  @AuditAction({ action: 'delete_holiday', resourceType: 'holiday', resourceIdParam: 'id' })
  remove(@Param('id') id: string) {
    return this.holidaysService.remove(id);
  }
}

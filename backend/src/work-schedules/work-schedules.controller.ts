import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { WorkSchedulesService } from './work-schedules.service.js';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto.js';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

@Controller('work-schedules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkSchedulesController {
  constructor(private readonly workSchedulesService: WorkSchedulesService) {}

  @Post()
  @RequirePermissions('work_schedule:create')
  create(@Body() dto: CreateWorkScheduleDto) {
    return this.workSchedulesService.create(dto);
  }

  @Get()
  @RequirePermissions('work_schedule:read')
  findAll() {
    return this.workSchedulesService.findAll();
  }

  @Get(':id')
  @RequirePermissions('work_schedule:read')
  findOne(@Param('id') id: string) {
    return this.workSchedulesService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('work_schedule:update')
  update(@Param('id') id: string, @Body() dto: UpdateWorkScheduleDto) {
    return this.workSchedulesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('work_schedule:delete')
  remove(@Param('id') id: string) {
    return this.workSchedulesService.remove(id);
  }
}

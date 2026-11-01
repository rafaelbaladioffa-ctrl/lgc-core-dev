import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JobTitlesService } from './job-titles.service.js';
import { CreateJobTitleDto } from './dto/create-job-title.dto.js';
import { UpdateJobTitleDto } from './dto/update-job-title.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

@Controller('job-titles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JobTitlesController {
  constructor(private readonly jobTitlesService: JobTitlesService) {}

  @Post()
  @RequirePermissions('job_title:create')
  create(@Body() dto: CreateJobTitleDto) {
    return this.jobTitlesService.create(dto);
  }

  @Get()
  @RequirePermissions('job_title:read')
  findAll() {
    return this.jobTitlesService.findAll();
  }

  @Get(':id')
  @RequirePermissions('job_title:read')
  findOne(@Param('id') id: string) {
    return this.jobTitlesService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('job_title:update')
  update(@Param('id') id: string, @Body() dto: UpdateJobTitleDto) {
    return this.jobTitlesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('job_title:delete')
  remove(@Param('id') id: string) {
    return this.jobTitlesService.remove(id);
  }
}

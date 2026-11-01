import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { UpdateProjectStatusDto } from './dto/update-project-status.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

@Controller('projects')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @RequirePermissions('project:create')
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  @Get()
  @RequirePermissions('project:read')
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id')
  @RequirePermissions('project:read')
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('project:update')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto);
  }

  @Put(':id/status')
  @RequirePermissions('project:update')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto) {
    return this.projectsService.updateStatus(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('project:delete')
  remove(@Param('id') id: string) {
    return this.projectsService.remove(id);
  }
}

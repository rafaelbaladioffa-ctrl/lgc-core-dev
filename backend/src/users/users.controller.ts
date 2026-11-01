import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SetUserStatusDto } from './dto/set-user-status.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('user:create')
  @AuditAction({ action: 'create_user', resourceType: 'user' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @RequirePermissions('user:read')
  findAll(@Query('status') status?: 'active' | 'disabled', @Query('roleId') roleId?: string, @Query('search') search?: string) {
    return this.usersService.findAll({ status, roleId, search });
  }

  @Get(':id')
  @RequirePermissions('user:read')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Put(':id/roles')
  @RequirePermissions('user:update')
  @AuditAction({ action: 'update_user_roles', resourceType: 'user', resourceIdParam: 'id' })
  updateRoles(@Param('id') id: string, @Body() dto: UpdateUserRolesDto) {
    return this.usersService.updateRoles(id, dto);
  }

  @Post(':id/reset-password')
  @RequirePermissions('user:reset_password')
  @AuditAction({ action: 'reset_user_password', resourceType: 'user', resourceIdParam: 'id' })
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(id, dto);
  }

  @Put(':id/status')
  @RequirePermissions('user:update')
  @AuditAction({ action: 'set_user_status', resourceType: 'user', resourceIdParam: 'id' })
  setStatus(@Param('id') id: string, @Body() dto: SetUserStatusDto) {
    return this.usersService.setStatus(id, dto);
  }
}

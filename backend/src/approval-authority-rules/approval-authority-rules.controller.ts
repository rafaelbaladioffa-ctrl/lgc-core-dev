import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApprovalAuthorityRulesService } from './approval-authority-rules.service.js';
import { CreateApprovalAuthorityRuleDto } from './dto/create-approval-authority-rule.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';

@Controller('approval-authority-rules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApprovalAuthorityRulesController {
  constructor(private readonly rulesService: ApprovalAuthorityRulesService) {}

  @Post()
  @RequirePermissions('request_category:create')
  @AuditAction({ action: 'create_approval_authority_rule', resourceType: 'approval_authority_rule' })
  create(@Body() dto: CreateApprovalAuthorityRuleDto) {
    return this.rulesService.create(dto);
  }

  @Get()
  @RequirePermissions('request_category:read')
  findAll() {
    return this.rulesService.findAll();
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('request_category:create')
  @AuditAction({ action: 'deactivate_approval_authority_rule', resourceType: 'approval_authority_rule', resourceIdParam: 'id' })
  remove(@Param('id') id: string) {
    return this.rulesService.remove(id);
  }
}

import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { LabelsService, PrintLabelDto } from './labels.service.js';

@Controller('labels')
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Post('print') @HttpCode(201) @RequirePermissions('label:print')
  print(@Body() dto: PrintLabelDto, @CurrentUser() user: AuthenticatedUser) { return this.labels.print(dto, user); }
}

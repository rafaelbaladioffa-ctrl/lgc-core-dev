import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

@Controller('units-of-measure')
export class UnitsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('uom:read')
  list() {
    return this.prisma.unitOfMeasure.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
  }
}

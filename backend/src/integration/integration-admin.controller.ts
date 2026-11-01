import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { SatellitesService } from './satellites.service.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { CreateSatelliteDto } from './dto/create-satellite.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

/** Admin panel over registered satellites (PLANNING.md 6.4) — JWT-protected like the rest of the app. */
@Controller('integration/satellites')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IntegrationAdminController {
  constructor(
    private readonly satellitesService: SatellitesService,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /** Not in PLANNING.md 6.4's route table, but necessary: without it there is no way to register a satellite at all. */
  @Post()
  @RequirePermissions('integration:manage')
  create(@Body() dto: CreateSatelliteDto) {
    return this.satellitesService.create(dto);
  }

  @Get()
  @RequirePermissions('integration:read')
  list() {
    return this.satellitesService.statusOverview();
  }

  @Post(':id/test-webhook')
  @RequirePermissions('integration:manage')
  async testWebhook(@Param('id') id: string) {
    const satellite = await this.prisma.integrationSatellite.findUnique({ where: { id } });
    if (!satellite) throw new NotFoundException('Satellite not found');
    const ok = await this.dispatcher.sendTestPing(satellite);
    return { ok };
  }

  /**
   * "Launcher" de satélite — abre o frontend humano do satélite já autenticado, sem precisar
   * colar o JWT manualmente. Reaproveita o segredo compartilhado (PLANNING_LOGISTICA.md §0.3):
   * o token devolvido tem o mesmo formato/segredo (`JWT_ACCESS_SECRET`) de qualquer access token
   * normal, só com TTL de 90s — o satélite valida exatamente como já valida o token colado
   * manualmente hoje, sem lógica nova do lado dele além de ler a querystring.
   */
  @Post(':id/launch')
  @RequirePermissions('integration:read')
  async launch(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const satellite = await this.satellitesService.findOne(id);
    if (!satellite.frontendUrl) throw new BadRequestException('Este satélite não tem URL de frontend configurada');
    const token = this.authService.signSatelliteLaunchToken(user);
    const separator = satellite.frontendUrl.includes('?') ? '&' : '?';
    return { url: `${satellite.frontendUrl}${separator}axisToken=${encodeURIComponent(token)}` };
  }
}

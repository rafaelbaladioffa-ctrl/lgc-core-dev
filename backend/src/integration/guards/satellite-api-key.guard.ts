import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Request } from 'express';
import type { IntegrationSatellite } from '@prisma/client';

export interface SatelliteRequest extends Request {
  satellite: IntegrationSatellite;
}

/**
 * Authenticates a satellite's synchronous query calls (PLANNING.md 6.1/6.2) via
 * `Authorization: Bearer <api_key>`. Never uses the end user's JWT for service-to-service calls.
 */
@Injectable()
export class SatelliteApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SatelliteRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API key');
    }
    const apiKey = header.slice('Bearer '.length);

    const activeSatellites = await this.prisma.integrationSatellite.findMany({ where: { status: 'active' } });
    for (const satellite of activeSatellites) {
      if (await bcrypt.compare(apiKey, satellite.apiKeyHash)) {
        request.satellite = satellite;
        return true;
      }
    }
    throw new UnauthorizedException('Invalid API key');
  }
}

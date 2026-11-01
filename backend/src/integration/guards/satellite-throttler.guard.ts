import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { SatelliteRequest } from './satellite-api-key.guard.js';

/** Rate-limits by satellite API key (PLANNING.md 6.1) rather than by IP, since several
 * satellites could share an egress IP and one satellite's traffic shouldn't throttle another's. */
@Injectable()
export class SatelliteThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: SatelliteRequest): Promise<string> {
    return req.satellite?.id ?? req.ip ?? 'unknown';
  }
}

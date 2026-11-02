import {
  Body,
  Headers,
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
  UseFilters,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequestRuntimeService } from './request-runtime.service.js';
import { BpmCommandProtocolInterceptor } from './command-protocol.interceptor.js';
import { BpmExceptionFilter, BpmResponseInterceptor } from './bpm-http.js';
import {
  AttachmentDto,
  CommandDto,
  CommentDto,
  CompleteActivityDto,
  CreateBpmRequestDto,
  DraftPatchDto,
  ReasonCommandDto,
  ReassignDto,
  ListBpmDto,
} from './dto.js';

@Controller('bpm')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(BpmResponseInterceptor, BpmCommandProtocolInterceptor)
@UseFilters(BpmExceptionFilter)
export class RequestRuntimeController {
  constructor(private readonly service: RequestRuntimeService) {}
  @Post('requests') @RequirePermissions('request:create') create(
    @Body() d: CreateBpmRequestDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.create(d, u);
  }
  @Get('requests') @RequirePermissions('request:read') list(
    @CurrentUser() u: AuthenticatedUser,
    @Query() query: ListBpmDto,
  ) {
    return this.service.list(u, query);
  }
  @Get('requests/:id') @RequirePermissions('request:read') detail(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.detail(id, u);
  }
  @Patch('requests/:id/draft') @RequirePermissions('request:create') draft(
    @Param('id') id: string,
    @Body() d: DraftPatchDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    if (key && key !== d.commandKey)
      throw new BadRequestException('IDEMPOTENCY_KEY_MISMATCH');
    return this.service.saveDraft(id, d, u);
  }
  @Post('requests/:id/submit') @RequirePermissions('request:create') submit(
    @Param('id') id: string,
    @Body() d: CommandDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.submit(id, d, u);
  }
  @Post('activities/:id/claim') @RequirePermissions('request:update') claim(
    @Param('id') id: string,
    @Body() d: CommandDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.claim(id, d, u);
  }
  @Post('activities/:id/complete')
  @RequirePermissions('request:update')
  complete(
    @Param('id') id: string,
    @Body() d: CompleteActivityDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.complete(id, d, u);
  }
  @Post('activities/:id/release') @RequirePermissions('request:update') release(
    @Param('id') id: string,
    @Body() d: ReasonCommandDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.release(id, d, u);
  }
  @Post('activities/:id/reassign')
  @RequirePermissions('request:update')
  reassign(
    @Param('id') id: string,
    @Body() d: ReassignDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.reassign(id, d, u);
  }
  @Post('requests/:id/close') @RequirePermissions('request:update') close(
    @Param('id') id: string,
    @Body() d: ReasonCommandDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.close(id, d, u);
  }
  @Post('requests/:id/cancel') cancel(
    @Param('id') id: string,
    @Body() d: ReasonCommandDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.cancel(id, d, u);
  }
  @Post('requests/:id/comments') @RequirePermissions('request:comment') comment(
    @Param('id') id: string,
    @Body() d: CommentDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.comment(id, d, u);
  }
  @Post('requests/:id/attachments')
  @RequirePermissions('request:comment')
  attachment(
    @Param('id') id: string,
    @Body() d: AttachmentDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.attachment(id, d, u);
  }
  @Get('requests/:id/attachments/:attachmentId')
  @RequirePermissions('request:read')
  async download(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() u: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const a = await this.service.download(id, attachmentId, u);
    res.set({
      'Content-Type': a.mimeType,
      'Content-Disposition': `attachment; filename="${a.safeFilename}"`,
      'Cache-Control': 'private, no-store',
    });
    return res.send(a.content);
  }
  @Get('requests/:id/timeline') @RequirePermissions('request:read') timeline(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.timeline(id, u);
  }
}

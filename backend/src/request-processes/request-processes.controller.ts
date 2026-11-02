import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UseFilters,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequestProcessesService } from './request-processes.service.js';
import { ConfigCommandInterceptor } from './config-command.interceptor.js';
import { BpmExceptionFilter, BpmResponseInterceptor } from '../request-runtime/bpm-http.js';
import {
  CreateBpmProcessDto,
  CreateBpmQueueDto,
  CreateVersionDto,
  ExpectedVersionDto,
  GrantDto,
  GrantPatchDto,
  PatchVersionDto,
  PublishVersionDto,
  UpdateBpmQueueDto,
} from './dto.js';

@Controller('bpm')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(BpmResponseInterceptor, ConfigCommandInterceptor)
@UseFilters(BpmExceptionFilter)
export class RequestProcessesController {
  constructor(private readonly service: RequestProcessesService) {}
  @Get('capabilities') capabilities(@CurrentUser() u: AuthenticatedUser) {
    return this.service.capabilities(u);
  }
  @Get('queues') @RequirePermissions('request_queue:manage') queues(
    @CurrentUser() u: AuthenticatedUser,
    @Query('sectorId') sectorId?: string,
  ) {
    return this.service.listQueues(u, sectorId);
  }
  @Get('collaborators')
  @RequirePermissions('request_queue:manage')
  collaborators(@CurrentUser() u: AuthenticatedUser) {
    return this.service.listCollaborators(u);
  }
  @Post('queues') @RequirePermissions('request_queue:manage') queue(
    @Body() d: CreateBpmQueueDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.createQueue(d, u);
  }
  @Patch('queues/:id') @RequirePermissions('request_queue:manage') updateQueue(
    @Param('id') id: string,
    @Body() d: UpdateBpmQueueDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.updateQueue(id, d, u);
  }
  @Get('processes') @RequirePermissions('request_process:model') processes(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.listProcesses(u);
  }
  @Get('catalog') @RequirePermissions('request:create') catalog(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.catalog(u);
  }
  @Post('processes') @RequirePermissions('request_process:model') process(
    @Body() d: CreateBpmProcessDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.createProcess(d, u);
  }
  @Post('processes/:id/versions')
  @RequirePermissions('request_process:model')
  newVersion(
    @Param('id') id: string,
    @Body() d: CreateVersionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.createVersion(id, d, u);
  }
  @Get('versions/:id') @RequirePermissions('request_process:model') version(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.version(id, u);
  }
  @Patch('versions/:id') @RequirePermissions('request_process:model') patch(
    @Param('id') id: string,
    @Body() d: PatchVersionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.patchVersion(id, d, u);
  }
  @Post('versions/:id/validate')
  @RequirePermissions('request_process:model')
  validate(
    @Param('id') id: string,
    @Body() d: ExpectedVersionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.validateVersion(id, d.expectedVersion, u);
  }
  @Post('versions/:id/publish')
  @RequirePermissions('request_process:publish')
  publish(
    @Param('id') id: string,
    @Body() d: PublishVersionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.publishVersion(id, d, u);
  }
  @Post('processes/:id/enable')
  @RequirePermissions('request_process:publish')
  enable(
    @Param('id') id: string,
    @Body() d: ExpectedVersionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.enableProcess(id, d, u);
  }
  @Put('processes/:id/grants')
  @RequirePermissions('request_process:model')
  grant(
    @Param('id') id: string,
    @Body() d: GrantPatchDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.grants(id, d.grants, u, d.expectedVersion);
  }
}

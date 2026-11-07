import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RequestsService } from './requests.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { UpdateRequestDto } from './dto/update-request.dto.js';
import { TriageRequestDto } from './dto/triage-request.dto.js';
import { AssignRequestDto } from './dto/assign-request.dto.js';
import { ApproveRequestDto, RejectRequestDto } from './dto/decision.dto.js';
import { RequestInformationDto, ResumeRequestDto, CompleteRequestDto, CancelRequestDto, ReopenRequestDto } from './dto/lifecycle.dto.js';
import { CreateRequestCommentDto } from './dto/create-comment.dto.js';
import { CreateRequestAttachmentDto } from './dto/create-attachment.dto.js';
import { PurchaseAnalysisDto } from './dto/purchase-analysis.dto.js';
import { PurchaseQuotationDto } from './dto/purchase-quotation.dto.js';
import { PurchaseQuotationSelectionDto } from './dto/purchase-quotation-selection.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { RequestStatus } from '@prisma/client';

function requireCollaboratorId(user: AuthenticatedUser): string {
  if (!user.collaboratorId) throw new ForbiddenException('Este usuário não está vinculado a um colaborador');
  return user.collaboratorId;
}

function requireProcurementRole(user: AuthenticatedUser): string {
  if (!user.roles.includes('analista_suprimentos') && !user.roles.includes('admin')) {
    throw new ForbiddenException('Somente o Analista de Suprimentos pode registrar análise e cotação.');
  }
  return requireCollaboratorId(user);
}

@Controller('requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @RequirePermissions('request:create')
  @AuditAction({ action: 'create_request', resourceType: 'request' })
  create(@Body() dto: CreateRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.create(requireCollaboratorId(user), dto);
  }

  @Get('mine')
  @RequirePermissions('request:read')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.findMine(requireCollaboratorId(user));
  }

  @Get('queue')
  @RequirePermissions('request:read')
  findQueue(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sectorId') sectorId?: string,
    @Query('queueId') queueId?: string,
    @Query('status') status?: RequestStatus,
  ) {
    return this.requestsService.findQueue(
      { sectorId, queueId, status },
      { roles: user.roles, collaboratorId: user.collaboratorId, canViewWhistleblowerIdentity: user.permissions.includes('request:view_whistleblower_identity') },
    );
  }

  @Get('dashboard')
  @RequirePermissions('request:read')
  dashboard() {
    return this.requestsService.dashboard();
  }

  @Get('my-approvals')
  @RequirePermissions('request:read')
  myApprovals(@CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.myApprovals(requireCollaboratorId(user), user.permissions.includes('request:view_whistleblower_identity'));
  }

  @Get('my-activities')
  @RequirePermissions('request:read')
  myActivities(@CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.myActivities({ collaboratorId: requireCollaboratorId(user), permissions: user.permissions });
  }

  @Get(':id')
  @RequirePermissions('request:read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.findOne(id, { collaboratorId: user.collaboratorId, canViewWhistleblowerIdentity: user.permissions.includes('request:view_whistleblower_identity') });
  }

  @Put(':id')
  @RequirePermissions('request:create')
  @AuditAction({ action: 'update_request', resourceType: 'request', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.update(id, requireCollaboratorId(user), dto);
  }

  @Post(':id/submit')
  @RequirePermissions('request:create')
  @AuditAction({ action: 'submit_request', resourceType: 'request', resourceIdParam: 'id' })
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.submit(id, requireCollaboratorId(user));
  }

  @Post(':id/triage')
  @RequirePermissions('request:update')
  @AuditAction({ action: 'triage_request', resourceType: 'request', resourceIdParam: 'id' })
  triage(@Param('id') id: string, @Body() dto: TriageRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.triage(id, requireCollaboratorId(user), dto, user.roles);
  }

  @Post(':id/assign')
  @RequirePermissions('request:assign')
  @AuditAction({ action: 'assign_request', resourceType: 'request', resourceIdParam: 'id' })
  assign(@Param('id') id: string, @Body() dto: AssignRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.assign(id, requireCollaboratorId(user), dto);
  }

  @Post(':id/purchase-analysis')
  @RequirePermissions('request:update')
  @AuditAction({ action: 'record_purchase_analysis', resourceType: 'request', resourceIdParam: 'id' })
  purchaseAnalysis(@Param('id') id: string, @Body() dto: PurchaseAnalysisDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.recordPurchaseAnalysis(id, requireProcurementRole(user), dto);
  }

  @Post(':id/purchase-quotation')
  @RequirePermissions('request:update')
  @AuditAction({ action: 'record_purchase_quotation', resourceType: 'request', resourceIdParam: 'id' })
  purchaseQuotation(@Param('id') id: string, @Body() dto: PurchaseQuotationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.recordPurchaseQuotation(id, requireProcurementRole(user), dto);
  }

  @Post(':id/purchase-quotation-selection')
  @RequirePermissions('request:read')
  @AuditAction({ action: 'select_purchase_quotation', resourceType: 'request', resourceIdParam: 'id' })
  purchaseQuotationSelection(@Param('id') id: string, @Body() dto: PurchaseQuotationSelectionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.selectPurchaseQuotation(id, requireCollaboratorId(user), dto);
  }

  @Post(':id/approve')
  @RequirePermissions('request:approve')
  @AuditAction({ action: 'approve_request', resourceType: 'request', resourceIdParam: 'id' })
  approve(@Param('id') id: string, @Body() dto: ApproveRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.approve(id, requireCollaboratorId(user), dto);
  }

  @Post(':id/reject')
  @RequirePermissions('request:approve')
  @AuditAction({ action: 'reject_request', resourceType: 'request', resourceIdParam: 'id' })
  reject(@Param('id') id: string, @Body() dto: RejectRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.reject(id, requireCollaboratorId(user), dto);
  }

  @Post(':id/start')
  @RequirePermissions('request:update')
  @AuditAction({ action: 'start_request', resourceType: 'request', resourceIdParam: 'id' })
  start(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.start(id, requireCollaboratorId(user));
  }

  @Post(':id/request-information')
  @RequirePermissions('request:update')
  @AuditAction({ action: 'request_information', resourceType: 'request', resourceIdParam: 'id' })
  requestInformation(@Param('id') id: string, @Body() dto: RequestInformationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.requestInformation(id, requireCollaboratorId(user), dto);
  }

  // request:create na rota (todo papel solicitante tem): o solicitante responde à pergunta do
  // atendente por aqui; o serviço exige request:update para qualquer outra retomada.
  @Post(':id/resume')
  @RequirePermissions('request:create')
  @AuditAction({ action: 'resume_request', resourceType: 'request', resourceIdParam: 'id' })
  resume(@Param('id') id: string, @Body() dto: ResumeRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.resume(id, requireCollaboratorId(user), user.permissions.includes('request:update'), dto);
  }

  @Post(':id/complete')
  @RequirePermissions('request:update')
  @AuditAction({ action: 'complete_request', resourceType: 'request', resourceIdParam: 'id' })
  complete(@Param('id') id: string, @Body() dto: CompleteRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.complete(id, requireCollaboratorId(user), dto);
  }

  // request:create (not update): só o solicitante aceita (RequestsService.accept checa dono).
  @Post(':id/accept')
  @RequirePermissions('request:create')
  @AuditAction({ action: 'accept_request', resourceType: 'request', resourceIdParam: 'id' })
  accept(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.accept(id, requireCollaboratorId(user));
  }

  @Post(':id/close')
  @RequirePermissions('request:update')
  @AuditAction({ action: 'close_request', resourceType: 'request', resourceIdParam: 'id' })
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.close(id, requireCollaboratorId(user));
  }

  // request:create (not update) at the route level — every requesting role already has it, and
  // the service itself enforces that only the requester or someone with request:update may
  // actually reopen (see RequestsService.reopen).
  @Post(':id/reopen')
  @RequirePermissions('request:create')
  @AuditAction({ action: 'reopen_request', resourceType: 'request', resourceIdParam: 'id' })
  reopen(@Param('id') id: string, @Body() dto: ReopenRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.reopen(id, requireCollaboratorId(user), user.permissions.includes('request:update'), dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('request:create')
  @AuditAction({ action: 'cancel_request', resourceType: 'request', resourceIdParam: 'id' })
  cancel(@Param('id') id: string, @Body() dto: CancelRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.cancel(id, requireCollaboratorId(user), user.permissions.includes('request:update'), dto);
  }

  @Post(':id/comments')
  @RequirePermissions('request:comment')
  @AuditAction({ action: 'comment_request', resourceType: 'request', resourceIdParam: 'id' })
  addComment(@Param('id') id: string, @Body() dto: CreateRequestCommentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.addComment(id, requireCollaboratorId(user), dto.body, dto.visibility);
  }

  @Post(':id/attachments')
  @RequirePermissions('request:comment')
  @AuditAction({ action: 'attach_request_file', resourceType: 'request', resourceIdParam: 'id' })
  addAttachment(@Param('id') id: string, @Body() dto: CreateRequestAttachmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestsService.addAttachment(id, requireCollaboratorId(user), dto.filename, dto.contentBase64, dto.replacesAttachmentId);
  }

  // Não é a "URL de download temporária" do §16 (isso depende da infraestrutura de
  // armazenamento definitiva) — download autenticado direto, atrás da mesma
  // permissão/visibilidade de findOne (chamado primeiro, de propósito, pra herdar o bloqueio de
  // confidencialidade `restrita`/mascaramento de denúncia anônima).
  @Get(':id/attachments/:attachmentId')
  @RequirePermissions('request:read')
  async downloadAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    await this.requestsService.findOne(id, { collaboratorId: user.collaboratorId, canViewWhistleblowerIdentity: user.permissions.includes('request:view_whistleblower_identity') });
    const attachment = await this.requestsService.getAttachmentContent(id, attachmentId);
    res.set({ 'Content-Type': attachment.mimeType, 'Content-Disposition': `attachment; filename="${attachment.safeFilename}"` });
    res.send(attachment.content);
  }
}

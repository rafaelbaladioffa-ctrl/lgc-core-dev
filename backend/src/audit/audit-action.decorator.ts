import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'auditAction';

export interface AuditActionMeta {
  action: string;
  resourceType: string;
  /** Request param name holding the resource id, e.g. "id". */
  resourceIdParam?: string;
}

export const AuditAction = (meta: AuditActionMeta) => SetMetadata(AUDIT_ACTION_KEY, meta);

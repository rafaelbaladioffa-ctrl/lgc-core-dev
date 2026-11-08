import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/** Exige todas as permissões locais listadas ("recurso:acao"), validadas no servidor. */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'anyPermissions';

/** Exige ao menos uma das permissões listadas (ex.: ver todos os CCs ou só os próprios). */
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, permissions);

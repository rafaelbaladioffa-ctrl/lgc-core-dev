import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY = 'allowWhilePasswordChangeRequired';

/** Marks a route as reachable even while the caller's must_change_password flag is set (PLANNING.md 4.7) — only /auth/change-password and /auth/logout should carry this. */
export const AllowWhilePasswordChangeRequired = () => SetMetadata(ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY, true);

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Rota sem JWT (health, webhook assinado). Todo o resto exige autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

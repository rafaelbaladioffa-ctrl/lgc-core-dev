import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Rota sem JWT (ex.: health). Todo o resto exige autenticação por padrão. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

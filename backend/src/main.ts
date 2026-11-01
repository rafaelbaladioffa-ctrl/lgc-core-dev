import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { MAX_FILE_SIZE_BYTES } from './requests/attachment-security.js';

// Base64 infla o binário ~33%, mais a margem do envelope JSON do corpo — o limite do
// body-parser precisa ficar bem acima de MAX_FILE_SIZE_BYTES (§16), senão um anexo no limite
// (25MB) recebe 413 do Express antes de chegar na validação de attachment-security.ts (defeito
// relatado pela sessão de testes no incremento 7).
const JSON_BODY_LIMIT_BYTES = MAX_FILE_SIZE_BYTES * 2;

/**
 * Satélites (Logística e futuros) chamam este backend direto do navegador do usuário — login
 * próprio deles (POST /auth/login) e qualquer outra chamada JWT-autenticada a partir do
 * frontend do satélite, não só do Axis (PLANNING_LOGISTICA.md §0.3: mesmo JWT_ACCESS_SECRET
 * compartilhado, cada satélite com seu próprio frontend/origem). Configurável via
 * `CORS_ALLOWED_ORIGINS` (lista separada por vírgula) — sem a env var, cai num default só de
 * desenvolvimento (Axis + Logística nas portas Vite padrão); em produção, **sempre** definir a
 * env var com os domínios reais, nunca depender do fallback.
 */
function resolveAllowedOrigins(): string[] {
  const configured = process.env.CORS_ALLOWED_ORIGINS;
  if (configured) return configured.split(',').map((origin) => origin.trim()).filter(Boolean);
  return ['http://localhost:5173', 'http://localhost:5174'];
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(helmet());
  app.enableCors({ origin: resolveAllowedOrigins() });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT_BYTES });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api/v1');
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();

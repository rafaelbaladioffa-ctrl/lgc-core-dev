import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { corsOrigins } from './common/cors.js';

// Fuso de referência do domínio; o banco guarda instantes em UTC e datas de negócio como DATE.
process.env.TZ ??= 'America/Sao_Paulo';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true }); // rawBody: o HMAC do webhook é calculado sobre o corpo bruto
  app.use(helmet());
  app.enableCors({ origin: corsOrigins(process.env.CORS_ALLOWED_ORIGINS), exposedHeaders: ['X-Correlation-Id'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api/v1');
  await app.listen(process.env.PORT ?? 3200);
}

void bootstrap();

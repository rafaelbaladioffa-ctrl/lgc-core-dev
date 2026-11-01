import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

// Fuso padrão do domínio (PLANNING.md 1.1); o banco guarda sempre UTC.
process.env.TZ ??= 'America/Sao_Paulo';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true }); // rawBody: o HMAC do webhook é calculado sobre o corpo bruto
  app.use(helmet());
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api/v1');
  await app.listen(process.env.PORT ?? 3100);
}

void bootstrap();

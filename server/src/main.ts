import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);

  app.use(helmet());
  app.use(cookieParser());

  // Explicit origin allowlist, never a wildcard: `credentials: true` below
  // means the browser attaches the auth cookies to cross-origin requests
  // too, so an open CORS policy here would let any site ride a visitor's
  // session — this pairing is safe only with a known, listed origin.
  app.enableCors({
    origin: config.getOrThrow('corsOrigin', { infer: true }),
    credentials: true,
  });

  // whitelist + forbidNonWhitelisted: a DTO defines the entire accepted
  // shape of a request — any extra field is rejected outright, not silently
  // dropped. transform: true lets query/param strings become the typed
  // values (numbers, enums, ...) the DTOs declare.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CMS API')
    .setDescription(
      'Story 1: self-registration, admin approval, JWT-cookie auth, role-based authorization.',
    )
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = config.getOrThrow('port', { infer: true });
  await app.listen(port);
}

void bootstrap();

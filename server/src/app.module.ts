import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    // Default: 20 requests / 60s per client. Registering this module alone
    // enforces nothing — it only becomes active once bound as a guard,
    // which is what the APP_GUARD provider below does. Individual routes
    // (login, register) tighten this further with @Throttle — see
    // AuthController.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    HealthModule,
  ],
  providers: [
    // Skipped in the test environment only — the e2e suite exercises the
    // same login/register endpoints far more than 5 times/minute across its
    // test cases, and rate-limiting itself isn't what those tests are
    // verifying. Fully bound in development and production.
    //
    // Reads process.env directly rather than through ConfigService
    // deliberately: this array is built once, synchronously, while Nest is
    // still assembling the module's provider list — before the DI container
    // (and therefore ConfigService) exists to inject anything into.
    ...(process.env.NODE_ENV === 'test'
      ? []
      : [{ provide: APP_GUARD, useClass: ThrottlerGuard }]),
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}

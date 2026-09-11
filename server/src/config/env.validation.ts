import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * Every environment variable the app actually reads, in one place, with
 * validation. If a required value is missing or malformed, the process
 * refuses to start — failing at boot is far easier to diagnose than failing
 * on the first request that happens to need the missing value.
 */
class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  // Signs and verifies the access-token JWT only. Refresh tokens are opaque
  // random values (see opaque-token.util.ts), verified by comparing an
  // argon2 hash — there is nothing for a second JWT secret to sign.
  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;

  @IsInt()
  @Min(60)
  ACCESS_TOKEN_TTL_SECONDS: number = 900;

  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_DAYS: number = 7;

  @IsString()
  @IsNotEmpty()
  CORS_ORIGIN: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return validated;
}

/**
 * Typed accessors over `process.env`, grouped by concern, so the rest of the
 * app injects `ConfigService<AppConfig>` and calls
 * `config.getOrThrow('auth.accessTokenTtlSeconds', { infer: true })` instead
 * of reading `process.env.WHATEVER` scattered everywhere — with autocomplete
 * and a compile error on a typo'd path. Values have already been validated
 * by env.validation.ts by the time this factory runs.
 */
const configuration = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  database: {
    url: process.env.DATABASE_URL,
  },
  auth: {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET,
    accessTokenTtlSeconds: parseInt(
      process.env.ACCESS_TOKEN_TTL_SECONDS ?? '900',
      10,
    ),
    refreshTokenTtlDays: parseInt(
      process.env.REFRESH_TOKEN_TTL_DAYS ?? '7',
      10,
    ),
  },
});

export type AppConfig = ReturnType<typeof configuration>;

export default configuration;

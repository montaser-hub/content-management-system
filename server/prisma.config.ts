import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 removed `datasource.url` from schema.prisma; the CLI (migrate,
// studio, db push, ...) now reads the connection string from here instead.
// The running application never touches this file — PrismaService builds
// its own connection via a driver adapter (see src/modules/prisma).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Prisma 7 moved this out of package.json's "prisma.seed" field and
    // into here — `npm run db:seed` (-> `prisma db seed`) reads it from
    // this config, not from package.json anymore.
    // tsx (not ts-node): this project's tsconfig uses nodenext module
    // resolution, so the generated Prisma client's own internal imports use
    // explicit `.js` specifiers that point at sibling `.ts` files. ts-node's
    // plain CommonJS require hook doesn't resolve that; tsx (esbuild-based)
    // does, without needing a full `nest build` first.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});

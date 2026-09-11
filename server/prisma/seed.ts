/**
 * Bootstraps demo accounts — one per role — so the contest demo environment
 * always boots with working credentials instead of someone creating the
 * first Admin by hand (which is otherwise a chicken-and-egg problem: only an
 * Admin can approve a registration, and registration is the only other way
 * to create a user).
 *
 * Run with `npm run db:seed`. Safe to re-run — it upserts by email.
 *
 * These credentials are for the demo/reviewer environment only. Rotate or
 * remove them entirely before any real deployment; see README.md.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import * as argon2 from 'argon2';

const DEMO_PASSWORD = 'Demo1234!Passphrase';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  const demoUsers: Array<{ email: string; role: 'ADMIN' | 'EDITOR' | 'CONTRIBUTOR' | 'VIEWER' }> = [
    { email: 'admin@example.com', role: 'ADMIN' },
    { email: 'editor@example.com', role: 'EDITOR' },
    { email: 'contributor@example.com', role: 'CONTRIBUTOR' },
    { email: 'viewer@example.com', role: 'VIEWER' },
  ];

  for (const { email, role } of demoUsers) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        role,
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });
    console.log(`Seeded ${role} — ${email} / ${DEMO_PASSWORD}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

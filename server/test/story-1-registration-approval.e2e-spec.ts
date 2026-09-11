import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Exercises the exact scenario docs/story-1-admin-creates-users.md §9 calls
 * for, against a real running app and a real (dedicated test) Postgres
 * database — no mocks. If this file passes, the story is actually true, not
 * just true in isolated unit tests.
 */
describe('Story 1: registration & admin approval (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminPassword = 'admin-e2e-password';
  const adminEmail = `admin-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts's bootstrap — TestingModule doesn't run main.ts, so
    // the same middleware/pipes have to be applied here explicitly.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // The same bootstrap problem production solves with prisma/seed.ts:
    // only an Admin can approve a registration, so the test creates one
    // directly rather than going through the API.
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash(adminPassword),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { contains: '@example.com' } },
    });
    await app.close();
  });

  const agent = () => request(app.getHttpServer());

  async function loginAndGetCookies(email: string, password: string) {
    const res = await agent()
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.get('Set-Cookie') as unknown as string[];
  }

  it('walks the full story: register → blocked login → approve → login → role enforcement', async () => {
    const applicantEmail = `contributor-${Date.now()}@example.com`;
    const applicantPassword = 'a-strong-passphrase';

    // 1. Public registration — no auth required, does not log the caller in.
    const registerRes = await agent()
      .post('/auth/register')
      .send({
        email: applicantEmail,
        password: applicantPassword,
        requestedRole: 'CONTRIBUTOR',
      })
      .expect(201);
    expect(registerRes.body.status).toBe('PENDING_APPROVAL');
    expect(registerRes.headers['set-cookie']).toBeUndefined();

    // 2. Login while pending is refused with a machine-readable reason
    //    (decision 8.4) — distinct from RolesGuard's generic 403.
    const pendingLoginRes = await agent()
      .post('/auth/login')
      .send({ email: applicantEmail, password: applicantPassword })
      .expect(403);
    expect(pendingLoginRes.body.reason).toBe('PENDING_APPROVAL');

    // 3. Admin logs in and finds the request on the pending list, complete
    //    with the applicant's non-binding requestedRole hint.
    const adminCookies = await loginAndGetCookies(adminEmail, adminPassword);
    const pendingListRes = await agent()
      .get('/users?status=PENDING_APPROVAL')
      .set('Cookie', adminCookies)
      .expect(200);
    const pending = pendingListRes.body.find(
      (u: { email: string }) => u.email === applicantEmail,
    );
    expect(pending.requestedRole).toBe('CONTRIBUTOR');
    expect(pending.role).toBeNull();

    // 4. Admin approves with their OWN choice of role — happens to match
    //    the hint here, but the endpoint accepts any role regardless.
    const approveRes = await agent()
      .patch(`/users/${pending.id}/approve`)
      .set('Cookie', adminCookies)
      .send({ role: 'CONTRIBUTOR' })
      .expect(200);
    expect(approveRes.body.status).toBe('ACTIVE');
    expect(approveRes.body.role).toBe('CONTRIBUTOR');
    expect(approveRes.body.approvedById).toBeTruthy();

    // 5. The same credentials now log in and receive cookies.
    const contributorCookies = await loginAndGetCookies(
      applicantEmail,
      applicantPassword,
    );
    expect(contributorCookies.some((c) => c.startsWith('access_token='))).toBe(
      true,
    );
    expect(contributorCookies.some((c) => c.startsWith('refresh_token='))).toBe(
      true,
    );

    // 6. A Contributor calling an Admin-only route gets the *generic* 403 —
    //    not a redirect, not a 401, and no reason field (that's specific to
    //    the login-while-pending case, not a role mismatch).
    const forbiddenRes = await agent()
      .get('/users')
      .set('Cookie', contributorCookies)
      .expect(403);
    expect(forbiddenRes.body.message).toBe('Forbidden resource');
    expect(forbiddenRes.body.reason).toBeUndefined();

    // 7. No cookie at all is a 401, distinctly, not a 403.
    await agent().get('/users').expect(401);
  });

  it('rejects a pending registration, and a rejected account can never authenticate', async () => {
    const rejectedEmail = `rejected-${Date.now()}@example.com`;
    const rejectedPassword = 'another-strong-passphrase';

    await agent()
      .post('/auth/register')
      .send({ email: rejectedEmail, password: rejectedPassword })
      .expect(201);

    const adminCookies = await loginAndGetCookies(adminEmail, adminPassword);
    const pendingListRes = await agent()
      .get('/users?status=PENDING_APPROVAL')
      .set('Cookie', adminCookies)
      .expect(200);
    const pending = pendingListRes.body.find(
      (u: { email: string }) => u.email === rejectedEmail,
    );

    await agent()
      .patch(`/users/${pending.id}/reject`)
      .set('Cookie', adminCookies)
      .expect(200);

    const loginRes = await agent()
      .post('/auth/login')
      .send({ email: rejectedEmail, password: rejectedPassword })
      .expect(403);
    expect(loginRes.body.reason).toBe('REJECTED');
  });

  it('re-registering a rejected email reuses the row and preserves rejectionCount (decision 8.3)', async () => {
    const email = `reapply-${Date.now()}@example.com`;
    const adminCookies = await loginAndGetCookies(adminEmail, adminPassword);

    await agent()
      .post('/auth/register')
      .send({ email, password: 'first-attempt-password' })
      .expect(201);

    const firstPending = (
      await agent()
        .get('/users?status=PENDING_APPROVAL')
        .set('Cookie', adminCookies)
        .expect(200)
    ).body.find((u: { email: string }) => u.email === email);

    await agent()
      .patch(`/users/${firstPending.id}/reject`)
      .set('Cookie', adminCookies)
      .expect(200);

    const reRegisterRes = await agent()
      .post('/auth/register')
      .send({ email, password: 'second-attempt-password' })
      .expect(201);

    // Same row, not a new one.
    expect(reRegisterRes.body.id).toBe(firstPending.id);

    const afterReapply = await agent()
      .get(`/users/${firstPending.id}`)
      .set('Cookie', adminCookies)
      .expect(200);
    expect(afterReapply.body.status).toBe('PENDING_APPROVAL');
    expect(afterReapply.body.rejectionCount).toBe(1);
  });

  it('rotates the refresh token on use and revokes the whole session on reuse', async () => {
    const email = `rotation-${Date.now()}@example.com`;
    const password = 'a-strong-passphrase';
    const adminCookies = await loginAndGetCookies(adminEmail, adminPassword);

    await agent().post('/auth/register').send({ email, password }).expect(201);
    const pending = (
      await agent()
        .get('/users?status=PENDING_APPROVAL')
        .set('Cookie', adminCookies)
        .expect(200)
    ).body.find((u: { email: string }) => u.email === email);
    await agent()
      .patch(`/users/${pending.id}/approve`)
      .set('Cookie', adminCookies)
      .send({ role: 'VIEWER' })
      .expect(200);

    const originalCookies = await loginAndGetCookies(email, password);

    const refreshRes = await agent()
      .post('/auth/refresh')
      .set('Cookie', originalCookies)
      .expect(200);
    const rotatedCookies = refreshRes.get('Set-Cookie') as unknown as string[];
    expect(rotatedCookies.some((c) => c.startsWith('refresh_token='))).toBe(
      true,
    );

    // The pre-rotation cookie is now dead — presenting it again is theft
    // detection, not just "expired token".
    const reuseRes = await agent()
      .post('/auth/refresh')
      .set('Cookie', originalCookies)
      .expect(401);
    expect(reuseRes.body.message).toMatch(/log in again/i);

    // And the family it belonged to — including the token that replaced
    // it — is now revoked too.
    await agent()
      .post('/auth/refresh')
      .set('Cookie', rotatedCookies)
      .expect(401);
  });

  it('logout revokes the session — the same cookies stop working afterwards', async () => {
    const email = `logout-${Date.now()}@example.com`;
    const password = 'a-strong-passphrase';
    const adminCookies = await loginAndGetCookies(adminEmail, adminPassword);

    await agent().post('/auth/register').send({ email, password }).expect(201);
    const pending = (
      await agent()
        .get('/users?status=PENDING_APPROVAL')
        .set('Cookie', adminCookies)
        .expect(200)
    ).body.find((u: { email: string }) => u.email === email);
    await agent()
      .patch(`/users/${pending.id}/approve`)
      .set('Cookie', adminCookies)
      .send({ role: 'VIEWER' })
      .expect(200);

    const cookies = await loginAndGetCookies(email, password);

    await agent().post('/auth/logout').set('Cookie', cookies).expect(200);
    await agent().post('/auth/refresh').set('Cookie', cookies).expect(401);
  });

  it('an Admin cannot deactivate their own account', async () => {
    const adminCookies = await loginAndGetCookies(adminEmail, adminPassword);
    const self = (
      await agent()
        .get('/users?status=ACTIVE')
        .set('Cookie', adminCookies)
        .expect(200)
    ).body.find((u: { email: string }) => u.email === adminEmail);

    await agent()
      .patch(`/users/${self.id}/status`)
      .set('Cookie', adminCookies)
      .send({ status: 'DEACTIVATED' })
      .expect(403);
  });
});

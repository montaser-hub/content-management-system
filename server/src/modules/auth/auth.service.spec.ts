import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { AppConfig } from '../../config/configuration';
import { generateOpaqueToken } from '../../common/utils/opaque-token.util';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let prisma: {
    user: Record<string, jest.Mock>;
    refreshToken: Record<string, jest.Mock>;
  };
  let jwt: { signAsync: jest.Mock };
  let config: { getOrThrow: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      refreshToken: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    config = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'auth.accessTokenTtlSeconds': 900,
          'auth.refreshTokenTtlDays': 7,
        };
        return values[key];
      }),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService<AppConfig, true>,
    );
  });

  describe('register', () => {
    it('creates a new PENDING_APPROVAL user when the email is unused', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'new-user',
        status: 'PENDING_APPROVAL',
      });

      const result = await service.register({
        email: '  New.User@Example.com ',
        password: 'a-strong-passphrase',
      });

      expect(result).toEqual({ id: 'new-user', status: 'PENDING_APPROVAL' });
      const createArgs = prisma.user.create.mock.calls[0][0];
      // Email is normalized (trimmed + lower-cased) before it ever reaches
      // the database — see docs/tech-stack-decisions.md.
      expect(createArgs.data.email).toBe('new.user@example.com');
      expect(createArgs.data.status).toBe('PENDING_APPROVAL');
    });

    it.each(['PENDING_APPROVAL', 'ACTIVE', 'DEACTIVATED'])(
      'refuses to re-register an existing %s account',
      async (status) => {
        prisma.user.findUnique.mockResolvedValue({ id: 'existing', status });

        await expect(
          service.register({
            email: 'taken@example.com',
            password: 'a-strong-passphrase',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.user.update).not.toHaveBeenCalled();
      },
    );

    it('reuses the row for a REJECTED account instead of creating a duplicate (decision 8.3)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'rejected-user',
        status: 'REJECTED',
      });
      prisma.user.update.mockResolvedValue({
        id: 'rejected-user',
        status: 'PENDING_APPROVAL',
      });

      const result = await service.register({
        email: 'reapply@example.com',
        password: 'a-strong-passphrase',
        requestedRole: 'CONTRIBUTOR',
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rejected-user' },
          data: expect.objectContaining({
            status: 'PENDING_APPROVAL',
            requestedRole: 'CONTRIBUTOR',
          }),
        }),
      );
      // rejectionCount/lastRejectedAt are deliberately absent from the
      // update payload — only UsersService.reject writes them.
      expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty(
        'rejectionCount',
      );
      expect(result.status).toBe('PENDING_APPROVAL');
    });
  });

  describe('login', () => {
    it('rejects a non-existent email with a generic message (no user enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('rejects a wrong password with the same generic message', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        passwordHash: await argon2.hash('correct-password'),
        status: 'ACTIVE',
      });

      await expect(
        service.login({ email: 'u1@example.com', password: 'wrong-password' }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('refuses a non-ACTIVE account with a machine-readable reason (decision 8.4)', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u2',
        passwordHash,
        status: 'PENDING_APPROVAL',
      });

      expect.assertions(2);
      try {
        await service.login({
          email: 'u2@example.com',
          password: 'correct-password',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toMatchObject({
          reason: 'PENDING_APPROVAL',
        });
      }
    });

    it('logs an ACTIVE user in and issues both cookies-worth of tokens', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u3',
        email: 'u3@example.com',
        role: 'EDITOR',
        status: 'ACTIVE',
        passwordHash,
      });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const { user, tokens } = await service.login({
        email: 'u3@example.com',
        password: 'correct-password',
      });

      expect(user).toEqual({
        id: 'u3',
        email: 'u3@example.com',
        role: 'EDITOR',
        status: 'ACTIVE',
      });
      expect(tokens.accessToken).toBe('signed.jwt.token');
      expect(tokens.refreshToken).toMatch(/^[0-9a-f-]{36}\./);
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('refresh', () => {
    it('rejects a missing or malformed cookie outright', async () => {
      await expect(service.refresh(undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(service.refresh('not-a-valid-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('revokes the whole family when an already-used token is replayed (reuse detection)', async () => {
      const { id, secret, token } = generateOpaqueToken();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id,
        familyId: 'family-1',
        userId: 'u1',
        secretHash: await argon2.hash(secret),
        revokedAt: new Date(), // already consumed
        expiresAt: new Date(Date.now() + 1000 * 60),
        user: { status: 'ACTIVE' },
      });

      await expect(service.refresh(token)).rejects.toThrow(
        'Session revoked — please log in again',
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rotates a valid token: consumes it and issues a new one in the same family', async () => {
      const { id, secret, token } = generateOpaqueToken();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id,
        familyId: 'family-2',
        userId: 'u1',
        secretHash: await argon2.hash(secret),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: { status: 'ACTIVE' },
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const tokens = await service.refresh(token);

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ familyId: 'family-2' }),
        }),
      );
      expect(tokens.accessToken).toBe('signed.jwt.token');
    });
  });

  describe('logout', () => {
    it('is a no-op that does not throw when there is no cookie to revoke', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('revokes the entire session family for a valid cookie', async () => {
      const { id, token } = generateOpaqueToken();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id,
        familyId: 'family-3',
      });

      await service.logout(token);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-3', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});

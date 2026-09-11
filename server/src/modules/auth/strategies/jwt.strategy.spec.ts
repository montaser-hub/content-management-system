import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';
import type { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue('test-secret'),
  } as unknown as ConfigService<AppConfig, true>;

  function buildStrategy(findUniqueResult: unknown) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(findUniqueResult) },
    } as unknown as PrismaService;
    return new JwtStrategy(config, prisma);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  it('accepts a token for an active user and returns id/email/role only', async () => {
    const strategy = buildStrategy({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordChangedAt: null,
    });

    await expect(
      strategy.validate({ sub: 'user-1', iat: nowSeconds }),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'ADMIN',
    });
  });

  it('rejects when the user no longer exists', async () => {
    const strategy = buildStrategy(null);

    await expect(
      strategy.validate({ sub: 'ghost', iat: nowSeconds }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a still-pending or deactivated account even with a structurally valid token', async () => {
    const strategy = buildStrategy({
      id: 'user-2',
      email: 'pending@example.com',
      role: null,
      status: 'PENDING_APPROVAL',
      passwordChangedAt: null,
    });

    await expect(
      strategy.validate({ sub: 'user-2', iat: nowSeconds }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token issued before the password was last changed', async () => {
    const strategy = buildStrategy({
      id: 'user-3',
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      // Password changed one hour after this token's iat.
      passwordChangedAt: new Date((nowSeconds + 3600) * 1000),
    });

    await expect(
      strategy.validate({ sub: 'user-3', iat: nowSeconds }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

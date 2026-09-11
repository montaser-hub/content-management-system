import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import {
  generateOpaqueToken,
  parseOpaqueToken,
} from '../../common/utils/opaque-token.util';
import type { AppConfig } from '../../config/configuration';
import { UserStatus, type User } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

export interface IssuedTokens {
  accessToken: string;
  accessTokenTtlSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
}

/**
 * Every status except REJECTED means "an account already exists at this
 * email" for registration purposes — REJECTED is deliberately absent, since
 * that's the one status decision 8.3 reuses the row for instead.
 */
const NON_REUSABLE_STATUSES: UserStatus[] = [
  UserStatus.PENDING_APPROVAL,
  UserStatus.ACTIVE,
  UserStatus.DEACTIVATED,
];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Story 1, step 1–2: public self-registration. Never issues cookies — a
   * pending account is not a logged-in account (see
   * docs/story-1-admin-creates-users.md §4.2).
   */
  async register(dto: RegisterDto): Promise<Pick<User, 'id' | 'status'>> {
    const email = this.normalizeEmail(dto.email);
    const passwordHash = await argon2.hash(dto.password);

    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (NON_REUSABLE_STATUSES.includes(existing.status)) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }

      // existing.status === 'REJECTED' — decision 8.3: reuse the row instead
      // of creating a duplicate or blocking the email permanently.
      // rejectionCount/lastRejectedAt are untouched here — they're only
      // written when an Admin rejects (UsersService.reject), so they keep
      // recording "how many times, and when" across every re-application.
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          requestedRole: dto.requestedRole ?? null,
          status: 'PENDING_APPROVAL',
        },
        select: { id: true, status: true },
      });
    }

    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        requestedRole: dto.requestedRole ?? null,
        status: 'PENDING_APPROVAL',
      },
      select: { id: true, status: true },
    });
  }

  /**
   * Story 1, steps 4 & 8: login for any account, Admin or a newly-approved
   * user alike. Deliberately generic on failure ("Invalid credentials") for
   * both a wrong password and a non-existent email — unlike registration's
   * conflict message, login must never let an attacker distinguish the two.
   */
  async login(dto: LoginDto): Promise<{
    user: Pick<User, 'id' | 'email' | 'role' | 'status'>;
    tokens: IssuedTokens;
  }> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      // Distinct from RolesGuard's generic 403 — this carries a machine
      // readable `reason` so the frontend can show "awaiting approval"
      // instead of a generic "forbidden" (decision 8.4 in the story doc).
      throw new ForbiddenException({
        message: 'Account is not active',
        reason: user.status,
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(user.id, randomUUID());

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      tokens,
    };
  }

  /**
   * Story 1 decision 8.4: rotate-on-use with reuse detection. Every call
   * invalidates the token it was given and issues a new one in the same
   * `familyId`; a token that's already been invalidated being presented
   * again is treated as theft, and the whole family is revoked.
   */
  async refresh(refreshCookieValue: string | undefined): Promise<IssuedTokens> {
    const parsed = refreshCookieValue
      ? parseOpaqueToken(refreshCookieValue)
      : null;

    if (!parsed) {
      throw new UnauthorizedException();
    }

    const tokenRow = await this.prisma.refreshToken.findUnique({
      where: { id: parsed.id },
      include: { user: true },
    });

    if (!tokenRow) {
      throw new UnauthorizedException();
    }

    const secretMatches = await argon2.verify(
      tokenRow.secretHash,
      parsed.secret,
    );

    if (tokenRow.revokedAt || !secretMatches) {
      // Either an already-consumed token came back, or the secret doesn't
      // match a token id that does exist — both look like a stolen or
      // tampered token, not ordinary use. Kill the whole session chain.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: tokenRow.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session revoked — please log in again');
    }

    if (tokenRow.expiresAt < new Date() || tokenRow.user.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }

    // Consume this token, then issue its replacement in the same family.
    // These are two separate statements rather than one transaction: if the
    // revoke succeeds but issuing the replacement fails, the user simply has
    // to log in again — a safe failure mode, not a security hole.
    await this.prisma.refreshToken.update({
      where: { id: tokenRow.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(tokenRow.userId, tokenRow.familyId);
  }

  /** Revokes the entire session chain the presented refresh token belongs to. Idempotent by design — logout never errors on an already-invalid cookie. */
  async logout(refreshCookieValue: string | undefined): Promise<void> {
    const parsed = refreshCookieValue
      ? parseOpaqueToken(refreshCookieValue)
      : null;

    if (!parsed) {
      return;
    }

    const tokenRow = await this.prisma.refreshToken.findUnique({
      where: { id: parsed.id },
    });

    if (!tokenRow) {
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: { familyId: tokenRow.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    familyId: string,
  ): Promise<IssuedTokens> {
    const accessTokenTtlSeconds = this.config.getOrThrow(
      'auth.accessTokenTtlSeconds',
      { infer: true },
    );
    const refreshTokenTtlDays = this.config.getOrThrow(
      'auth.refreshTokenTtlDays',
      { infer: true },
    );

    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { expiresIn: accessTokenTtlSeconds },
    );

    const { id, secret, token: refreshToken } = generateOpaqueToken();
    const secretHash = await argon2.hash(secret);
    const refreshTokenTtlSeconds = refreshTokenTtlDays * 24 * 60 * 60;

    await this.prisma.refreshToken.create({
      data: {
        id,
        userId,
        familyId,
        secretHash,
        expiresAt: new Date(Date.now() + refreshTokenTtlSeconds * 1000),
      },
    });

    return {
      accessToken,
      accessTokenTtlSeconds,
      refreshToken,
      refreshTokenTtlSeconds,
    };
  }
}

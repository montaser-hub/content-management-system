import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import {
  ACCESS_TOKEN_COOKIE,
  getCookie,
} from '../../../common/constants/auth.constants';
import type { AppConfig } from '../../../config/configuration';
import type { Role } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  iat: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role | null;
}

function cookieExtractor(req: Request): string | null {
  return getCookie(req, ACCESS_TOKEN_COOKIE) ?? null;
}

/**
 * Verifies the JWT pulled from the `access_token` cookie, then looks the
 * user up fresh rather than trusting the token's own claims for anything but
 * identity (`sub`). That lookup buys two things a stateless JWT can't:
 *
 *  - If an Admin deactivates this user after the token was issued, the very
 *    next request is rejected — no waiting out the token's ~15 minute life.
 *  - If the password changed after the token was issued (`iat` predates
 *    `passwordChangedAt`), the token is treated as stale even though it
 *    hasn't technically expired yet.
 *
 * The cost is one indexed primary-key lookup per authenticated request,
 * which is cheap enough not to matter here.
 *
 * Every failure path throws UnauthorizedException explicitly rather than a
 * bare Error — Passport surfaces an uncaught error from validate() as an
 * opaque 500, not a 401, which would be the wrong status for "not logged
 * in" or "no longer valid."
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow('auth.accessTokenSecret', {
        infer: true,
      }),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        passwordChangedAt: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }

    if (
      user.passwordChangedAt &&
      payload.iat * 1000 < user.passwordChangedAt.getTime()
    ) {
      throw new UnauthorizedException();
    }

    return { id: user.id, email: user.email, role: user.role };
  }
}

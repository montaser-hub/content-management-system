import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../modules/auth/strategies/jwt.strategy';

/**
 * Pulls the already-verified user off the request (attached by
 * JwtAuthGuard/JwtStrategy — see src/types/express.d.ts for where `req.user`
 * is declared) instead of every controller reaching into `req.user` and
 * re-casting it. Only valid behind JwtAuthGuard, which is what guarantees
 * `user` is actually present by the time a handler runs.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user!;
  },
);

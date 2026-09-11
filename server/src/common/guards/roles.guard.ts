import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../../generated/prisma/client.js';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * The actual enforcement mechanism behind the permission matrix
 * (docs/permission-matrix.md) and the requirement that an unauthorized call
 * gets a real 403, not a hidden UI button.
 *
 * Must run after JwtAuthGuard (Nest evaluates guards in the order they're
 * listed in @UseGuards) — it reads `request.user`, which only exists once
 * the JWT has already been verified.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() on this route at all — nothing to enforce beyond
    // authentication, which JwtAuthGuard already handled.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    // A pending or rejected account has role: null (see
    // docs/story-1-admin-creates-users.md §6) — there is nothing in
    // requiredRoles for `undefined`/`null` to match, so this denies them
    // the same way it denies a wrong role, with no special-casing needed.
    if (!user || !requiredRoles.includes(user.role as Role)) {
      throw new ForbiddenException('Forbidden resource');
    }

    return true;
  }
}

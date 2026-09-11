import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../generated/prisma/client.js';

export const ROLES_KEY = 'roles';

/**
 * Declares which roles may call a route, e.g. `@Roles('ADMIN')`. Read by
 * RolesGuard, which is what actually enforces it — this decorator only
 * attaches metadata, it has no effect on its own.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

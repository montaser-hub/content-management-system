import type { AuthenticatedUser } from '../modules/auth/strategies/jwt.strategy';

/**
 * `@types/passport` already declares `Request.user?: Express.User`, where
 * `Express.User` is an intentionally empty interface for applications to
 * extend — extending it (rather than re-declaring `Request.user` outright,
 * which conflicts with Passport's own declaration) is what makes
 * `req.user` resolve to this project's actual user shape everywhere.
 * `JwtStrategy` (via Passport) attaches it once the access-token cookie has
 * been verified — declaring the shape once here means every guard,
 * decorator, and controller that reads `req.user` shares one definition
 * instead of each file declaring its own local `Request` extension.
 */
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional: extends the ambient Express.User interface via declaration merging, not a redundant supertype.
    interface User extends AuthenticatedUser {}
  }
}

export {};

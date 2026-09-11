import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Thin wrapper around Passport's 'jwt' strategy (see JwtStrategy). Kept as
 * its own class, even though it adds no logic today, so every protected
 * route depends on `JwtAuthGuard` rather than the string literal `'jwt'` —
 * the strategy name can change without touching every controller.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

import type { CookieOptions, Request } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * `@types/cookie-parser` types `req.cookies` as `Record<string, any>` — this
 * is the one place that widens it back to the shape this app actually
 * relies on (string-keyed cookie values), so every call site reads a typed
 * cookie instead of each one re-declaring its own cast or `Request`
 * extension.
 */
export function getCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[name];
}

/**
 * Shared flags for both auth cookies. `httpOnly` keeps them invisible to
 * JavaScript (the XSS-mitigation the team agreed on in
 * docs/story-1-admin-creates-users.md §4); `sameSite: 'strict'` is the CSRF
 * mitigation for the same reason cookies reopen that risk in the first
 * place — see that doc's §4.3 for the full reasoning.
 */
export function baseCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
  };
}

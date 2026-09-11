import { randomBytes, randomUUID } from 'node:crypto';

/**
 * A refresh-token cookie is `${id}.${secret}` — `id` names which
 * RefreshToken row to look up, `secret` is what actually gets verified
 * against that row's stored hash. Splitting the two means "does this token
 * exist" is an indexed lookup by `id`, while "is it the real one" is a
 * constant-time-friendly hash comparison — never a table scan hashing every
 * stored token to find a match.
 *
 * Built on Node's own `crypto` rather than a third-party UUID/random
 * package: the runtime already provides everything this needs.
 */
export function generateOpaqueToken() {
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  return { id, secret, token: `${id}.${secret}` };
}

export function parseOpaqueToken(
  token: string,
): { id: string; secret: string } | null {
  const separatorIndex = token.indexOf('.');
  if (separatorIndex === -1) {
    return null;
  }

  return {
    id: token.slice(0, separatorIndex),
    secret: token.slice(separatorIndex + 1),
  };
}

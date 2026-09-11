# Story 1 — "A user registers, an administrator reviews and assigns a role"

Status: **implemented and verified** — built in `server/`, with 23 unit tests and 6 end-to-end tests (§9) passing against a real Postgres database. Every decision below (§8) matches the running code. Matches the rule in section 5 of the requirements: *"The team should approve this matrix before coding."* The approved matrix itself lives in [permission-matrix.md](permission-matrix.md).
Companion visual: see the published artifact flow diagram (left-to-right, for the mentor walkthrough) shared alongside this file.

> **Revision note:** this replaces the earlier version of the story, where the Admin created every account directly. The team moved to **self-registration + admin approval**: anyone can request an account; nothing they create is usable until an Admin reviews the request and assigns a role. Everything below — endpoints, data model, decisions — has been rewritten around that.

This document turns one line of the demo script into every screen, endpoint, guard, cookie and database row that has to exist for it to be true on stage. Nothing below is optional for Story 1 — it is the load-bearing wall the other seven demo steps stand on (every later story needs `login`, a `role` claim, and a `403` to already work).

---

## 1. Scope of this story

**In scope:** public self-registration, the pending/approval state, admin reviewing and approving/rejecting a request, admin assigning a role at approval time (and changing it later), login/logout, session/JWT cookie issuance, authorization enforcement (403), the User/Role data model.

**Explicitly out of scope for this story** (belongs to later stories or the optional list): article CRUD, media upload, password-reset email (optional feature), audit logs (optional feature), email notifications on approval/rejection (nice-to-have, not required for the demo).

## 2. Actors

| Actor | Represents |
|---|---|
| Applicant / new user | Anyone who submits the public registration form |
| System | NestJS API + PostgreSQL |
| Admin | Logged-in user with `role = ADMIN`; the only one who can approve, reject, or assign roles |

## 3. End-to-end flow (what the demo shows)

1. A new user submits **Register** with email, name, a password of their own choosing, and *optionally* a **requested role** (e.g. "I'd like to be a Contributor") — no auth required.
2. System creates the `User` row with `status = PENDING_APPROVAL`, **no `role` yet**, and stores the requested role separately as a non-binding hint for the reviewer.
3. If that user tries to log in immediately, the login is refused with a clear "pending approval" response — an account existing is not the same as an account being usable.
4. Admin logs in separately (their own, already-approved session).
5. Admin opens the **pending registrations** list, which shows each applicant's requested role alongside their details.
6. Admin approves the request and assigns the actual role in the same action — the requested role is a suggestion, never auto-applied — or rejects it.
7. System sets `status = ACTIVE`, stores the Admin-assigned role, and records which Admin approved it and when.
8. The new user can now log in; login issues the same JWT cookies as any other account.
9. From here on, `RolesGuard` enforces that role on every request — identical to how it would for an Admin-created account.

Steps 5–7 are where the permission matrix stops being a design artifact and becomes a runtime check — see §6. Step 3 is behavior the amended matrix in [permission-matrix.md](permission-matrix.md) now covers explicitly.

## 4. Authentication design — cookie-based JWT

Agreed direction: **JWT, delivered via cookies**, not returned in the JSON body. Rationale: a token in `localStorage`/response body is readable by any injected script (XSS); a token in an `httpOnly` cookie is not. This is unchanged by the move to self-registration — it applies identically to an Admin's session and to a newly-approved user's session.

### 4.1 Tokens

| Token | Lifetime | Cookie name | Flags | Purpose |
|---|---|---|---|---|
| Access token | ~15 min | `access_token` | `httpOnly`, `Secure`, `SameSite=Strict`, `path=/` | Sent on every request; validated by `JwtStrategy`; carries `{ sub, role }` |
| Refresh token | ~7 days | `refresh_token` | `httpOnly`, `Secure`, `SameSite=Strict`, `path=/auth` | Exchanged for a new access token; **hash stored in DB**, rotated on every use — see §8, item 4 |

The refresh token's *hash* (not the raw value) lives in a `RefreshToken` table keyed to the user. That's what makes logout and "revoke all sessions" possible — a stateless-only JWT can't be un-issued before it expires. **Decided:** rotate-on-use with reuse detection (§8, item 4) — every refresh invalidates the token just used and issues a new one from the same `family_id`; if an already-invalidated token is ever presented again, the entire family is revoked and the user is forced to log in again, since that's the signature of a stolen token being replayed.

The cookie's path is `/auth`, not the narrower `/auth/refresh` — `POST /auth/logout` needs to read this cookie too (to know which session family to revoke), and a cookie scoped to `/auth/refresh` alone would never be sent on a request to `/auth/logout`.

### 4.2 Endpoints

| Method & path | Who | Behavior |
|---|---|---|
| `POST /auth/register` | **public, no auth** | Create `User` with `status = PENDING_APPROVAL`, `role = null`, optional `requested_role`; hash the password; does **not** set cookies — a pending account isn't logged in. If the email belongs to a previously-**rejected** row, reuse it (§8, item 3) instead of erroring |
| `POST /auth/login` | anyone with an account | Verify credentials; if `status != ACTIVE` → `403` with `{ "reason": "PENDING_APPROVAL" }` (or `REJECTED`); else set both cookies and update `last_login_at` |
| `POST /auth/refresh` | holder of a valid `refresh_token` cookie | Invalidate the presented token, issue a new one in the same family; if the presented token was **already invalidated**, revoke the whole family and require re-login (§8, item 4) |
| `POST /auth/logout` | authenticated | Revoke the refresh token row, clear both cookies |

### 4.3 CSRF note

Cookie-delivered auth means the browser attaches the cookie automatically, which reopens CSRF — a risk header-based `Authorization: Bearer` tokens don't have. Mitigation for the MVP: `SameSite=Strict` on both cookies (blocks cross-site sends outright) plus rejecting any state-changing request (`POST`/`PATCH`/`DELETE`) that lacks a custom header such as `X-Requested-With`, which a cross-site form post cannot set. `POST /auth/register` is public so it needs its own protection instead (rate limiting / a CAPTCHA-shaped hook) — CSRF doesn't apply to it the same way since it doesn't ride on an existing session.

## 5. Registration review & user management (the Admin-only surface)

| Method & path | Guard | Behavior |
|---|---|---|
| `GET /users?status=pending` | `RolesGuard(ADMIN)` | List accounts awaiting approval |
| `PATCH /users/:id/approve` | `RolesGuard(ADMIN)` | Body `{ role }` — the Admin's own choice, independent of `requested_role`; sets `status = ACTIVE`, stores `role`, `approved_by`, `approved_at` |
| `PATCH /users/:id/reject` | `RolesGuard(ADMIN)` | Sets `status = REJECTED`; account can never log in |
| `GET /users` | `RolesGuard(ADMIN)` | List all users, any status |
| `GET /users/:id` | `RolesGuard(ADMIN)` | Single user detail |
| `PATCH /users/:id/role` | `RolesGuard(ADMIN)` | Change the role of an already-active user |
| `PATCH /users/:id/status` | `RolesGuard(ADMIN)` | Deactivate / reactivate an active user (distinct from approve/reject, which only apply to pending accounts) |

Every row above maps 1:1 to the matrix's bottom line — *"Manage users and roles: Admin = Yes, everyone else = No."* Approve/reject is now formally part of that row in [permission-matrix.md](permission-matrix.md).

## 6. Authorization design

- Every protected route carries `@Roles(Role.ADMIN)` (or whichever roles apply); a global `RolesGuard` reads the `role` claim off the already-verified JWT (never off a client-supplied field) and compares it against the decorator's list.
- **A denied request returns `403 Forbidden` with a JSON body** (`{ "statusCode": 403, "message": "Forbidden resource" }`), per the requirements doc's explicit rule: *"the expected response for an unauthorized API operation should be a proper 403 Forbidden, not merely a hidden button in the interface."* Hiding the "Approve" button in the UI is a UX nicety, not the control — the guard is the control.
- A `PENDING_APPROVAL` or `REJECTED` user has `role = null`, so `RolesGuard` denies them by default even if somehow a token were minted — there's no role to match against. This is a second, independent line of defense on top of §4.2's login block.
- Role source of truth is the `role` column on `User`; the JWT is just a signed, time-boxed copy of it made at login. Consequence: if an Admin demotes a user mid-session, that user's *existing* access token still carries the old role until it expires (≤15 min) or they hit `/auth/refresh`. Worth stating to the team as a known, bounded staleness window rather than a bug.

## 7. Data model touched by this story

```
User
  id                  uuid, pk (Postgres gen_random_uuid())
  email               text, unique                     -- app normalizes (trim + lower-case) before every write/read; see tech-stack-decisions.md
  password_hash       text
  role                enum(ADMIN, EDITOR, CONTRIBUTOR, VIEWER), nullable
  requested_role      enum(ADMIN, EDITOR, CONTRIBUTOR, VIEWER), nullable   -- applicant's hint, never authoritative
  status              enum(PENDING_APPROVAL, ACTIVE, REJECTED, DEACTIVATED), default PENDING_APPROVAL
  approved_by_id      uuid, fk -> User.id, nullable
  approved_at         timestamptz, nullable
  rejection_count     int, default 0
  last_rejected_at    timestamptz, nullable
  password_changed_at timestamptz, nullable             -- lets JwtStrategy invalidate tokens older than the last password change
  created_at          timestamptz
  last_login_at       timestamptz, nullable

RefreshToken
  id            uuid, pk
  user_id       uuid, fk -> User.id
  family_id     uuid                                -- shared by every token in one rotation chain
  secret_hash   text                                -- argon2 hash of the random secret; the raw value only ever exists in the cookie
  expires_at    timestamptz
  revoked_at    timestamptz, nullable
```

Two changes from the direct-create version: `role` is now **nullable** (a pending account has none yet), and `status` is a distinct field from an active/inactive toggle — an Admin turning an *already-approved* account off later is a different event from a registration never having been approved in the first place. Collapsing the two into one boolean would make "why can't this person log in" ambiguous. `requested_role`, `rejection_count`, and `last_rejected_at` implement decisions 2 and 3 below; `family_id` implements decision 4. The exact, current schema lives in `server/prisma/schema.prisma` — this listing exists for readability, not as a second source of truth.

## 8. Decisions

Resolved with the team. Full record for each: the question as raised, every option that was on the table, which one won, and why it beat the *others specifically* — not just why it's good in isolation. These are the answers `RolesGuard`, the Prisma schema, and the frontend copy should all be built against.

### 8.1 Does the matrix need a row for registration?

**Question:** The original matrix (section 5) starts at "Log in" and assumes accounts already exist. Self-registration adds a public, no-account entry point — does that need its own line, or is it close enough to something already there?

**Options considered:**
- **A.** Leave the matrix as-is; treat registration as an unwritten, implicit assumption.
- **B.** Fold it into the existing "Log in" row with a footnote.
- **C.** Add "Submit registration request" as its own row, `Public = Yes`, other roles N/A. ✅ **chosen**

**Decision:** Option C — see [permission-matrix.md](permission-matrix.md), now the approved, versioned source of truth for access rules (superseding the pasted image).

**Why not A:** an access rule that only exists in people's heads is exactly the gap a security-minded reviewer — or a mentor — checks for first. The matrix is supposed to be the enforcement source of truth, not a partial one.
**Why not B:** login and registration have different auth requirements (one needs no account, one needs valid credentials); merging them muddies the one document meant to keep that distinction clear, to save writing a single row.

### 8.2 Who decides the new user's role?

**Question:** Should the applicant choose their own role during registration, and if they do, does that choice take effect on its own or does an Admin still have to set it explicitly?

**Options considered:**
- **A.** No role input at registration at all — Admin picks blind from a completely empty field.
- **B.** Applicant picks a role and it's granted automatically the moment an Admin clicks "Approve."
- **C.** Applicant may suggest a `requested_role`; it's shown as a hint, but the Admin's own explicit choice is what's saved. ✅ **chosen**

**Decision:** Option C. The form collects an optional `requested_role`; the Admin's review screen shows it as context but the actual `role` field starts blank and must be explicitly set.

**Why not A:** zero context slows every review down — the Admin has to go ask the applicant offline what they even want, for the cost of one extra form field.
**Why not B:** auto-granting a self-declared role the instant someone clicks Approve is self-service privilege escalation with an extra step in front of it — it removes the Admin's actual judgment call, which is the entire point of an approval gate. Enterprise access-request systems (Okta, Azure AD) keep this same separation between *requested* and *granted* for exactly this reason.

### 8.3 What happens to a rejected registration?

**Question:** Once an Admin rejects a request, can that same email try again — and if so, does it create a second row, wipe the first one, or something else?

**Options considered:**
- **A.** Permanent block — the row stays `REJECTED` forever; the email can never register again.
- **B.** Soft delete — the row is removed/anonymized so the email is free to start over with no history kept.
- **C.** Reusable row — reset to `PENDING_APPROVAL` on reapply; `rejection_count` and `last_rejected_at` preserve the history. ✅ **chosen**

**Decision:** Option C. On a new registration attempt against a `REJECTED` email, the existing row resets to `PENDING_APPROVAL` with the new password, `rejection_count` increments, and `last_rejected_at` is preserved.

**Why not A:** a permanent block has no appeal path — a typo, a since-corrected situation, or a mentor testing the flow twice during the demo has no way forward. An MVP demo is exactly the wrong place to risk a real account getting locked out for good.
**Why not B:** deleting the row throws away the one signal an Admin would want on a second look ("this applicant was already rejected once"), and it complicates the `email` uniqueness constraint with a "deleted vs. exists" distinction that C never needs — no partial indexes or soft-delete tombstones required.

### 8.4 How should refresh tokens behave?

**Question:** Does a refresh token stay the same secret for its whole ~7-day life, or does it change on every use — and if it changes, what happens when an old one gets presented again?

**Options considered:**
- **A.** Static token — issued once at login, unchanged until it naturally expires.
- **B.** Rotate-on-use, no reuse check — each refresh issues a new token, but an old, already-used one is just rejected as "invalid," nothing more.
- **C.** Rotate-on-use + reuse detection — same rotation as B, but a reused token revokes the entire token family and forces re-login. ✅ **chosen**

**Decision:** Option C. Every `/auth/refresh` call invalidates the token it was given and issues a new one sharing the same `family_id`. If a token that's already been invalidated is ever presented again, the *entire family* is revoked and the user must log in from scratch.

**Why not A:** one secret valid for up to a week means a single leak (a compromised device, an accidental log line) buys an attacker a week of silent access with nothing on our side to notice.
**Why not B:** rotation alone shrinks the window a stolen token is useful for, but without a reuse check, a legitimate user and an attacker both holding the same dead token just look like two ordinary refreshes — the theft itself stays invisible. C turns "an old token came back" into an explicit, actionable signal, for a few extra lines of logic and one extra column. This is the standard OAuth2 refresh-rotation pattern used by Auth0 and most modern IdPs.

### 8.5 How should the four roles be stored?

**Question:** Should `role` be a fixed Postgres `enum`, or rows in a separate `roles` table the product could extend later without a schema migration?

**Options considered:**
- **A.** Postgres `enum` — role is one of four fixed values, enforced by the column type itself. ✅ **chosen**
- **B.** `roles` lookup table + foreign key — adding a new role later is an `INSERT`, not a migration.
- **C.** `roles` + `user_roles` join table — full many-to-many, a user could hold more than one role at once.

**Decision:** Option A, for the MVP, with a documented migration path to B/C rather than a permanent constraint.

**Why not B or C:** the matrix fixes exactly four roles by contract — there's no stated need to invent new roles or let one person hold two at once, so building that flexibility now is solving a problem that doesn't exist (and B/C both add a join to every permission check for no present benefit). Prisma's native enum support (see [tech-stack-decisions.md](tech-stack-decisions.md)) means moving from A to B later, if it's ever actually needed, is a normal, reviewable migration, not a rewrite — so choosing the simpler option now isn't a one-way door.

## 9. Test coverage (per the MVP's "Testing" row) — implemented

**Unit** (`server/src/**/*.spec.ts`, 23 tests, Prisma/JWT/Config mocked out):

- `RolesGuard` — allows a matching role and a route with no `@Roles()` at all; denies a wrong role, a `null` role (pending/rejected), and a missing user, always with the generic 403.
- `JwtStrategy` — accepts an active user's token; rejects a deleted user, a still-pending/deactivated account, and a token issued before the account's last password change.
- `AuthService` — every branch of register (new email, taken email by status, rejected-email reuse), login (unknown email, wrong password, non-active status with its `reason`, success), refresh (malformed cookie, reuse detection revoking the family, successful rotation), and logout (no-op on a missing cookie, family revocation on a valid one).

**End-to-end** (`server/test/*.e2e-spec.ts`, 6 tests, real app + a dedicated `cms_test_db` database, no mocks):

1. Full story: register → blocked pending login with `reason` → Admin sees the request with its `requestedRole` hint → approves with their own role choice → same credentials log in and receive cookies → a Contributor hits an Admin-only route and gets the generic 403 → no cookie at all is a 401.
2. Reject a pending registration; the rejected account can never log in.
3. Re-registering a rejected email reuses the same row and preserves `rejectionCount` (decision 8.3).
4. Refresh rotates the token; replaying the pre-rotation cookie revokes the whole family, including the token that replaced it.
5. Logout revokes the session — the same cookies stop working immediately after.
6. An Admin cannot deactivate their own account.

Run with `npm test` (unit) and `npm run test:e2e` (e2e) from `server/`. See [tech-stack-decisions.md](tech-stack-decisions.md) for why each piece of the stack was chosen, and [implementation-log.md](implementation-log.md) for how the project was actually built, step by step.

# Implementation log: building Story 1, step by step

This document is a complete, ordered account of how this project was built: every command that was run, in sequence, and the reasoning behind each decision — including the problems that came up along the way and how they were actually resolved. It serves two purposes: reproducing the project from an empty folder, and acting as a reference for extending it — adding a new protected endpoint, or understanding why the codebase does something one way rather than the more obvious alternative.

Companion reading: [tech-stack-decisions.md](tech-stack-decisions.md) is the destination — what this project ended up with, and why. This file is the route — how it got there, in order.

**Platform coverage:** every command below has been verified to work as written on **Windows** (PowerShell), **macOS**, and **Linux**. The large majority — every `npm`, `npx`, `docker`, and `prisma` command — is identical on all three; PowerShell even ships `cp` and `rm` as aliases for its own file-management commands, so short commands like `cp .env.example .env` work unchanged. Two things do differ and are called out explicitly where they occur: installing Node.js itself (step 1) and a couple of shell-specific commands with Unix-style flags (e.g. `rm -rf`, noted inline with a Windows equivalent). Where a command wraps across multiple lines using a trailing `\`, that's bash's line-continuation syntax for readability — on PowerShell either swap it for a trailing backtick `` ` ``, or just paste the whole command as one line; both produce the same result.

---

## 0. Before you start

You need three things installed: **Node.js**, **Docker**, and **Git** (optional, but assumed for the version-control commands elsewhere in this repo's docs). Nothing else has to be installed globally — the project brings its own CLI tools via `npx`/`npm run`.

**Docker**, specifically:

- **Windows / macOS:** install [Docker Desktop](https://www.docker.com/products/docker-desktop/). On Windows, Docker Desktop uses the WSL2 backend by default, which its installer sets up automatically — no separate WSL configuration needed for this project.
- **Linux:** install [Docker Engine](https://docs.docker.com/engine/install/) plus the Compose plugin (`docker compose`, not the older standalone `docker-compose`) via your distribution's package manager.

Once installed, `docker`, `docker compose`, and every command using them in this document are identical across all three operating systems.

## 1. Install a current Node.js LTS release

**Why Node 24, specifically, before anything else:** Node's release line alternates — every even major version becomes an LTS ("Long-Term Support") release each October, supported for roughly three years. Picking the current Active LTS instead of whatever `latest` happens to be is a deliberate, boring choice: it gets security patches for years, and the whole npm ecosystem targets it first. Whichever install method you use, run `node -v` afterward and confirm it — if a project's setup assumes one Node version and you're on a different one, a surprising number of later problems trace back to that mismatch.

**macOS / Linux**, using [nvm](https://github.com/nvm-sh/nvm) (Node Version Manager):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

nvm install 24.20.0     # the current Active LTS release ("Krypton") at time of writing
nvm alias default 24.20.0
node -v                 # v24.20.0
```

A gotcha worth knowing about: `nvm use` only affects the *current shell*. Every new terminal session (and every non-interactive script/tool invocation) starts back on whatever Node the OS has installed by default, unless `nvm.sh` gets re-sourced first (the installer normally adds that to your shell's startup file automatically — if `nvm` stops being recognized in a new terminal, that line is what to check). `nvm alias default` fixes this for new sessions going forward.

**Windows**, using [nvm-windows](https://github.com/coreybutler/nvm-windows) (a separate project from `nvm` above, purpose-built for Windows — the original `nvm` doesn't run natively on it):

```powershell
# Download and run the installer from:
# https://github.com/coreybutler/nvm-windows/releases (nvm-setup.exe)
# Then, in a new PowerShell window:
nvm install 24.20.0
nvm use 24.20.0
node -v                 # v24.20.0
```

No `export`/`source` step is needed on Windows — nvm-windows manages the active version directly, without depending on a shell profile being re-sourced.

**Either platform**, without a version manager at all: download the Node 24 LTS installer directly from [nodejs.org](https://nodejs.org/) — simplest option if you don't need multiple Node versions on the same machine, works identically on Windows, macOS, and Linux.

**Learn more:** [Node.js Releases](https://nodejs.org/en/about/previous-releases) · [nvm](https://github.com/nvm-sh/nvm) · [nvm-windows](https://github.com/coreybutler/nvm-windows)

## 2. Scaffold the NestJS project

```bash
npx --yes @nestjs/cli@latest new server --package-manager npm --skip-git --language ts
```

This is where the first real decision showed up. `@latest` resolved to NestJS **12.0.1** — and installing `@nestjs/throttler` (a mainstream, actively-maintained rate-limiting package) against it failed:

```
peer @nestjs/common@"^7.0.0 || ^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0" from @nestjs/throttler@6.5.0
```

Throttler's own peer range didn't include 12 yet. That's a signal, not a one-off — a framework major that's this fresh hasn't had time for its ecosystem to catch up. So the project pins to the previous major instead:

```bash
rm -rf server   # Windows PowerShell: Remove-Item -Recurse -Force server
npx --yes @nestjs/cli@11.0.24 new server --package-manager npm --skip-git --language ts
```

Then, in `server/package.json`, pinned every `@nestjs/*` dependency to the latest **11.x** patch (`^11.2.3`), not `^11.0.1` as scaffolded — same major, more bugfixes.

**Why this matters as a general skill:** "use the latest version" is not the same instruction as "use the most current version." The right one is usually the newest release whose *ecosystem* has caught up to it — check a couple of the packages you actually depend on before committing to a brand-new major.

**Learn more:** [NestJS CLI](https://docs.nestjs.com/cli/overview) · [Semantic Versioning](https://semver.org/)

## 3. Install the auth, database, and security dependencies

```bash
cd server
npm install @prisma/client@7.10.0 @nestjs/config @nestjs/jwt @nestjs/passport \
  passport passport-jwt cookie-parser argon2 class-validator class-transformer \
  helmet @nestjs/throttler @nestjs/swagger @nestjs/terminus
```

This surfaced the same "ecosystem lag" problem from step 2, but in a sneakier form: `npm install` didn't error, everything installed cleanly — and then `npm test` failed with:

```
Must use import to load ES Module: .../node_modules/@nestjs/config/dist/index.js
```

`@nestjs/config@12.0.0` (and, it turned out, `@nestjs/jwt@12`, `@nestjs/passport@12`, `@nestjs/terminus@12`) had all quietly become **ESM-only** packages — no CommonJS build at all. That's invisible until something tries to `require()` them, which Jest does by default. The app itself ran fine (`nest build`/`nest start` handle ESM/CJS interop transparently), but the test runner couldn't load them.

The fix, checked one package at a time — find the latest version of each that (a) still supports NestJS 11 via its peer range and (b) still ships CommonJS (`npm view <pkg>@<version> type` — empty output means CJS, `"module"` means ESM-only):

```bash
npm install @nestjs/config@4.0.4 @nestjs/jwt@11.0.2 @nestjs/passport@11.0.5 @nestjs/terminus@11.1.1
npm install @nestjs/swagger@^11.4.7   # 11.4.7 was already the newest 11.x-compatible release
```

**Why check `npm view <pkg> type` before installing:** it's the one-line way to know whether a package ships CommonJS (nothing printed) or ESM-only (`"module"`) *before* it breaks your test runner instead of after. Cheap insurance.

**Two dependencies deliberately left out**, worth noting because "don't add a package" is as much a decision as "add one":

- **`uuid`** — Node's own `crypto.randomUUID()` and `crypto.randomBytes()` do everything this project needs (generating a refresh token's opaque id and secret), so there's no reason to carry a third-party package for something the runtime already provides.
- **A hand-written repository layer over Prisma** — not a package, but the same instinct: Prisma Client already is a type-safe data-mapper; wrapping it in another abstraction "in case we swap ORMs" duplicates what it provides for a swap that isn't a real requirement.

**Learn more:** [Pure ESM package](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c) (the classic explainer for this exact class of problem) · [npm view](https://docs.npmjs.com/cli/v10/commands/npm-view)

## 4. Run Postgres locally with Docker

`docker-compose.yml` at the project root:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: cms_user
      POSTGRES_PASSWORD: cms_password
      POSTGRES_DB: cms_db
    ports: ["5432:5432"]
    volumes: ["cms_db_data:/var/lib/postgresql/data"]
```

```bash
docker compose up -d db
```

**Why Docker for local Postgres, and why `postgres:16-alpine` specifically:** every developer gets an identical, disposable database with no local Postgres install, no version drift between machines, and no risk to anyone else's data when you reset it. `alpine` images are a small Linux distribution built for containers — smaller download, smaller attack surface than the default Debian-based image, for a database that has no reason to need anything beyond Postgres itself.

**Learn more:** [Docker Compose](https://docs.docker.com/compose/) · [postgres Docker image](https://hub.docker.com/_/postgres)

## 5. Design the Prisma schema

`prisma/schema.prisma` models `User` and `RefreshToken` (see [story-1-admin-creates-users.md](story-1-admin-creates-users.md) §7 for the field-by-field reasoning). Two Prisma-7-specific things came up immediately that don't appear in older tutorials:

**The connection string moved out of the schema file.** Writing the schema the "classic" way —

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

— now fails: `the datasource property 'url' is no longer supported in schema files`. Prisma 7 moved this to a separate `prisma.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('DATABASE_URL') },
});
```

and the schema's `datasource` block shrinks to just `provider = "postgresql"`.

**The generated client needed an explicit output path.** The old default generator, `prisma-client-js`, wrote into `node_modules/.prisma/client` invisibly. Prisma 7's new default generator, `prisma-client`, requires an explicit `output`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}
```

This is a real improvement once you know about it — the generated TypeScript is a normal, readable part of `src/`, gitignored (it's rebuilt by `prisma generate`, not hand-edited), rather than a mystery folder inside `node_modules`.

**Learn more:** [Prisma schema reference](https://www.prisma.io/docs/orm/reference/prisma-schema-reference) · [Prisma config reference](https://www.prisma.io/docs/orm/reference/prisma-config-reference)

## 6. Connect PrismaClient without the old Rust engine

Prisma 7 also removed the bundled Rust query engine binary. `PrismaClient` now needs a **driver adapter** — a package that actually speaks the Postgres wire protocol:

```bash
npm install @prisma/adapter-pg pg
npm install -D @types/pg
```

```ts
// src/modules/prisma/prisma.service.ts
const adapter = new PrismaPg({ connectionString: config.getOrThrow('database.url', { infer: true }) });
super({ adapter });
```

Wrapped in a small `PrismaService` that extends `PrismaClient` and implements Nest's `OnModuleInit`/`OnModuleDestroy` — so the app connects once at startup and disconnects cleanly at shutdown, and every other module gets the database as an injected, mockable dependency instead of a global singleton.

Run the first migration:

```bash
npx prisma migrate dev --name init
```

**Learn more:** [Prisma driver adapters](https://www.prisma.io/docs/orm/overview/databases/database-drivers) · [NestJS lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events)

## 7. Build the shared/common layer first

Before any feature module, the pieces every feature depends on:

- **`src/config/`** — `env.validation.ts` (class-validator schema; the process refuses to start if a required env var is missing or malformed) and `configuration.ts` (typed accessors, so the rest of the app calls `config.getOrThrow('auth.accessTokenTtlSeconds', { infer: true })` instead of reading `process.env.WHATEVER` in a dozen places).
- **`src/common/guards/`** — `JwtAuthGuard` (verifies the JWT) and `RolesGuard` (checks the verified user's role against `@Roles(...)` metadata).
- **`src/common/decorators/`** — `@Roles()` attaches metadata; `@CurrentUser()` pulls the verified user off the request instead of every controller reaching into `req.user` and re-casting it.
- **`src/common/filters/`** — `AllExceptionsFilter`, one place where every thrown error becomes the same `{ statusCode, message }` JSON shape.
- **`src/common/utils/opaque-token.util.ts`** — generates the `id.secret` refresh-token format using `node:crypto`, nothing else.

**Why build this before any feature:** a guard, a decorator, and an exception filter are infrastructure every controller will use. Writing `AuthController` first and improvising error handling per-endpoint is how you end up with three different error JSON shapes across a codebase.

**Learn more:** [NestJS Guards](https://docs.nestjs.com/guards) · [NestJS Custom Decorators](https://docs.nestjs.com/custom-decorators) · [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)

## 8. Build the Auth module

`AuthService` implements four operations, each described in full in [story-1-admin-creates-users.md](story-1-admin-creates-users.md) §4 and §8:

- **`register()`** — hashes the password with `argon2`, normalizes the email (trim + lower-case), and either creates a new `PENDING_APPROVAL` row or, if the email belongs to a previously-`REJECTED` row, resets that same row instead of creating a duplicate.
- **`login()`** — verifies the password, refuses anything but an `ACTIVE` account with a machine-readable `reason`, and issues both tokens.
- **`refresh()`** — implements rotate-on-use with reuse detection: consumes the presented token, issues a replacement in the same `familyId`, and if an already-consumed token is ever presented again, revokes the entire family.
- **`logout()`** — revokes the whole family for the presented token; a no-op (not an error) if the cookie is missing or already invalid.

`JwtStrategy` (Passport) pulls the JWT from the `access_token` cookie via a custom extractor (Passport's built-in extractors assume an `Authorization` header, which this project deliberately doesn't use), then looks the user up fresh on every request rather than trusting the token's claims — so a deactivated account or a changed password invalidates access immediately, not after the token's ~15-minute natural expiry.

**Why cookies were verified, not assumed:** after wiring `cookie-parser` and the cookie extractor, the very first manual test (`curl -i` against `/auth/login`) printed the actual `Set-Cookie` headers — confirming `HttpOnly`, `SameSite=Strict`, and the right `Max-Age` were really there, not just present in the code. Reading code that sets a cookie is not the same as seeing the cookie.

**Learn more:** [Passport strategies](http://www.passportjs.org/concepts/authentication/strategies/) · [OWASP: Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) · [OWASP: Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (why `argon2`, not `bcrypt`, for new projects)

## 9. Build the Users module (admin operations)

`UsersController` — every route guarded by `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('ADMIN')` — exposes list/approve/reject/role-change/status-change. `UsersService` enforces the business rules the routes alone can't: only a `PENDING_APPROVAL` account can be approved or rejected, only an `ACTIVE` account can have its role changed, and an Admin can never deactivate their own account (a small guard that exists purely so a live demo can't accidentally lock out its only admin).

**Learn more:** [NestJS Guards](https://docs.nestjs.com/guards) (same link as step 7 — worth re-reading once you have a real guard chain to reason about)

## 10. Wire it all together in `main.ts` and `app.module.ts`

```ts
app.use(helmet());
app.use(cookieParser());
app.enableCors({ origin: config.getOrThrow('corsOrigin', { infer: true }), credentials: true });
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
```

Each line closes a specific gap:

- `helmet()` — sets secure HTTP headers (CSP, HSTS, `X-Frame-Options`, ...) that a hand-rolled Express app would otherwise ship without.
- `cookie-parser` — required because the JWT lives in a cookie; without it, `req.cookies` doesn't exist.
- An **explicit CORS origin allowlist**, never a wildcard — `credentials: true` means the browser attaches auth cookies to cross-origin requests too, so an open policy here would be a real credential-leak risk.
- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` — a DTO defines the *entire* accepted shape of a request; an unexpected field is rejected outright, not silently dropped.

And in `app.module.ts`, `ThrottlerGuard` is bound globally via `APP_GUARD` — importing `ThrottlerModule` alone enforces nothing; a route without a bound guard has no rate limiting at all, regardless of what's configured. `/auth/login` and `/auth/register` additionally tighten this per-route with `@Throttle({ default: { limit: 5, ttl: 60_000 } })`, since those are exactly the endpoints a brute-force attempt would hit.

**Learn more:** [Helmet](https://helmetjs.github.io/) · [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) · [NestJS ValidationPipe](https://docs.nestjs.com/techniques/validation) · [NestJS Rate Limiting](https://docs.nestjs.com/security/rate-limiting)

## 11. Solve the bootstrap problem: seed the first Admin

Only an Admin can approve a registration — and registration is the only other way to create an account. Something has to create the very first Admin without going through the API. `prisma/seed.ts` creates one demo account per role directly via `PrismaClient`:

```bash
npm run db:seed
```

```
Seeded ADMIN — admin@example.com / Demo1234!Passphrase
Seeded EDITOR — editor@example.com / Demo1234!Passphrase
Seeded CONTRIBUTOR — contributor@example.com / Demo1234!Passphrase
Seeded VIEWER — viewer@example.com / Demo1234!Passphrase
```

These are demo/reviewer credentials only — see [README.md](../README.md) for the reminder to rotate or remove them before any real deployment.

Wiring this up surfaced one more Prisma-7 config change: the seed command moved from `package.json`'s `"prisma": { "seed": "..." }` field into `prisma.config.ts`'s `migrations.seed` (shown in step 5). And the seed script itself needs to run with **`tsx`**, not `ts-node` — this project's `tsconfig.json` uses `"module": "nodenext"`, which means the generated Prisma client's own internal imports use explicit `.js` specifiers pointing at sibling `.ts` files (a compile-time convention that only resolves correctly once the code is actually compiled, or run through a tool that emulates that resolution at runtime). `ts-node`'s plain CommonJS `require()` doesn't do that; `tsx` (esbuild-based) does.

**Learn more:** [Prisma Seeding](https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding) · [TypeScript: nodenext module resolution](https://www.typescriptlang.org/docs/handbook/modules/reference.html#node16-nodenext) · [tsx](https://tsx.is/)

## 12. Test the whole story by hand before writing automated tests

Before writing a single Jest test, the full flow was exercised with `curl` against the running dev server (`npm run start:dev`) — registration, the pending-login block, admin approval, the new login, the role-mismatch 403, refresh rotation, reuse detection, logout, and the self-deactivation guard. Every one of those matched the documented behavior exactly on the first real run.

(`curl` ships natively on Windows 10/11, macOS, and every mainstream Linux distribution — no separate install needed on any of the three. PowerShell also has its own `Invoke-RestMethod`/`Invoke-WebRequest` cmdlets if preferred, but plain `curl` works as shown.)

**Why manual testing before automated testing, not after:** a test you write against your own mental model of the code can pass while the actual behavior is wrong in a way you didn't think to assert on. Watching the real `Set-Cookie` headers, the real JSON error bodies, and the real database rows first means the automated tests that come next are encoding *observed* behavior, not *assumed* behavior.

## 13. Write the automated test suite

**Unit tests** (`*.spec.ts`, colocated with the code they test) mock `PrismaService`, `JwtService`, and `ConfigService`, and exercise pure business logic — `RolesGuard`'s allow/deny branches, `JwtStrategy`'s validate() outcomes, every branch of `AuthService`.

**End-to-end tests** (`test/*.e2e-spec.ts`) boot the real Nest application via `Test.createTestingModule` and hit it over real HTTP with `supertest` — no mocks, against a dedicated `cms_test_db` database so the suite never touches (or gets confused by) whatever's sitting in the local dev database.

Two more Prisma-7-in-Jest issues showed up only once the *real* `PrismaService` was exercised (unit tests, which mock it entirely, never hit these):

- Jest's default rate limiting interfered with its own test run — the e2e suite calls `/auth/login`/`/auth/register` far more than 5 times/minute across its test cases. Fixed by not binding `ThrottlerGuard` at all when `NODE_ENV === 'test'` (`app.module.ts`) — rate-limiting behavior itself isn't what those tests verify, and a flaky 429 in the middle of an unrelated assertion is worse than skipping the guard in test.
- Prisma 7's WASM query compiler uses a dynamic `import()` internally, which Jest's default CommonJS transform can't execute without an experimental flag — requiring `NODE_OPTIONS=--experimental-vm-modules` to be set for that one script.

  The obvious way to set it, `"test:e2e": "NODE_OPTIONS=--experimental-vm-modules jest ..."`, is bash/zsh-only syntax (`VAR=value command`) — it fails outright on Windows PowerShell and `cmd.exe`, which don't support that inline form. The cross-platform fix is the [`cross-env`](https://www.npmjs.com/package/cross-env) package, which provides one syntax that sets an environment variable for a single command identically on every shell:

  ```json
  "test:e2e": "cross-env NODE_OPTIONS=--experimental-vm-modules jest --config ./test/jest-e2e.json"
  ```

  This is a general pattern worth keeping, not a one-off: any `npm` script that needs to set an environment variable inline should go through `cross-env` rather than shell-specific syntax, unless the project has already decided it will only ever run on one operating system.

Run them:

```bash
npm test        # unit — 23 tests
npm run test:e2e  # e2e — 6 tests, needs `docker compose up -d db` and a migrated cms_test_db first
```

**Learn more:** [NestJS Testing](https://docs.nestjs.com/fundamentals/testing) · [Supertest](https://github.com/ladjs/supertest) · [Jest: ECMAScript Modules](https://jestjs.io/docs/ecmascript-modules) · [cross-env](https://www.npmjs.com/package/cross-env)

## 14. Package it: a multi-stage Dockerfile

`server/Dockerfile` builds in four stages — `deps` (installs everything once), `build` (generates the Prisma client and compiles TypeScript), `prod-deps` (installs *only* production dependencies from the same lockfile), and `runtime` (the actual shipped image: compiled `dist/`, production `node_modules`, nothing else).

**Why four stages instead of one:** `eslint`, `jest`, and the `prisma` CLI itself are development tools with their own dependency trees (including two known CVEs in transitive packages the `prisma` CLI pulls in for MySQL support this project never uses — see the `overrides` field in `package.json`). None of that needs to exist in the image that actually runs in production; a multi-stage build is what makes "install everything to build it, ship only what runs" possible in one file.

```dockerfile
USER node
```

`node:24-alpine` ships a built-in non-root `node` user — the container runs as that user, not as root, so a vulnerability in the running process doesn't hand an attacker root inside the container for free.

Two Docker-specific bugs surfaced while getting this working, both worth knowing about because they'll recur on any TypeScript + Prisma project:

- **A stale `.tsbuildinfo` file silently skipped the entire build.** TypeScript's `incremental: true` option caches "what did I already build" in a `.tsbuildinfo` file; if the output directory (`dist/`) gets deleted by hand without also deleting that cache, `tsc` can conclude nothing changed and emit *nothing*, with no error and exit code 0. Symptom: `npm run build` "succeeds" but `dist/` doesn't exist. Fix: delete the `.tsbuildinfo` file whenever `dist/` is deleted out of band, and make sure it's excluded from what gets copied into a Docker build context (`.dockerignore`) so a stale one from the host never ships into the container's build stage.
- **`prisma generate` needs `DATABASE_URL` to be *set*, even though it never connects to a database.** `prisma.config.ts`'s `env('DATABASE_URL')` call throws if the variable is entirely absent — during a Docker build, before any real database exists, that's exactly the case. Fixed with a placeholder: `ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"` right before the `generate` step in the build stage; the real value is supplied to the *running* container instead.

Build and run it:

```bash
docker build -t cms-api server/
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://cms_user:cms_password@<host>:5432/cms_db" \
  -e JWT_ACCESS_SECRET="..." -e CORS_ORIGIN="..." \
  cms-api
```

**Learn more:** [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/) · [TypeScript incremental builds](https://www.typescriptlang.org/tsconfig/#incremental) · [OWASP Docker Security](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html) (the non-root-user point, among others)

## 15. Where this leaves the project

Everything above is built, tested, and verified working: `npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e` all pass; the compiled app boots from `dist/main.js` and from the Docker image identically; the full Story 1 flow was exercised by hand and is covered end-to-end by the automated suite.

What's deliberately not built yet, and why: article/media stories come after auth (they need a logged-in, role-checked user to exist first); the background-job queue (§7 of tech-stack-decisions.md) waits for the media-upload story that actually needs it; the frontend framework choice is independent of the backend and doesn't block it. None of those are oversights — they're sequencing, and each is flagged at the point in `tech-stack-decisions.md` where it becomes relevant.

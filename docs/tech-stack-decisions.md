# Tech stack — what we're using and why

Status: **Story 1 (registration, admin approval, JWT-cookie auth, RBAC) is implemented and verified** — built, linted, unit-tested, and e2e-tested against a real Postgres database. Every decision below reflects what the running code actually does, not a proposal. Where this deviates from a spec-named technology (Celery/RabbitMQ), that's called out explicitly rather than silently substituted.

For the day-by-day account of *how* this was built — commands run, problems hit, and what fixed them — see [implementation-log.md](implementation-log.md). This document is the destination; that one is the route.

---

## 1. Database: PostgreSQL — and specifically *not* MongoDB

The spec already settles this ("Database: Data is stored in PostgreSQL"), but the reasoning is worth having on record since running Postgres and MongoDB side by side was considered.

**What the core data looks like:** `User → Role`, `User → RefreshToken`, and — once later stories land — `User → Article (author)`, `Article → Revision`, `Article → Media`. Every one of those is a foreign key to a small, fixed set of related rows.

**Postgres — relational (SQL):**

- Data lives in **tables with fixed columns**; tables link to each other with **foreign keys** — a `User` row's `role` can only ever be one of the four values the database itself allows.
- **Constraints are enforced by the database**, not by remembering to check in application code — inserting a `role` that isn't `ADMIN | EDITOR | CONTRIBUTOR | VIEWER` is rejected at the column-type level.
- **Transactions (ACID)** group several changes into one all-or-nothing unit. Approving a user (`status` + `role` + `approvedById` + `approvedAt` all changing together) either fully lands or fully doesn't.
- **JOIN queries** fetch related data in one request instead of several round-trips.

**MongoDB — document-based (NoSQL):**

- Each record is a flexible, self-contained JSON document with **no built-in foreign keys** — nothing stops a document referencing a role that doesn't exist unless application code checks for it on every write.
- **No real joins** — related data is either duplicated across documents or stitched together with `$lookup` aggregation pipelines standing in for a join.
- Its actual strength — schema-flexible, append-heavy, rarely-joined data — matches the *optional* features list (an audit-log stream, an activity feed), not `User`/`Role`, which are small, fixed-shape, and relationally connected.

**Cost of running both anyway:** two connection pools, two migration/backup stories, two schemas to keep in sync — for data that only ever needed one database.

**Verdict: PostgreSQL only.** A document store is a scoped, isolated addition to consider only if a specific optional feature's shape genuinely wants one — not a reason to split the core schema.

## 2. Backend framework: NestJS 11, on Express

**NestJS `^11.2.3`**, not the `latest`-tagged 12.x. Framework majors this fresh have peer-dependency lag across the ecosystem — `@nestjs/config`, `@nestjs/jwt`, `@nestjs/passport`, and `@nestjs/terminus` all needed pinning to their own last CommonJS-shipping release to work with the rest of this Node 24 / CommonJS project (see the implementation log for the exact versions and why each one was picked).

- **Guards and decorators map directly onto the permission matrix.** `@Roles('ADMIN')` plus `RolesGuard` *is* the enforcement mechanism the spec asks for — a proper 403, not a hidden UI button — expressed as a one-line decorator per route.
- **Dependency injection keeps auth logic in one place.** `JwtStrategy`, the cookie extractor, and both guards are each written once and injected wherever needed.
- **TypeScript end-to-end** (matching Prisma below) means a `User` row's shape is checked by the same compiler as the DTO that created it.

**Express, not Fastify**, as the HTTP adapter:

- Passport, `cookie-parser`, and (later) `multer` for media uploads are Express-native; Fastify's equivalents are separate packages with different APIs — more surface area to get subtly wrong, for an app whose auth design leans heavily on Passport strategies.
- Far more learning material exists for Express + NestJS than Fastify + NestJS, which matters for a codebase meant to be read and extended by a team.
- Fastify's throughput edge is in request-parsing overhead — microseconds per request. This app's latency is dominated by database round-trips and `argon2` hashing (deliberately slow by design), not by which library reads the request headers.

## 3. Architecture: modular monolith

One NestJS application, organized as feature modules — not a microservices split:

```
src/
  modules/
    auth/       AuthController, AuthService, JwtStrategy, DTOs
    users/      UsersController, UsersService (admin review/approve/reject/role/status)
    prisma/     PrismaService — wraps PrismaClient as an injectable
    health/     Terminus health check
  common/
    guards/     JwtAuthGuard, RolesGuard
    decorators/ @Roles(), @CurrentUser()
    filters/    AllExceptionsFilter
    constants/  cookie names and options
    utils/      opaque refresh-token generation
  config/       environment schema, validation, typed accessors
  main.ts       helmet, cookie-parser, CORS, global pipes/filters/guards
```

**Why not microservices:** microservices trade function calls for network calls and database transactions for distributed ones, in exchange for independently scaling and deploying different parts of a system. Nothing in this project is under enough independent load to justify that cost — one small team, one Postgres database, one workflow.

**Why not a repository layer on top of Prisma:** Prisma Client already is a type-safe data-mapper. A hand-written repository interface in front of it would duplicate what it provides, in exchange for an ORM swap that isn't a planned requirement. Feature services inject `PrismaService` directly.

**How this maps to SOLID:**

- **Single Responsibility** — each service owns one cohesive concern: `AuthService` is the authentication lifecycle (register/login/refresh/logout), `UsersService` is admin-side user administration, `PrismaService` is the database connection. Neither knows how the other does its job.
- **Open/Closed** — new roles or routes extend the system through `@Roles(...)` metadata and new guards/decorators, without modifying `RolesGuard` itself; it reads whatever roles a route declares.
- **Liskov Substitution** — `JwtAuthGuard` and `RolesGuard` both satisfy Nest's `CanActivate` interface interchangeably; any guard can be composed into `@UseGuards()` without the framework caring which one it is.
- **Interface Segregation** — DTOs (`RegisterDto`, `LoginDto`, `ApproveUserDto`, ...) expose exactly the fields one endpoint needs, not a shared "UserInput" god-object every route partially uses.
- **Dependency Inversion** — controllers and services depend on injected abstractions (`ConfigService<AppConfig, true>`, `PrismaService`, `JwtService`) provided by Nest's container, never on concrete instances they construct themselves — which is what makes every unit test in this codebase possible without a running database.

**Design patterns actually in use** — each tied to a specific file, not applied as a checklist:

- **Strategy** — `JwtStrategy` (`src/modules/auth/strategies/jwt.strategy.ts`) is Passport's own implementation of this: `PassportStrategy(Strategy)` lets an authentication method be swapped or added (a future `GoogleStrategy`, say) without `JwtAuthGuard` or any controller knowing which one is active.
- **Chain of Responsibility** — `@UseGuards(JwtAuthGuard, RolesGuard)` runs guards in sequence, and either can short-circuit the request before the next runs. `JwtAuthGuard` establishes identity; `RolesGuard` only ever executes for a request that already has one.
- **Decorator** — `@Roles('ADMIN')`, `@CurrentUser()`, `@ApiOperation()` each attach behavior or metadata to a route handler without changing the handler's own code — literally the pattern, and also Nest's standard idiom for cross-cutting concerns.
- **Dependency Injection / Inversion of Control** — the organizing pattern of the whole codebase (see Dependency Inversion above); it's also what makes `auth.service.spec.ts` able to test `AuthService` against a mocked `PrismaService`/`JwtService` with no real database or JWT signing involved.
- **Factory** — `ConfigModule.forRoot({...})`, `JwtModule.registerAsync({ useFactory: ... })`, `ThrottlerModule.forRoot([...])` each hide their own construction logic behind a static factory method instead of the app calling `new` on a provider directly.
- **Adapter** — `@prisma/adapter-pg` (`PrismaPg`) adapts the `pg` driver's interface to what `PrismaClient` expects; swapping to a different Postgres driver later would only touch `PrismaService`'s constructor, not the many call sites using `this.prisma.user...` throughout the app.
- **Template Method** (lightweight) — `AllExceptionsFilter.catch()` always runs the same shape (resolve → log if 5xx → respond), while `resolve()` is the one step that varies per exception type (`HttpException` vs. `Prisma.PrismaClientKnownRequestError` vs. anything else).
- **Singleton** — every Nest provider is a singleton within the app's DI container by default; one `PrismaService` instance holds the one connection pool for the whole process, which is what makes the "stateless application tier" scalability point below actually true.

**Deliberately *not* used, and why:** a **Repository** pattern on top of Prisma (already covered above — Prisma Client already is one) and a **Unit of Work** for multi-step writes — the two-write refresh rotation in `AuthService.refresh()` is deliberately *not* wrapped in a transaction; see that method's comment for the "safe failure mode" reasoning. Both are real, legitimate patterns; neither has an actual use case here yet, and adding one speculatively would be exactly the kind of complexity §3's "why not a repository layer" argument already rejects.

**Scalability, concretely:**

1. **Stateless application tier** — no session state lives in memory; every fact needed to serve a request (user, role, refresh-token validity) lives in Postgres. Any number of identical API instances can sit behind a load balancer with no sticky sessions.
2. **Database connections** pool per instance via Prisma; a pooler (PgBouncer, or a managed Postgres's built-in pooling) sits in front once `instances × pool size` approaches Postgres's `max_connections` — a deployment change, not a code change.
3. **Heavy work leaves the request/response cycle** — image processing (once that story is built) runs through a background queue, so upload load never degrades API latency.
4. **Rate limiting** (`ThrottlerGuard`, bound globally) protects the shared database from a burst of requests from one client.
5. **Caching** is a clean future addition for read-heavy endpoints (published articles) without reorganizing modules.

## 4. Database: PostgreSQL 16, driver adapter (`@prisma/adapter-pg`)

Prisma 7 removed its bundled Rust query engine; `PrismaClient` now speaks to Postgres through a driver adapter built on the `pg` (node-postgres) package. `PrismaService` constructs that adapter once, from the validated `DATABASE_URL`, and extends `PrismaClient` as an injectable Nest provider with its own connect/disconnect lifecycle hooks.

`prisma` (the CLI) is pinned to the stable **`7.10.0`**, not the `latest` npm tag — which currently points at an `8.0.0-rc` release candidate. A release candidate is the wrong foundation for a deadline-driven project; `7.10.0` is the last version before that major bump.

- **`schema.prisma`** is one file defining every table, column, and relationship — the generator now emits real, gitignored TypeScript into `src/generated/prisma` (via `prisma generate`, wired into `postinstall`) rather than into `node_modules`.
- **Prisma Migrate** turns schema changes into numbered, reviewable SQL files under `prisma/migrations/` — no hand-written migrations, no hidden schema-sync magic.
- **Native Postgres `enum` support** — the four-role enum and status enum are declared once and become both a database-level `CREATE TYPE` and a matching TypeScript union, so an invalid role is a compile error, not a bug found live on stage.
- **`prisma/seed.ts`** creates one demo account per role (Admin/Editor/Contributor/Viewer) via `npm run db:seed` — the contest environment always boots with working credentials.
- **Email uniqueness** is a plain `email String @unique` column, not the Postgres `citext` extension — the application layer lower-cases and trims every email before it's written or queried, achieving the same practical outcome without an enabling migration.

## 5. Database hosting: Docker locally, a managed provider in production

Two different environments, two different answers — the connection string is the only thing that changes between them, since Prisma talks to any standard Postgres endpoint through the same driver adapter.

**Development: Docker Compose, self-hosted.** `docker-compose.yml`'s `db` service (`postgres:16-alpine`) gives every developer an identical, disposable, offline-capable database with zero network latency and zero cost. Resetting it, seeding it, or running the e2e suite against a dedicated `cms_test_db` never risks anyone else's data, because there isn't anyone else on it.

**Production / the contest demo: a managed cloud Postgres** (e.g. Neon, Supabase, or a cloud provider's managed Postgres), not a hand-run Postgres container on a VM:

- **Backups and patching are the provider's job.** Self-hosting Postgres in production means being the one who notices a failed backup or a missed security patch — exactly the wrong thing to be debugging during a live demo.
- **Connection pooling comes built in** on most managed providers, which matters once more than one API instance is running.
- **TLS and access control are on by default**, rather than something to configure correctly by hand on a VM.
- **It's a deployment-config change, not a code change** — the app reads `DATABASE_URL` from the environment either way, so switching from the local container to a managed instance for the deployed demo touches `.env`/deployment secrets, nothing in `src/`.

Self-hosting Postgres in a container is a legitimate choice too if the team wants full control and has the ops time to babysit it — the recommendation above is about minimizing what can go wrong unattended during the actual demo, not a hard rule.

## 6. Authentication: JWT via httpOnly cookies (Passport)

- A token in `localStorage` or a JSON response body is readable by any script running on the page — one XSS bug anywhere leaks every session. An `httpOnly` cookie is invisible to JavaScript entirely.
- Splitting into a short-lived access token (JWT, ~15 min) and a longer-lived opaque refresh token (its hash, not its raw value, stored server-side) means a session can actually be revoked on logout — a pure stateless JWT can't be un-issued before it expires on its own.
- Refresh tokens rotate on every use and share a `familyId`; presenting an already-consumed token revokes the entire family — the standard OAuth2 reuse-detection pattern, implemented in `AuthService.refresh()`.
- Passport's strategy pattern plugs straight into Nest's guard system, so "verify the JWT" (`JwtAuthGuard`) and "check the role" (`RolesGuard`) stay two separate, individually testable steps.

## 7. Background processing: flagging a mismatch with the spec

The spec names **Celery + RabbitMQ**. Celery is Python's task queue — it does not run inside a Node/NestJS process. Taken literally, that requires a second, separate Python service just to host workers, for a queue that only needs to resize one image.

| Option | What it costs | What it keeps |
|---|---|---|
| **BullMQ + Redis** (recommended) | None of the spec's named tech; needs sign-off that this substitution is acceptable | Fully NestJS-native, one language, one runtime |
| **RabbitMQ + a Node consumer** | More setup than BullMQ (no first-class Nest module) | Keeps RabbitMQ as named, still one language |
| **Actual Celery + RabbitMQ** | A second microservice, a second deploy target, a second thing that can break during the demo | Matches the spec's literal wording |

**Recommendation: BullMQ + Redis**, unless the grading rubric checks for Celery/RabbitMQ by name — that's a question for whoever owns the rubric, not an engineering call. Not yet built; needed once the media-upload story starts.

## 8. Rich-text editor: TipTap (not yet built)

- Headless (ProseMirror-based) — the toolbar and styling stay under this project's control rather than fighting a bundled UI.
- Outputs structured JSON that's straightforward to store, diff (useful for the optional revision-history feature), and re-render safely.

## 9. File storage: local disk (dev) → S3-compatible (prod) (not yet built)

Using the S3 API (`@aws-sdk/client-s3`) against MinIO locally and a real S3-compatible bucket in production means the same code path runs in both environments — matches the spec's explicit requirement.

## 10. Testing: Jest + Supertest

- Ships with the NestJS 11 CLI scaffold — no separate test-runner setup.
- Unit tests (`*.spec.ts`, colocated under `src/`) mock `PrismaService`/`JwtService`/`ConfigService` and exercise business logic in isolation — 23 tests covering `RolesGuard`, `JwtStrategy`, and every branch of `AuthService`.
- E2E tests (`test/*.e2e-spec.ts`) boot the real Nest application against a dedicated `cms_test_db` and hit it over real HTTP with Supertest — no mocks. 6 tests walk the entire Story 1 flow: register → blocked pending login → admin approval → login → role-based 403 → refresh rotation and reuse detection → logout revocation → the self-deactivation guard.

---

## Still open

- **Frontend framework** (Next.js vs. plain React + Vite) — doesn't block backend work; will also settle the `CORS_ORIGIN` value once decided.
- **BullMQ vs. RabbitMQ vs. Celery** (§7) — needed before the background-image-processing story starts, not before Story 1.

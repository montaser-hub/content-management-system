# CMS API — server

The backend for the Content Management System: self-registration, admin approval, JWT-cookie authentication, and role-based authorization (Story 1). Built with NestJS 11, PostgreSQL 16, and Prisma 7.

For the reasoning behind every technology and architecture choice, see [../docs/tech-stack-decisions.md](../docs/tech-stack-decisions.md). For how this project was actually built, step by step, see [../docs/implementation-log.md](../docs/implementation-log.md).

## Requirements

- Node.js 24 LTS — [nvm](https://github.com/nvm-sh/nvm) on macOS/Linux, [nvm-windows](https://github.com/coreybutler/nvm-windows) on Windows, or the [official installer](https://nodejs.org/) on either: `nvm install 24.20.0`
- Docker Desktop (Windows/macOS) or Docker Engine + Compose plugin (Linux) — for local PostgreSQL

Every command below works identically on Windows (PowerShell), macOS, and Linux unless a platform is called out explicitly. Where a command wraps across multiple lines with a trailing `\` (bash's line-continuation character), PowerShell users can swap it for a trailing backtick `` ` `` or just paste the command as one line — same result either way.

## Setup

```bash
# 1. Install dependencies (also generates the Prisma client via postinstall)
npm install

# 2. Start PostgreSQL (run from the project root, one level up from server/)
docker compose up -d db

# 3. Configure environment (back in server/)
cp .env.example .env
# .env's defaults already match docker-compose.yml's db credentials —
# only JWT_ACCESS_SECRET needs a real value:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# (paste the output into .env)

# 4. Create the database schema
npm run db:migrate

# 5. Seed demo accounts (one per role)
npm run db:seed

# 6. Run it
npm run start:dev
```

The API is now at `http://localhost:3000`, with interactive API documentation at `http://localhost:3000/docs` (Swagger/OpenAPI) and a health check at `http://localhost:3000/health`.

## Demo accounts

Seeded by `npm run db:seed` — **for local development and demo review only**, never for a real deployment:

| Email | Role | Password |
|---|---|---|
| `admin@example.com` | Admin | `Demo1234!Passphrase` |
| `editor@example.com` | Editor | `Demo1234!Passphrase` |
| `contributor@example.com` | Contributor | `Demo1234!Passphrase` |
| `viewer@example.com` | Viewer | `Demo1234!Passphrase` |

## Visual testing

There's no frontend yet (see [../README.md](../README.md)'s status table), so these are today's testing surfaces — no `curl`/Postman-by-hand required.

**1. Swagger UI — `http://localhost:3000/docs`**

The interactive, click-through API docs. To walk the whole Story 1 flow visually:

1. Expand **`POST /auth/login`** → *Try it out* → body `{ "email": "admin@example.com", "password": "Demo1234!Passphrase" }` → *Execute*. The response's `Set-Cookie` headers are stored by your browser automatically — same-origin requests always include them, so there's nothing to paste into the padlock/"Authorize" dialog.
2. Expand **`GET /users`** → *Try it out* → *Execute* — already authenticated, because the cookie from step 1 is attached automatically. You should see the four seed accounts.
3. Register a new account via **`POST /auth/register`**, then confirm it shows up via `GET /users?status=PENDING_APPROVAL`, approve it with **`PATCH /users/{id}/approve`**, and log in as it to see the cycle complete.

Every protected route's padlock icon documents a **cookie** requirement (`access_token`), not a bearer token — matches how the API actually authenticates; see [../docs/tech-stack-decisions.md](../docs/tech-stack-decisions.md).

**2. Prisma Studio — a live, visual database browser**

```bash
npm run db:studio
```

Opens a local GUI (prints its own URL, typically `http://localhost:5555`) where you can watch rows in `users`/`refresh_tokens` change in real time as you exercise the API from Swagger UI in another tab — the fastest way to *see* what "approve" or "refresh rotation" actually did to the data.

**3. Postman / Insomnia / Bruno — import the API instead of building requests by hand**

The full OpenAPI spec is machine-readable at `http://localhost:3000/docs-json` — import that URL directly into any REST client to get every endpoint, request body shape, and the cookie-auth requirement pre-built as a collection.

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | Run the API with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start:prod` | Run the compiled build (`node dist/main.js`) |
| `npm run lint` | ESLint, auto-fixing what it can |
| `npm test` | Unit tests (Jest, mocked dependencies) |
| `npm run test:e2e` | End-to-end tests against a real database — see below |
| `npm run db:migrate` | Apply Prisma migrations (creates a new one if the schema changed) |
| `npm run db:generate` | Regenerate the Prisma client from `schema.prisma` |
| `npm run db:seed` | Re-seed the demo accounts (safe to re-run — upserts by email) |
| `npm run db:studio` | Open Prisma Studio, a GUI for browsing the database |

## Running the end-to-end tests

The e2e suite runs against a **separate** database (`cms_test_db`) so it never touches local dev data. One-time setup, creating and migrating that database:

```bash
docker exec <db-container-name> createdb -U cms_user cms_test_db
```

macOS/Linux (bash/zsh):

```bash
export DATABASE_URL="postgresql://cms_user:cms_password@localhost:5432/cms_test_db?schema=public"
npx prisma migrate deploy
```

Windows (PowerShell):

```powershell
$env:DATABASE_URL = "postgresql://cms_user:cms_password@localhost:5432/cms_test_db?schema=public"
npx prisma migrate deploy
```

Then, on any platform:

```bash
npm run test:e2e
```

## Project layout

```
src/
  modules/
    auth/       registration, login, refresh, logout, JWT strategy
    users/      admin: list/approve/reject/role/status
    prisma/     PrismaService — the database connection as an injectable
    health/     GET /health
  common/
    guards/     JwtAuthGuard, RolesGuard
    decorators/ @Roles(), @CurrentUser()
    filters/    AllExceptionsFilter — one consistent error JSON shape
  config/       environment validation + typed accessors
  main.ts       security middleware, global pipes, Swagger setup
prisma/
  schema.prisma   the data model
  migrations/     generated SQL, one folder per migration
  seed.ts         demo account bootstrap
```

## Environment variables

See [.env.example](.env.example) for the full list with descriptions. All of them are validated at startup (`src/config/env.validation.ts`) — the process refuses to start rather than run with a missing or malformed value.

## Docker

```bash
docker build -t cms-api .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e JWT_ACCESS_SECRET="..." \
  -e CORS_ORIGIN="https://your-frontend.example.com" \
  cms-api
```

Or run the whole stack (API + Postgres) with `docker compose up` from the project root — see [../docker-compose.yml](../docker-compose.yml).

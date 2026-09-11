# Content Management System

A secure, role-based CMS: administrators approve user registrations and assign roles; contributors draft articles; editors publish them; viewers and an external REST client read what's published. This repository currently implements **Story 1** — registration, admin approval, JWT-cookie authentication, and role-based authorization — the foundation every later story depends on.

## Quick start

Works identically on Windows (PowerShell), macOS, and Linux — see [server/README.md](server/README.md) for Node.js/Docker installation per platform.

```bash
docker compose up -d db          # PostgreSQL
cd server
npm install                      # also generates the Prisma client
cp .env.example .env             # then fill in JWT_ACCESS_SECRET — see server/README.md
npm run db:migrate
npm run db:seed                  # creates one demo account per role
npm run start:dev
```

API: `http://localhost:3000` · Docs: `http://localhost:3000/docs` · Health: `http://localhost:3000/health`

Full setup instructions, demo credentials, available scripts, and **how to test the API visually (Swagger UI, Prisma Studio, Postman/Insomnia import)** — there's no frontend yet, so that's today's testing surface: **[server/README.md](server/README.md)**.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/permission-matrix.md](docs/permission-matrix.md) | The approved role/action matrix — the source of truth every guard is written against |
| [docs/story-1-admin-creates-users.md](docs/story-1-admin-creates-users.md) | Story 1 in full: flow, endpoints, data model, and every decision with its alternatives and reasoning |
| [docs/tech-stack-decisions.md](docs/tech-stack-decisions.md) | What's used and why — database, framework, architecture, hosting, testing |
| [docs/implementation-log.md](docs/implementation-log.md) | How this was actually built, step by step, commands included — start here to learn the codebase or extend it the same way |

## Status

| Area | State |
|---|---|
| Authentication (register, login, refresh, logout) | ✅ Implemented, tested |
| Authorization (roles, admin approval) | ✅ Implemented, tested |
| User management (admin) | ✅ Implemented, tested |
| Article management, rich-text editor | Not started |
| Media upload, background processing | Not started |
| Public REST API for published articles | Not started |
| Frontend | Not started |

Verified: `npm run build`, `npm run lint`, `npm test` (23 unit tests), `npm run test:e2e` (6 end-to-end tests against a real database) — all passing. See [docs/implementation-log.md](docs/implementation-log.md) §15 for what's deliberately sequenced after this.

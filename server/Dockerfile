# syntax=docker/dockerfile:1

# ---- deps: install once, reused by both the build and (pruned) runtime stages ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts, then rebuild just the one native dependency that needs
# it: this stage only has package.json at this point (no prisma/ yet), so
# our own "postinstall": "prisma generate" script would fail here with
# nothing to generate from — it correctly runs later, in the build stage,
# once the schema has actually been copied in.
RUN npm ci --ignore-scripts && npm rebuild argon2

# ---- build: compile TypeScript + generate the Prisma client ----
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts requires DATABASE_URL to be *set* (see docs) even for
# `generate`, which never actually connects to a database — a placeholder
# is enough here; the real one is supplied at container runtime instead.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

# ---- production deps: same lockfile, prod-only, so dev tooling (eslint,
#      jest, the `prisma` CLI itself, ...) never reaches the final image ----
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild argon2

# ---- runtime: the actual image that ships ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# node:alpine already ships a non-root "node" user — use it instead of
# running the process as root.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

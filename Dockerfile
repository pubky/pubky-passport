# syntax=docker/dockerfile:1

# Pin to the Node version required by package.json engines / .nvmrc.
# Debian slim is used over Alpine for reliable native-module support
# (sharp, and the @synonymdev/pubky server package).
FROM node:24.18.0-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
# Use the exact pnpm version declared in package.json's packageManager field.
RUN corepack enable

# ---- Dependencies: install with a frozen lockfile ----
FROM base AS deps
WORKDIR /app
# Only the files needed to resolve and install dependencies. Copying the
# patches dir and workspace file is required for the patched dependency and
# pnpm overrides in pnpm-workspace.yaml.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Build: compile the Next.js standalone output ----
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- Runner: minimal image serving the standalone server ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as the unprivileged user that ships with the Node image.
USER node

# The standalone output bundles a minimal node_modules and server.js.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]

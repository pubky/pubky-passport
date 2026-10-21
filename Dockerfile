# syntax=docker/dockerfile:1

# Install the security-patched Node release directly: the official 24.22.1
# Docker tags currently contain an empty multi-platform index.
# Debian slim supports sharp and the @synonymdev/pubky native server package.
FROM debian:bookworm-slim AS base
ENV NODE_VERSION=24.22.1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
# Pin each official release archive's SHA-256. Use the actual image architecture,
# independent of caller-supplied build arguments (including TARGETARCH).
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) node_arch=x64; node_sha256=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6 ;; \
      arm64) node_arch=arm64; node_sha256=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e ;; \
      *) echo "Unsupported architecture" >&2; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates libatomic1 libstdc++6 curl xz-utils; \
    archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    curl --fail --show-error --location --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" -o "/tmp/${archive}"; \
    echo "${node_sha256}  /tmp/${archive}" | sha256sum --check --strict; \
    tar -xJf "/tmp/${archive}" -C /usr/local --strip-components=1 --no-same-owner; \
    rm "/tmp/${archive}"; \
    apt-get purge -y --auto-remove curl xz-utils; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid 1000 node; \
    useradd --uid 1000 --gid node --shell /bin/bash --create-home node; \
    ln -s /usr/local/bin/node /usr/local/bin/nodejs; \
    node --version; \
    npm --version; \
    corepack enable

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

# Run as the unprivileged user created in the base stage.
USER node

# The standalone output bundles a minimal node_modules and server.js.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]

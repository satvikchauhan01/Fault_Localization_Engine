# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy workspace manifests only (cache layer)
COPY package.json package-lock.json ./
COPY packages/domain/package.json ./packages/domain/package.json
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json

# Install all workspace deps
RUN npm ci --workspace=apps/backend --workspace=packages/domain --include-workspace-root
RUN mkdir -p /app/apps/backend/node_modules /app/packages/domain/node_modules

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Install openssl for Prisma query engine on Alpine
RUN apk add --no-cache openssl

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules

# Copy application source
COPY packages/domain ./packages/domain
COPY apps/backend ./apps/backend
COPY package.json ./

# Generate Prisma client (must run after source is copied)
RUN cd apps/backend && npx prisma generate

# Entrypoint script handles: wait-for-db → migrate → seed → start server
RUN cp /app/apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]

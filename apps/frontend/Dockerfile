# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json ./
COPY packages/domain/package.json ./packages/domain/package.json
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json

# Install all deps (frontend needs vite etc.)
RUN npm ci --include-workspace-root

# Copy source
COPY packages/domain ./packages/domain
COPY apps/frontend ./apps/frontend

# Build static assets (vite build)
WORKDIR /app/apps/frontend
RUN npm run build

# ── Stage 2: serve with nginx ─────────────────────────────────────────────────
FROM nginx:stable-alpine AS runtime
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

# Nginx config: proxy /api to backend, serve SPA from root
COPY apps/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

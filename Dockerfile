# syntax=docker/dockerfile:1

# ---- Dependencies: installed inside Linux, never copied from the host ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- Development: Vite dev server with hot reload (source is bind-mounted by compose) ----
FROM deps AS dev
COPY . .
EXPOSE 5173
# Listen on all interfaces so the host can reach the server through the published port.
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]

# ---- Unit tests: the pure simulation needs Node only ----
FROM deps AS test
COPY . .
CMD ["npm", "test"]

# ---- Browser playtests: Playwright's image bundles Chromium and its system libraries ----
# Keep this tag in step with the @playwright/test version in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS browser-test
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV CI=1
CMD ["npx", "playwright", "test"]

# ---- Build: production bundle in /app/dist ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- Production: static files served by nginx ----
FROM nginx:1.27-alpine AS production
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

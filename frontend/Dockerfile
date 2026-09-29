# syntax=docker/dockerfile:1
# Build the ForgeSense operations console with a reproducible, lockfile-pinned
# install. The runtime image serves the static bundle with nginx, so the
# frontend needs no Node runtime and no Python server.

FROM node:20-alpine AS build
WORKDIR /build

# Copy manifests first so the dependency layer caches independently of source.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/index.html ./
COPY frontend/public ./public
COPY frontend/src ./src

RUN npm run build

FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache curl \
    && rm -rf /var/lib/apk/lists/*

COPY --from=build /build/dist /usr/share/nginx/html
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s \
    CMD curl -fsS http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]

# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.12

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN bun run build

FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun server/web.ts ./server/web.ts

ENV NODE_ENV=production \
    STUDIO_RUNNER_URL=http://studio-runner:8787 \
    WEB_HOST=0.0.0.0 \
    WEB_INTERNAL_ORIGIN=http://web:8080 \
    WEB_PORT=8080 \
    WEB_PUBLIC_ORIGIN=http://127.0.0.1:8080 \
    WEB_ROOT=/app/dist

USER bun
EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:8080/healthz');process.exit(r.ok?0:1)"]

CMD ["bun", "run", "server/web.ts"]

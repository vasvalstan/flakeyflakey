# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.12
ARG PLAYWRIGHT_VERSION=1.61.1

FROM oven/bun:${BUN_VERSION} AS bun-runtime

FROM oven/bun:${BUN_VERSION} AS dependencies
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS runtime
ARG PLAYWRIGHT_VERSION

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY server/index.ts server/studio-service.ts server/questionnaire-engine.ts \
  server/openai-semantic-enrichment.ts server/openai-visual-evaluator.ts \
  server/saved-flow-store.ts server/visual-evaluation.ts ./server/
COPY src/studio/types.ts ./src/studio/types.ts

RUN test "$(node -p "require('./node_modules/@playwright/test/package.json').version")" = "${PLAYWRIGHT_VERSION}" \
  && if ! id -u pwuser >/dev/null 2>&1; then useradd --create-home --uid 1001 --shell /bin/bash pwuser; fi \
  && mkdir -p /var/lib/flakey \
  && chown -R pwuser:pwuser /app /var/lib/flakey

ENV HOME=/tmp/pw-home \
    NODE_ENV=production \
    STUDIO_DATA_DIR=/var/lib/flakey \
    STUDIO_HOST=0.0.0.0 \
    STUDIO_PORT=8787 \
    STUDIO_RUNTIME=container \
    XDG_CACHE_HOME=/tmp/pw-cache \
    XDG_CONFIG_HOME=/tmp/pw-config

# Railway mounts persistent volumes as root. Start only long enough to hand the
# data directory to the dedicated browser user, then drop privileges before Bun
# or Chromium starts.
USER root
EXPOSE 8787

HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:8787/api/studio/health');process.exit(r.ok?0:1)"]

CMD ["sh", "-c", "chown -R pwuser:pwuser /var/lib/flakey && exec runuser -u pwuser -- bun run server/index.ts"]

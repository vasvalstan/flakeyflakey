FROM oven/bun:1.3.12 AS bun
FROM mcr.microsoft.com/playwright:v1.61.1-noble
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN mkdir -p /workspace && chown pwuser:pwuser /workspace
ENV CI=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /workspace
USER pwuser

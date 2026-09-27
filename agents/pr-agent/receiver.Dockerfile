FROM oven/bun:1.3.12 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun build receiver.ts --target=bun --outfile=receiver.js

FROM oven/bun:1.3.12
WORKDIR /app
COPY --from=build /app/receiver.js ./receiver.js
USER bun
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["bun", "--no-env-file", "receiver.js"]

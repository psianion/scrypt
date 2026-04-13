# Multi-stage build for Scrypt
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production

# git is used by the optional git-autocommit loop (opt-in via SCRYPT_GIT_AUTOCOMMIT=1)
# for vault version history. Keep the layer small.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 3777
USER bun
CMD ["bun", "/app/src/server/index.ts"]

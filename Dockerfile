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
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Wave 8: embedding model cache (survives rebuilds via volume mount).
ENV SCRYPT_EMBED_CACHE_DIR=/data/embed-cache
RUN mkdir -p /data/embed-cache && chown -R bun:bun /data

# Optional build-time model bake. Enable with `--build-arg BAKE_EMBED_MODEL=1`.
ARG BAKE_EMBED_MODEL=0
RUN if [ "$BAKE_EMBED_MODEL" = "1" ]; then \
      bun -e "import('@huggingface/transformers').then(async m => { \
        m.env.cacheDir='/data/embed-cache'; \
        const p = await m.pipeline('feature-extraction','Xenova/bge-small-en-v1.5'); \
        await p(['warm'],{pooling:'mean',normalize:true}); \
      })"; \
    fi

EXPOSE 3777
USER bun
CMD ["bun", "/app/src/server/index.ts"]

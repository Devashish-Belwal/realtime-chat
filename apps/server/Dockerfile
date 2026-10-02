# Build stage
FROM oven/bun:latest AS builder
WORKDIR /app/apps/server
COPY apps/server/package.json apps/server/bun.lock ./
COPY apps/server/src ./src
COPY apps/server/tsconfig.json ./
COPY apps/shared /app/apps/shared
RUN bun install --frozen-lockfile
RUN bun run build

# Runtime stage — only production dependencies
FROM oven/bun:latest
WORKDIR /app/apps/server
COPY apps/server/package.json apps/server/bun.lock ./
COPY apps/server/src ./src
COPY apps/shared /app/apps/shared
RUN bun install --production --frozen-lockfile
CMD ["bun", "src/index.ts"]
EXPOSE 3002

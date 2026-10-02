# Client production image — multi-stage
FROM oven/bun:latest AS builder
ARG VITE_WS_URL=wss://chat.dabelwal.online
WORKDIR /app/apps/client
COPY apps/client/package.json apps/client/bun.lock ./
COPY apps/client/src ./src
COPY apps/client/index.html ./
COPY apps/client/tsconfig.json ./
COPY apps/client/vite.config.ts ./
COPY apps/shared /app/apps/shared
RUN echo "VITE_WS_URL=${VITE_WS_URL}" > .env.production
RUN bun install --frozen-lockfile
RUN bun run build

FROM nginx:alpine
COPY --from=builder /app/apps/client/dist /usr/share/nginx/html
COPY apps/client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

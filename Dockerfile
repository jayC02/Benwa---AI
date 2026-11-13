FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/core/package.json ./packages/core/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run db:generate && npm run build -w @benwa/web
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 BENWA_ROOT=/app WORKSPACE_ROOT=/app/.data/projects
RUN mkdir -p /app/.data/projects && chown -R node:node /app/.data
USER node
EXPOSE 4321
CMD ["node", "apps/web/dist/server/entry.mjs"]

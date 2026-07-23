FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3001/health || exit 1

# Default runs the API. The event indexer is a separate long-running process
# (see README's "Event Indexer" section) and needs its own container running
# this same image with the command overridden, e.g.:
#   docker run --env-file .env crate-backend npm run start:indexer
CMD ["node", "dist/index.js"]

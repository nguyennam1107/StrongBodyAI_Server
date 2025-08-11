# Multi-stage Dockerfile for production build

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# 1. Install dependencies (with dev) in separate layer for caching
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# If you later add a package-lock.json, this will allow clean installs
RUN npm install

# 2. Build TypeScript
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev dependencies to slim final image
RUN npm prune --omit=dev

# 3. Production runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Non‑root user for security
RUN addgroup -g 1001 app && adduser -S -u 1001 -G app app
USER app

# Copy built artifacts and production node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY .env.example ./

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "dist/server.js"]
